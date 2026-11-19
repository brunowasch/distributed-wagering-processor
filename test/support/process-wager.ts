import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module.js';
import { Money } from '../../src/shared/domain/money.js';
import { WagerTransactionKind } from '../../src/wagering/domain/wager-transaction.js';
import { WageringService } from '../../src/wagering/wagering.service.js';

/** Processo auxiliar para provar concorrência entre runtimes e pools independentes. */
async function main(): Promise<void> {
    const encodedRequest = process.env.WAGER_PROCESS_REQUEST;
    if (!encodedRequest) throw new Error('WAGER_PROCESS_REQUEST is required.');

    const request = JSON.parse(encodedRequest) as {
        providerId: string;
        externalTransactionId: string;
        idempotencyKey: string;
        playerId: string;
        walletId: string;
        roundId: string;
        gameId: string;
        kind: Exclude<WagerTransactionKind, WagerTransactionKind.OPENING>;
        money: { amount: string; currency: string };
    };
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    try {
        const result = await app.get(WageringService).processTransaction({
            ...request,
            money: Money.from(request.money),
        });
        process.stdout.write(`${JSON.stringify({ pid: process.pid, ...result })}\n`);
    } finally {
        await app.close();
    }
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
});
