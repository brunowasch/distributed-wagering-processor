import { Check, Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

/**
 * Representa um lançamento financeiro persistido no ledger de uma carteira.
 *
 * Cada registro corresponde a uma movimentação de uma transação financeira.
 * Os saldos anterior e posterior permitem reconstruir e auditar o histórico
 * financeiro da carteira.
 *
 * Os valores monetários são armazenados como strings para preservar
 * a precisão decimal. A consistência matemática dos lançamentos é
 * validada no domínio e complementada por restrições no banco de dados.
 */
/** Mapeamento persistente do ledger, com restrições de integridade declaradas no schema. */
@Entity({ tableName: 'wallet_ledger_entry' })
@Unique({
    name: 'wallet_ledger_entry_wallet_transaction_unique',
    properties: ['walletId', 'transactionId'],
})
@Index({
    name: 'wallet_ledger_entry_wallet_created_at_index',
    properties: ['walletId', 'createdAt'],
})
@Check({
    name: 'wallet_ledger_entry_amount_positive_check',
    expression: '"amount" > 0',
})
@Check({
    name: 'wallet_ledger_entry_balance_before_non_negative_check',
    expression: '"balance_before" >= 0',
})
@Check({
    name: 'wallet_ledger_entry_balance_after_non_negative_check',
    expression: '"balance_after" >= 0',
})
@Check({
    name: 'wallet_ledger_entry_direction_check',
    expression: `"direction" IN ('DEBIT', 'CREDIT')`,
})
export class WalletLedgerEntryEntity {
    @PrimaryKey({ type: 'uuid' })
    id!: string;

    @Property({ type: 'uuid', fieldName: 'wallet_id' })
    walletId!: string;

    @Property({ type: 'uuid', fieldName: 'transaction_id' })
    transactionId!: string;

    @Property({ type: 'varchar', length: 10 })
    direction!: string;

    @Property({ type: 'numeric', precision: 20, scale: 2 })
    amount!: string;

    @Property({ type: 'varchar', length: 3 })
    currency!: string;

    @Property({
        type: 'numeric',
        precision: 20,
        scale: 2,
        fieldName: 'balance_before',
    })
    balanceBefore!: string;

    @Property({
        type: 'numeric',
        precision: 20,
        scale: 2,
        fieldName: 'balance_after',
    })
    balanceAfter!: string;

    @Property({
        type: 'timestamptz',
        fieldName: 'created_at',
    })
    createdAt!: Date;
}
