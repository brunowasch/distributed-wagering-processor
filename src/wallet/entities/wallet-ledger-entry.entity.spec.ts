import { describe, expect, it } from 'vitest';
import { MikroORM } from '@mikro-orm/core';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';

import { WalletLedgerEntryEntity } from './wallet-ledger-entry.entity.js';

async function createOrm() {
    return MikroORM.init({
        driver: PostgreSqlDriver,
        dbName: 'wagering',
        entities: [WalletLedgerEntryEntity],
        metadataProvider: ReflectMetadataProvider,
    });
}

describe('WalletLedgerEntryEntity', () => {
    it('should define the correct table name', async () => {
        const orm = await createOrm();

        try {
            const metadata = orm.getMetadata().get(WalletLedgerEntryEntity);

            expect(metadata.tableName).toBe('wallet_ledger_entry');
        } finally {
            await orm.close();
        }
    });

    it('should define all required properties', async () => {
        const orm = await createOrm();

        try {
            const metadata = orm.getMetadata().get(WalletLedgerEntryEntity);

            expect(Object.keys(metadata.properties)).toEqual(
                expect.arrayContaining([
                    'id',
                    'walletId',
                    'transactionId',
                    'direction',
                    'amount',
                    'currency',
                    'balanceBefore',
                    'balanceAfter',
                    'createdAt',
                ]),
            );
        } finally {
            await orm.close();
        }
    });
    
    it('should configure monetary properties with numeric precision', async () => {
        const orm = await createOrm();

        try {
            const metadata = orm.getMetadata().get(WalletLedgerEntryEntity);

            const monetaryProperties = [
                'amount',
                'balanceBefore',
                'balanceAfter',
            ] as const;

            for (const property of monetaryProperties) {
                expect(metadata.properties[property]).toMatchObject({
                    type: 'DecimalType',
                    precision: 20,
                    scale: 2,
                });
            }
        } finally {
            await orm.close();
        }
    });

    it('should configure the unique constraint for wallet and transaction', async () => {
        const orm = await createOrm();

        try {
            const metadata = orm.getMetadata().get(WalletLedgerEntryEntity);

            expect(metadata.uniques).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        properties: ['walletId', 'transactionId'],
                    }),
                ]),
            );
        } finally {
            await orm.close();
        }
    });
});
