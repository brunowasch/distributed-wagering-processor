import 'dotenv/config';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';

/** Configuração compartilhada pelo runtime, CLI de migrations e testes de integração. */
export default defineConfig({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    dbName: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,

    entities: ['./dist/**/*.entity.js'],
    entitiesTs: ['./src/**/*.entity.ts'],

    extensions: [Migrator],

    migrations: {
        path: './dist/migrations',
        pathTs: './src/migrations'
    },

    metadataProvider: ReflectMetadataProvider,
});
