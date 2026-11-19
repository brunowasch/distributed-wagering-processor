import { NestFactory } from '@nestjs/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { AppModule } from '../../src/app.module.js';
import { WalletApplicationService } from '../../src/wallet/wallet-application.service.js';
import { WalletLedgerEntryEntity } from '../../src/wallet/entities/wallet-ledger-entry.entity.js';
import { WagerTransactionEntity } from '../../src/wagering/entities/wager-transaction.entity.js';

/** Confere saldo, Ledger e estados após disparar operações de processos separados. */
async function main(): Promise<void> {
    const walletId = process.env.WAGER_PROCESS_WALLET_ID;
    if (!walletId) throw new Error('WAGER_PROCESS_WALLET_ID is required.');
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    try {
        const wallets = app.get(WalletApplicationService);
        const em = app.get(EntityManager);
        const wallet = await wallets.getWallet(walletId);
        const reconciliation = await wallets.reconcile(walletId);
        const transactions = await em.fork().find(WagerTransactionEntity, {
            walletId,
            providerId: 'multiprocess-provider',
        });
        const ledgerEntries = await em.fork().count(WalletLedgerEntryEntity, { walletId });
        const result = {
            walletId,
            balance: wallet.balance.toJSON(),
            ledgerEntries,
            processed: transactions.filter(({ status }) => status === 'PROCESSED').length,
            rejected: transactions.filter(({ status }) => status === 'REJECTED').length,
            ledgerAndWalletConsistent: reconciliation.consistent,
        };
        if (result.balance.amount !== '20.00' || ledgerEntries !== 3 || result.processed !== 2
            || result.rejected !== 1 || !result.ledgerAndWalletConsistent) {
            throw new Error(`Multiprocess race invariant failed: ${JSON.stringify(result)}`);
        }
        process.stdout.write(`${JSON.stringify(result)}\n`);
    } finally {
        await app.close();
    }
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
});
