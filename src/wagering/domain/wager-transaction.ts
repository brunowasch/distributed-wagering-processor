import { randomUUID } from 'node:crypto';

import { Money } from '../../shared/domain/money.js';

/**
 * Natureza da operação financeira. 
 * 
 * OPENING: representa o crédito inicial de uma carteira.
 * BET: representa uma aposta e provoca um débito.
 * WIN: representa uma vitória e provoca um crédito.
 * LOSS: representa uma derrota, sem movimentação financeira.
 * REFUND: devolve o valor de uma aposta.
 * ROLLBACK: desfaz uma operação anterior.
 */
export enum WagerTransactionKind {
    OPENING = 'OPENING',
    BET = 'BET',
    WIN = 'WIN',
    LOSS = 'LOSS',
    REFUND = 'REFUND',
    ROLLBACK = 'ROLLBACK',
}

/**
 * Estado atual do processamento da transação.
 *
 * PENDING: transação aguardando processamento.
 * PENDING_REFERENCE: transação aguardando a chegada de uma transação de referência.
 * PROCESSED: transação processada com sucesso.
 * REJECTED: transação rejeitada por uma regra de negócio.
 * FAILED: transação que falhou durante o processamento.
 *
 * PROCESSED, REJECTED e FAILED são estados terminais,
 * não permitindo novas transições.
 */
export enum WagerTransactionStatus {
    PENDING = 'PENDING',
    PENDING_REFERENCE = 'PENDING_REFERENCE',
    PROCESSED = 'PROCESSED',
    REJECTED = 'REJECTED',
    FAILED = 'FAILED',
}

/**
 * Propriedades necessárias para criar uma transação de aposta.
 *
 * id: identificador único opcional da transação interna (gerado automaticamente se não informado).
 * providerId: identificador do provedor de jogos responsável pela requisição.
 * externalTransactionId: identificador único da transação gerado pelo provedor externo.
 * idempotencyKey: chave única utilizada para garantir que a mesma requisição não seja processada em duplicidade.
 * payloadHash: hash criptográfico do corpo da requisição para validar a integridade dos dados em retentativas.
 * walletId: identificador da carteira onde a movimentação financeira será aplicada.
 * playerId: identificador do jogador envolvido na aposta.
 * roundId: identificador da rodada de jogo à qual a transação pertence.
 * gameId: identificador do jogo em que a transação foi originada.
 * kind: tipo ou natureza da transação de aposta (ex: débito de aposta, crédito de prêmio, estorno).
 * money: objeto de valor (Money) contendo a quantia e a moeda da transação.
 * referenceExternalTransactionId: identificador externo opcional de uma transação original vinculada (usado em estornos ou ganhos).
 *
 * Os campos idempotencyKey e payloadHash atuam em conjunto para evitar processamento duplicado e detectar alterações indevidas em retentativas.
 */
export interface WagerTransactionProps {
    id?: string;
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    payloadHash: string;
    walletId: string;
    playerId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    money: Money;
    referenceExternalTransactionId?: string;
}


/**
 * Estado completo de uma transação de aposta persistida.
 *
 * id: identificador único interno da transação.
 * providerId: identificador do provedor de jogos responsável pela operação.
 * externalTransactionId: identificador da transação no sistema do provedor.
 * idempotencyKey: chave utilizada para garantir a idempotência da operação.
 * payloadHash: hash do conteúdo original da requisição.
 * walletId: identificador da carteira envolvida na operação.
 * playerId: identificador do jogador responsável pela transação.
 * roundId: identificador da rodada de jogo.
 * gameId: identificador do jogo.
 * kind: natureza da operação financeira.
 * money: valor e moeda envolvidos na transação.
 * referenceExternalTransactionId: identificador externo da transação original vinculada, quando aplicável.
 * createdAt: data e horário em que a transação foi criada.
 * status: estado atual do processamento da transação.
 * referenceTransactionId: identificador interno da transação de referência, quando resolvida.
 * failureCode: código que identifica o motivo de uma rejeição ou falha, quando aplicável.
 * processedAt: data e horário em que a transação foi processada.
 *
 * Diferentemente de WagerTransactionProps, esta interface representa
 * uma transação já existente, incluindo seus dados de processamento.
 */
export interface WagerTransactionState {
    id: string;
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    payloadHash: string;
    walletId: string;
    playerId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    money: Money;
    referenceExternalTransactionId?: string;
    createdAt: Date;
    status: WagerTransactionStatus;
    referenceTransactionId?: string;
    failureCode?: string;
    processedAt?: Date;
}

/**
 * Entidade de domínio que representa uma transação de aposta.
 *
 * Mantém os dados originais da operação e controla seu ciclo de vida,
 * incluindo estados de processamento, referências e informações de falha.
 *
 * O construtor privado garante que novas instâncias sejam criadas
 * exclusivamente pelos métodos de fábrica, permitindo controlar
 * as regras de criação e reconstrução da transação.
 */
export class WagerTransaction {
    private constructor(
        public readonly id: string,
        public readonly providerId: string,
        public readonly externalTransactionId: string,
        public readonly idempotencyKey: string,
        public readonly payloadHash: string,
        public readonly walletId: string,
        public readonly playerId: string,
        public readonly roundId: string,
        public readonly gameId: string,
        public readonly kind: WagerTransactionKind,
        public readonly money: Money,
        public readonly referenceExternalTransactionId: string | undefined,
        private _status: WagerTransactionStatus,
        private _referenceTransactionId: string | undefined,
        private _failureCode: string | undefined,
        private readonly _createdAt: Date,
        private _processedAt: Date | undefined,
    ) {}

    /**
     * Cria uma nova transação de aposta, inicializando seu estado como PENDING.
     *
     * Gera um identificador interno quando não informado e valida os dados
     * necessários para garantir que a transação possa ser processada.
     */
    static create(props: WagerTransactionProps): WagerTransaction {
        const id = props.id ?? randomUUID();

        if (!id.trim()) {
            throw new Error('Transaction ID is required.');
        }

        if (!props.providerId.trim()) {
            throw new Error('Provider ID is required.');
        }

        if (!props.externalTransactionId.trim()) {
            throw new Error('External transaction ID is required.');
        }

        if (!props.idempotencyKey.trim()) {
            throw new Error('Idempotency key is required.');
        }

        if (!props.payloadHash.trim()) {
            throw new Error('Payload hash is required.');
        }

        if (!props.walletId.trim()) {
            throw new Error('Wallet ID is required.');
        }

        if (!props.playerId.trim()) {
            throw new Error('Player ID is required.');
        }

        if (!props.roundId.trim()) {
            throw new Error('Round ID is required.');
        }

        if (!props.gameId.trim()) {
            throw new Error('Game ID is required.');
        }

        if (!props.money.isPositive()) {
            throw new Error('Transaction amount must be positive.');
        }

        if ((props.kind === WagerTransactionKind.REFUND || props.kind === WagerTransactionKind.ROLLBACK) && !props.referenceExternalTransactionId?.trim()) {
            throw new Error('Reference transaction ID is required.');
        }

        const now = new Date();

        return new WagerTransaction(
            id,
            props.providerId,
            props.externalTransactionId,
            props.idempotencyKey,
            props.payloadHash,
            props.walletId,
            props.playerId,
            props.roundId,
            props.gameId,
            props.kind,
            props.money,
            props.referenceExternalTransactionId,
            WagerTransactionStatus.PENDING,
            undefined,
            undefined,
            now,
            undefined,
        );
    }

    /**
     * Retorna o estado atual do processamento da transação.
     */
    get status(): WagerTransactionStatus {
        return this._status;
    }

    /**
     * Retorna o identificador interno da transação de referência, quando disponível.
     */
    get referenceTransactionId(): string | undefined {
        return this._referenceTransactionId;
    }

    /**
     * Retorna o código que identifica o motivo de uma rejeição ou falha.
     */
    get failureCode(): string | undefined {
        return this._failureCode;
    }

    /**
     * Retorna a data de processamento da transação, quando concluído.
     */
    get processedAt(): Date | undefined {
        return this._processedAt
            ? new Date(this._processedAt.getTime())
            : undefined;
    }

    /**
     * Retorna a data de criação da transação.
     */
    get createdAt(): Date {
        return new Date(this._createdAt.getTime());
    }

    /**
     * Verifica se a transação alcançou um estado terminal.
     *
     * Transações processadas, rejeitadas ou com falha não podem
     * sofrer novas transições de estado.
     */
    isTerminal(): boolean {
        return [
            WagerTransactionStatus.PROCESSED,
            WagerTransactionStatus.REJECTED,
            WagerTransactionStatus.FAILED,
        ].includes(this._status);
    }

    /**
     * Verifica se o tipo de transação provoca uma alteração no saldo da carteira.
     *
     * LOSS registra o resultado da aposta, mas não gera movimentação financeira.
     */
    affectsBalance(): boolean {
        return this.kind !== WagerTransactionKind.LOSS;
    }

    /**
     * Verifica se a operação exige uma transação anterior como referência.
     */
    requiresReference(): boolean {
        return (
            this.kind === WagerTransactionKind.REFUND ||
            this.kind === WagerTransactionKind.ROLLBACK
        );
    }

    /**
     * Verifica se o conteúdo de uma nova requisição corresponde ao conteúdo
     * originalmente registrado nesta transação.
     *
     * A comparação utiliza o hash do payload, calculado antes da chamada
     * ao domínio a partir dos dados de negócio da requisição.
     */
    matchesPayload(payloadHash: string): boolean {
        return this.payloadHash === payloadHash;
    }

    /**
     * Determina a direção do lançamento financeiro correspondente à transação.
     *
     * Para ROLLBACK, a direção é inversa à operação original, sendo necessário
     * informar o tipo da transação referenciada.
     *
     * LOSS não gera lançamento financeiro e retorna undefined.
     */
    ledgerDirectionFor(referenceKind?: WagerTransactionKind): 'DEBIT' | 'CREDIT' | undefined {
        switch (this.kind) {
            case WagerTransactionKind.OPENING:
            case WagerTransactionKind.WIN:
            case WagerTransactionKind.REFUND:
                return 'CREDIT';

            case WagerTransactionKind.BET:
                return 'DEBIT';

            case WagerTransactionKind.LOSS:
                return undefined;

            case WagerTransactionKind.ROLLBACK:
                if (!referenceKind) {
                    throw new Error('ROLLBACK requires a reference transaction kind.');
                }

                if (referenceKind === WagerTransactionKind.BET) {
                    return 'CREDIT';
                }

                if (referenceKind === WagerTransactionKind.WIN || referenceKind === WagerTransactionKind.REFUND) {
                    return 'DEBIT';
                }

                throw new Error('Invalid reference transaction kind for ROLLBACK.');
        }
    }

    /**
     * Marca a transação como aguardando uma operação de referência.
     *
     * Essa transição é permitida somente para REFUND e ROLLBACK,
     * quando a transação original ainda não foi encontrada.
     */
    markPendingReference(): void {
        if (this.isTerminal()) {
            throw new Error('Cannot change a transaction in a terminal state.');
        }

        if (this._status !== WagerTransactionStatus.PENDING) {
            throw new Error('Only PENDING transactions can become PENDING_REFERENCE.');
        }

        if (!this.requiresReference()) {
            throw new Error('This transaction kind does not require a reference.');
        }

        this._status = WagerTransactionStatus.PENDING_REFERENCE;
    }

    /**
     * Finaliza a transação após o processamento bem-sucedido.
     *
     * Para REFUND e ROLLBACK, exige o identificador interno da
     * transação original utilizada como referência.
     */
    markProcessed(referenceTransactionId?: string): void {
        if (this.isTerminal()) {
            throw new Error('Cannot change a transaction in a terminal state.');
        }

        if (this.requiresReference() && !referenceTransactionId?.trim()) {
            throw new Error('A reference transaction ID is required.');
        }

        if (referenceTransactionId !== undefined && !referenceTransactionId.trim()) {
            throw new Error('Reference transaction ID cannot be empty.');
        }

        this._referenceTransactionId = referenceTransactionId;
        this._status = WagerTransactionStatus.PROCESSED;
        this._processedAt = new Date();
    }

    /**
     * Finaliza a transação por rejeição de uma regra de negócio.
     *
     * O código de falha deve ser estável e identificável pela aplicação,
     * permitindo distinguir os motivos de rejeição.
     */
    reject(failureCode: string): void {
        if (this.isTerminal()) {
            throw new Error('Cannot change a transaction in a terminal state.');
        }

        if (!failureCode.trim()) {
            throw new Error('Failure code cannot be empty.');
        }

        this._failureCode = failureCode.trim();
        this._status = WagerTransactionStatus.REJECTED;
        this._processedAt = new Date();
    }

    /**
     * Finaliza a transação após uma falha durante o processamento.
     *
     * Diferentemente de REJECTED, que representa uma decisão de negócio,
     * FAILED representa uma falha ocorrida durante a execução.
     */
    fail(failureCode: string): void {
        if (this.isTerminal()) {
            throw new Error('Cannot change a transaction in a terminal state.');
        }

        if (!failureCode.trim()) {
            throw new Error('Failure code cannot be empty.');
        }

        this._failureCode = failureCode.trim();
        this._status = WagerTransactionStatus.FAILED;
        this._processedAt = new Date();
    }

    /**
     * Reconstrói uma transação a partir de seu estado persistido.
     *
     * Diferentemente de create(), este método não aplica novamente
     * as regras de criação ou transição de estado, pois os dados
     * representam uma transação que já existe no sistema.
     *
     * As datas são copiadas para evitar referências mutáveis externas.
     */
    static rehydrate(state: WagerTransactionState): WagerTransaction {
        return new WagerTransaction(
            state.id,
            state.providerId,
            state.externalTransactionId,
            state.idempotencyKey,
            state.payloadHash,
            state.walletId,
            state.playerId,
            state.roundId,
            state.gameId,
            state.kind,
            state.money,
            state.referenceExternalTransactionId,
            state.status,
            state.referenceTransactionId,
            state.failureCode,
            new Date(state.createdAt),
            state.processedAt ? new Date(state.processedAt) : undefined,
        );
    }
}