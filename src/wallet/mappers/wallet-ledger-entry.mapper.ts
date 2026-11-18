import { Money } from '../../shared/domain/money.js';
import { WalletLedgerEntry } from '../domain/wallet-ledger-entry.js';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity.js';

/**
 * Traduz um lançamento do ledger entre o modelo de domínio e a entidade
 * persistida pelo MikroORM.
 *
 * O domínio representa valores monetários com Money, enquanto a entidade
 * armazena cada valor como texto decimal e a moeda em uma coluna separada.
 * O mapper mantém essa diferença de representação fora do domínio.
 */
export class WalletLedgerEntryMapper {
    /**
     * Converte um lançamento de domínio para uma entidade pronta para persistir.
     *
     * Os valores de Money são serializados como strings decimais para evitar
     * perda de precisão. A data é obtida pelo getter do domínio, que retorna
     * uma cópia e impede que alterações externas modifiquem o lançamento.
     */
    static toEntity(entry: WalletLedgerEntry): WalletLedgerEntryEntity {
        const entity = new WalletLedgerEntryEntity();
        entity.id = entry.id;
        entity.walletId = entry.walletId;
        entity.transactionId = entry.transactionId;
        entity.direction = entry.direction;
        entity.amount = entry.money.toString();
        entity.currency = entry.money.getCurrency();
        entity.balanceBefore = entry.balanceBefore.toString();
        entity.balanceAfter = entry.balanceAfter.toString();
        entity.createdAt = entry.createdAt;
        return entity;
    }

    /**
     * Reconstrói um lançamento de domínio a partir dos dados carregados do banco.
     *
     * A moeda persistida é aplicada ao valor movimentado e aos dois saldos.
     * rehydrate restaura o identificador e a data originais sem executar de
     * novo as regras de criação de um lançamento novo.
     */
    static toDomain(entity: WalletLedgerEntryEntity): WalletLedgerEntry {
        const currency = entity.currency;
        return WalletLedgerEntry.rehydrate({
            id: entity.id,
            walletId: entity.walletId,
            transactionId: entity.transactionId,
            direction: entity.direction as WalletLedgerEntry['direction'],
            money: Money.from({ amount: entity.amount, currency }),
            balanceBefore: Money.from({ amount: entity.balanceBefore, currency }),
            balanceAfter: Money.from({ amount: entity.balanceAfter, currency }),
            createdAt: entity.createdAt,
        });
    }
}
