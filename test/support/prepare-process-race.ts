import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module.js';
import { Money } from '../../src/shared/domain/money.js';
import { WalletApplicationService } from '../../src/wallet/wallet-application.service.js';
import { WagerTransactionKind } from '../../src/wagering/domain/wager-transaction.js';

/** Prepara uma wallet de teste e imprime três requests para processos Bun independentes. */
async function main(): Promise<void> {
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    try {
        const playerId = `multiprocess-player-${randomUUID()}`;
        const wallet = await app.get(WalletApplicationService).openWallet({
            playerId,
            initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
        });
        const requests = Array.from({ length: 3 }, (_, index) => ({
            providerId: 'multiprocess-provider',
            externalTransactionId: `${wallet.id}-external-${index}`,
            idempotencyKey: `${wallet.id}-idempotency-${index}`,
            playerId: wallet.playerId,
            walletId: wallet.id,
            roundId: `${wallet.id}-round`,
            gameId: 'multiprocess-test',
            kind: WagerTransactionKind.BET,
            money: { amount: '40.00', currency: 'BRL' },
        }));
        process.stdout.write(`${JSON.stringify({ walletId: wallet.id, requests })}\n`);
    } finally {
        await app.close();
    }
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
});
