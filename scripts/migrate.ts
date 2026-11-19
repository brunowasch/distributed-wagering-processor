import { MikroORM } from '@mikro-orm/postgresql';
import config from '../mikro-orm.config.js';

/** Executa uma migration para cima ou para baixo e sempre encerra a conexão ORM. */
const direction = process.argv[2] ?? 'up';
const orm = await MikroORM.init(config);
try {
    // A direção é validada explicitamente para não executar uma ação inesperada.
    if (direction === 'up') await orm.migrator.up();
    else if (direction === 'down') await orm.migrator.down();
    else throw new Error(`Unsupported migration direction: ${direction}`);
} finally {
    await orm.close();
}
