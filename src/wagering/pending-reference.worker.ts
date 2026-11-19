import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WagerTransaction } from './domain/wager-transaction.js';
import { WagerTransactionRepository } from './wager-transaction.repository.js';
import { WageringService } from './wagering.service.js';

/** Reprocessa dependências pendentes usando backoff persistido no PostgreSQL. */
@Injectable()
export class PendingReferenceWorker implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(PendingReferenceWorker.name);
    private readonly enabled: boolean;
    private readonly intervalMs: number;
    private timer?: ReturnType<typeof setInterval>;
    private running = false;
    private activeRun?: Promise<void>;

    /** Configura polling e dependências para retomar operações fora de ordem. */
    constructor(
        private readonly transactions: WagerTransactionRepository,
        private readonly wagering: WageringService,
        config: ConfigService,
    ) {
        this.enabled = config.get<string>('REFERENCE_WORKER_ENABLED', 'false') === 'true';
        this.intervalMs = Number(config.get<string>('REFERENCE_WORKER_POLL_INTERVAL_MS', '1000'));
    }

    /** Inicia o timer de busca apenas quando o worker foi habilitado. */
    onModuleInit(): void {
        if (!this.enabled) return;
        this.timer = setInterval(() => {
            if (this.running) return;
            this.running = true;
            this.activeRun = this.processDue().finally(() => { this.running = false; });
        }, this.intervalMs);
        this.timer.unref?.();
    }

    /** Para novos ciclos e espera o ciclo ativo antes de encerrar o módulo. */
    async onModuleDestroy(): Promise<void> {
        if (this.timer) clearInterval(this.timer);
        await this.activeRun;
    }

    /** Reenvia ao caso de uso as transações pendentes cujo backoff venceu. */
    async processDue(limit = 50): Promise<void> {
        const due = await this.transactions.findDuePendingReferences(new Date(), limit);
        for (const transaction of due) {
            try {
                await this.wagering.processTransaction(this.toRequest(transaction));
            } catch (error) {
                this.logger.error(JSON.stringify({
                    event: 'pending_reference_retry_failed',
                    transactionId: transaction.id,
                    providerId: transaction.providerId,
                    walletId: transaction.walletId,
                    errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
                }));
            }
        }
    }

    /** Recria o comando original preservado na transação persistida. */
    private toRequest(transaction: WagerTransaction) {
        return {
            providerId: transaction.providerId,
            externalTransactionId: transaction.externalTransactionId,
            idempotencyKey: transaction.idempotencyKey,
            playerId: transaction.playerId,
            walletId: transaction.walletId,
            roundId: transaction.roundId,
            gameId: transaction.gameId,
            kind: transaction.kind as Exclude<typeof transaction.kind, 'OPENING'>,
            money: transaction.money,
            ...(transaction.referenceExternalTransactionId
                ? { referenceExternalTransactionId: transaction.referenceExternalTransactionId }
                : {}),
        };
    }
}
