import { BadRequestException, Body, Controller, Get, Headers, Header, Param, Post, Query, Res, ServiceUnavailableException } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/postgresql';
import type { Response } from 'express';
import { EntityManager } from '@mikro-orm/postgresql';
import { Money } from '../shared/domain/money.js';
import { WagerTransactionKind } from '../wagering/domain/wager-transaction.js';
import { WageringService } from '../wagering/wagering.service.js';
import { WalletApplicationService } from '../wallet/wallet-application.service.js';
import { WalletLedgerEntryRepository } from '../wallet/repositories/wallet-ledger-entry.repository.js';
import { Wallet } from '../wallet/domain/wallet.js';
import { WalletLedgerEntry } from '../wallet/domain/wallet-ledger-entry.js';
import { SqsClient } from '../shared/infrastructure/messaging/sqs-client.js';
import { MetricsService } from '../shared/infrastructure/observability/metrics.service.js';

/** Confirma que um valor recebido pela API é um objeto JSON e não uma lista ou primitivo. */
function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Request body must be a JSON object.');
    return value as Record<string, unknown>;
}

/** Lê uma propriedade textual obrigatória e remove espaços nas extremidades. */
function requiredString(source: Record<string, unknown>, key: string): string {
    const value = source[key];
    if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${key} is required.`);
    return value.trim();
}

/** Converte o objeto monetário do contrato HTTP para o Value Object do domínio. */
function parseMoney(value: unknown): Money {
    const props = record(value);
    const amount = requiredString(props, 'amount');
    const currency = requiredString(props, 'currency');
    try {
        return Money.from({ amount, currency });
    } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : 'Invalid money value.');
    }
}

/** Projeta uma carteira de domínio para o contrato público de resposta. */
function walletDto(wallet: Wallet) {
    return {
        id: wallet.id,
        playerId: wallet.playerId,
        balance: wallet.balance.toJSON(),
        version: wallet.version,
    };
}

/** Projeta um lançamento imutável para JSON, mantendo os valores monetários textuais. */
function ledgerDto(entry: WalletLedgerEntry) {
    return {
        id: entry.id,
        walletId: entry.walletId,
        transactionId: entry.transactionId,
        direction: entry.direction,
        amount: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        createdAt: entry.createdAt.toISOString(),
    };
}

/** Codifica a chave composta (data, ID) usada para continuar a paginação do ledger. */
function encodeCursor(entry: WalletLedgerEntry): string {
    return Buffer.from(JSON.stringify({ createdAt: entry.createdAt.toISOString(), id: entry.id })).toString('base64url');
}

/** Valida e decodifica um cursor opaco; cursores inválidos viram erro HTTP 400. */
function decodeCursor(cursor?: string): { createdAt: Date; id: string } | undefined {
    if (!cursor) return undefined;
    try {
        const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        const value = record(decoded);
        const createdAt = new Date(requiredString(value, 'createdAt'));
        const id = requiredString(value, 'id');
        if (Number.isNaN(createdAt.getTime())) throw new Error();
        return { createdAt, id };
    } catch {
        throw new BadRequestException('Invalid ledger cursor.');
    }
}

/** Endpoints de abertura, consulta, histórico e reconciliação de carteiras. */
@Controller('wallets')
export class WalletController {
    /** Recebe os serviços de aplicação e persistência necessários às consultas de carteira. */
    constructor(
        private readonly wallets: WalletApplicationService,
        private readonly ledger: WalletLedgerEntryRepository,
        private readonly em: EntityManager,
    ) {}

    @Post()
    /** Abre uma carteira e devolve o saldo inicial já confirmado com seu lançamento de abertura. */
    async create(@Body() body: unknown) {
        const input = record(body);
        const initialBalance = parseMoney(input.initialBalance);
        if (initialBalance.isNegative()) throw new BadRequestException('Initial balance cannot be negative.');
        const wallet = await this.wallets.openWallet({
            playerId: requiredString(input, 'playerId'),
            initialBalance,
        });
        return walletDto(wallet);
    }

    @Get(':walletId')
    /** Consulta uma carteira pelo identificador interno. */
    async findOne(@Param('walletId') walletId: string) {
        return walletDto(await this.wallets.getWallet(walletId));
    }

    @Get(':walletId/ledger')
    /** Retorna uma página estável do ledger ordenada pelo cursor composto data/ID. */
    async ledgerPage(
        @Param('walletId') walletId: string,
        @Query('cursor') cursorText?: string,
        @Query('limit') limitText?: string,
    ) {
        const limit = limitText === undefined ? 50 : Number(limitText);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException('limit must be an integer between 1 and 100.');
        const cursor = decodeCursor(cursorText);
        const entries = await this.ledger.findPage(walletId, limit + 1, cursor, this.em);
        const hasMore = entries.length > limit;
        const page = entries.slice(0, limit);
        return {
            items: page.map(ledgerDto),
            nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]!) : null,
        };
    }

    @Post(':walletId/reconciliation')
    /** Compara saldo, ledger e transações sem alterar dados históricos. */
    async reconcile(@Param('walletId') walletId: string) {
        const result = await this.wallets.reconcile(walletId);
        return {
            walletId: result.walletId,
            storedBalance: result.storedBalance.toJSON(),
            calculatedBalance: result.calculatedBalance.toJSON(),
            difference: result.difference.toJSON(),
            consistent: result.consistent,
            checkedEntries: result.checkedEntries,
        };
    }
}

/** Recebe operações financeiras externas e consulta transações pelo ID interno. */
@Controller('wagering/transactions')
export class WageringController {
    /** Injeta o caso de uso financeiro compartilhado pela API e pelo consumidor SQS. */
    constructor(private readonly wagering: WageringService) {}

    /** Valida o contrato HTTP, exige idempotência e mapeia o resultado para o status HTTP. */
    @Post()
    async submit(
        @Headers('idempotency-key') idempotencyKey: string | undefined,
        @Body() body: unknown,
        @Res({ passthrough: true }) response: Response,
    ) {
        if (!idempotencyKey?.trim()) throw new BadRequestException('Idempotency-Key header is required.');
        const input = record(body);
        const kind = requiredString(input, 'kind') as WagerTransactionKind;
        if (!Object.values(WagerTransactionKind).includes(kind) || kind === WagerTransactionKind.OPENING) {
            throw new BadRequestException('Unsupported external transaction kind.');
        }
        if (requiredString(input, 'providerId') === 'internal') {
            throw new BadRequestException('The internal provider is reserved.');
        }
        const money = parseMoney(input.money);
        if (!money.isPositive()) throw new BadRequestException('Transaction amount must be positive.');
        const result = await this.wagering.processTransaction({
                providerId: requiredString(input, 'providerId'),
                externalTransactionId: requiredString(input, 'externalTransactionId'),
                idempotencyKey: idempotencyKey.trim(),
                playerId: requiredString(input, 'playerId'),
                walletId: requiredString(input, 'walletId'),
                roundId: requiredString(input, 'roundId'),
                gameId: requiredString(input, 'gameId'),
                kind: kind as Exclude<WagerTransactionKind, WagerTransactionKind.OPENING>,
                money,
                ...(input.referenceExternalTransactionId === undefined ? {} : {
                    referenceExternalTransactionId: requiredString(input, 'referenceExternalTransactionId'),
                }),
        });
        if (result.status === 'REJECTED') response.status(422);
        else if (result.status === 'FAILED') response.status(500);
        else if (result.status === 'PENDING_REFERENCE') response.status(202);
        else if (result.idempotentReplay) response.status(200);
        return {
            transactionId: result.transactionId,
            status: result.status,
            ...(result.failureCode ? { failureCode: result.failureCode } : {}),
            balance: result.balance.toJSON(),
            idempotentReplay: result.idempotentReplay,
        };
    }

    /** Busca uma transação pelo identificador interno, sem expor a entidade ORM. */
    @Get(':transactionId')
    async findById(@Param('transactionId') transactionId: string) {
        const transaction = await this.wagering.getTransactionById(transactionId);
        return {
            id: transaction.id,
            providerId: transaction.providerId,
            externalTransactionId: transaction.externalTransactionId,
            walletId: transaction.walletId,
            playerId: transaction.playerId,
            roundId: transaction.roundId,
            gameId: transaction.gameId,
            kind: transaction.kind,
            money: transaction.money.toJSON(),
            status: transaction.status,
            referenceExternalTransactionId: transaction.referenceExternalTransactionId,
            referenceTransactionId: transaction.referenceTransactionId,
            failureCode: transaction.failureCode,
            createdAt: transaction.createdAt.toISOString(),
            processedAt: transaction.processedAt?.toISOString(),
        };
    }
}

/** Expõe health checks abertos: liveness mede o processo e readiness testa dependências. */
@Controller('health')
export class HealthController {
    /** Injeta clientes das dependências cuja disponibilidade determina a prontidão. */
    constructor(private readonly orm: MikroORM, private readonly sqs: SqsClient) {}

    /** Indica que o processo HTTP está ativo, sem testar dependências externas. */
    @Get('live')
    live() {
        return { status: 'ok' };
    }

    /** Verifica PostgreSQL e SQS e responde 503 se alguma dependência estiver indisponível. */
    @Get('ready')
    async ready() {
        const databaseReady = await this.orm.em.getConnection().execute('select 1').then(() => true, () => false);
        const queueReady = await this.sqs.isReachable('wager-transactions.fifo');
        if (!databaseReady || !queueReady) throw new ServiceUnavailableException({
            status: 'not_ready',
            dependencies: { postgres: databaseReady, sqs: queueReady },
        });
        return { status: 'ready', dependencies: { postgres: true, sqs: true } };
    }
}

/** Expõe as métricas acumuladas no processo no formato de texto do Prometheus. */
@Controller()
export class MetricsController {
    /** Recebe o coletor compartilhado de métricas. */
    constructor(private readonly metrics: MetricsService) {}

    /** Serializa contadores, gauges e observações para coleta externa. */
    @Get('metrics')
    @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
    scrape(): string {
        return this.metrics.renderPrometheus();
    }
}

/** Consulta uma operação usando a identidade e o ID externo do provedor. */
@Controller('providers/:providerId/wagering/transactions')
export class ProviderTransactionController {
    /** Reutiliza a consulta da camada de aplicação. */
    constructor(private readonly wagering: WageringService) {}

    /** Busca uma transação pelo par provedor/ID externo e retorna um DTO público. */
    @Get(':externalTransactionId')
    async findByProvider(
        @Param('providerId') providerId: string,
        @Param('externalTransactionId') externalTransactionId: string,
    ) {
        const transaction = await this.wagering.getTransactionByProvider(providerId, externalTransactionId);
        return {
            id: transaction.id,
            providerId: transaction.providerId,
            externalTransactionId: transaction.externalTransactionId,
            walletId: transaction.walletId,
            playerId: transaction.playerId,
            roundId: transaction.roundId,
            gameId: transaction.gameId,
            kind: transaction.kind,
            money: transaction.money.toJSON(),
            status: transaction.status,
            referenceExternalTransactionId: transaction.referenceExternalTransactionId,
            referenceTransactionId: transaction.referenceTransactionId,
            failureCode: transaction.failureCode,
            createdAt: transaction.createdAt.toISOString(),
            processedAt: transaction.processedAt?.toISOString(),
        };
    }
}
