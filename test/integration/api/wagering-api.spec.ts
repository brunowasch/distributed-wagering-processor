import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../../src/app.module.js';

describe('Wagering HTTP API (integration)', () => {
    let module: TestingModule;
    let app: INestApplication;
    let walletId = '';

    beforeAll(async () => {
        module = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = module.createNestApplication();
        await app.init();
    });

    afterEach(async () => {
        // Lançamentos são imutáveis no banco; os cenários usam IDs isolados.
        walletId = '';
    });

    afterAll(async () => {
        await app?.close();
        await module?.close();
    });

    it('opens a wallet, processes a bet, exposes its ledger and reconciles the balance', async () => {
        const playerId = randomUUID();
        const opened = await request(app.getHttpServer())
            .post('/wallets')
            .send({ playerId, initialBalance: { amount: '100.00', currency: 'BRL' } })
            .expect(201);
        walletId = opened.body.id;
        expect(opened.body).toMatchObject({ playerId, balance: { amount: '100.00', currency: 'BRL' }, version: 1 });

        const transactionId = randomUUID();
        const providerId = `provider-${randomUUID()}`;
        const submitted = await request(app.getHttpServer())
            .post('/wagering/transactions')
            .set('Idempotency-Key', `key-${transactionId}`)
            .send({
                providerId,
                externalTransactionId: transactionId,
                playerId,
                walletId,
                roundId: 'round-api',
                gameId: 'game-api',
                kind: 'BET',
                money: { amount: '25.00', currency: 'BRL' },
            })
            .expect(201);
        expect(submitted.body).toMatchObject({ status: 'PROCESSED', balance: { amount: '75.00', currency: 'BRL' }, idempotentReplay: false });

        const replay = await request(app.getHttpServer())
            .post('/wagering/transactions')
            .set('Idempotency-Key', `key-${transactionId}`)
            .send({
                providerId,
                externalTransactionId: transactionId,
                playerId,
                walletId,
                roundId: 'round-api',
                gameId: 'game-api',
                kind: 'BET',
                money: { amount: '25.00', currency: 'BRL' },
            })
            .expect(200);
        expect(replay.body).toMatchObject({ transactionId: submitted.body.transactionId, idempotentReplay: true, balance: { amount: '75.00' } });
        await request(app.getHttpServer())
            .post('/wagering/transactions')
            .set('Idempotency-Key', `key-${transactionId}`)
            .send({
                providerId,
                externalTransactionId: transactionId,
                playerId,
                walletId,
                roundId: 'round-api',
                gameId: 'game-api',
                kind: 'BET',
                money: { amount: '26.00', currency: 'BRL' },
            })
            .expect(409);

        const transactionLookup = await request(app.getHttpServer())
            .get(`/providers/${providerId}/wagering/transactions/${transactionId}`)
            .expect(200);
        expect(transactionLookup.body.id).toBe(submitted.body.transactionId);

        const page = await request(app.getHttpServer()).get(`/wallets/${walletId}/ledger?limit=1`).expect(200);
        expect(page.body.items).toHaveLength(1);
        expect(page.body.nextCursor).toBeTypeOf('string');
        const nextPage = await request(app.getHttpServer())
            .get(`/wallets/${walletId}/ledger?limit=1&cursor=${encodeURIComponent(page.body.nextCursor)}`)
            .expect(200);
        expect(nextPage.body.items).toHaveLength(1);
        expect(nextPage.body.nextCursor).toBeNull();
        const allEntries = [...page.body.items, ...nextPage.body.items];
        expect(allEntries.find((entry: { direction: string }) => entry.direction === 'DEBIT'))
            .toMatchObject({ amount: { amount: '25.00', currency: 'BRL' } });

        const walletLookup = await request(app.getHttpServer()).get(`/wallets/${walletId}`).expect(200);
        expect(walletLookup.body.balance.amount).toBe('75.00');
        await request(app.getHttpServer()).get(`/wagering/transactions/${submitted.body.transactionId}`).expect(200);

        const reconciliation = await request(app.getHttpServer())
            .post(`/wallets/${walletId}/reconciliation`)
            .expect(201);
        expect(reconciliation.body).toMatchObject({ consistent: true, storedBalance: { amount: '75.00' }, calculatedBalance: { amount: '75.00' }, checkedEntries: 2 });

        await request(app.getHttpServer()).post('/wallets')
            .send({ playerId, initialBalance: { amount: '0.00', currency: 'BRL' } })
            .expect(409);
    });

    it('requires an idempotency key and rejects externally submitted OPENING transactions', async () => {
        const input = {
            providerId: 'external-provider',
            externalTransactionId: 'external-opening',
            playerId: randomUUID(),
            walletId: randomUUID(),
            roundId: 'round',
            gameId: 'game',
            kind: 'OPENING',
            money: { amount: '1.00', currency: 'BRL' },
        };
        await request(app.getHttpServer()).post('/wagering/transactions').send(input).expect(400);
        await request(app.getHttpServer()).post('/wagering/transactions').set('Idempotency-Key', 'opening-key').send(input).expect(400);
    });

    it('exposes unauthenticated liveness, readiness and Prometheus metrics endpoints', async () => {
        await request(app.getHttpServer()).get('/health/live').expect(200);
        const readiness = await request(app.getHttpServer()).get('/health/ready');
        expect([200, 503]).toContain(readiness.status);
        const metrics = await request(app.getHttpServer()).get('/metrics').expect(200);
        expect(metrics.headers['content-type']).toContain('text/plain');
    });
});
