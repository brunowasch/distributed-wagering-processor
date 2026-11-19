import 'dotenv/config';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';

const isProduction = process.env.NODE_ENV === 'production';

/** Configuração compartilhada pelo runtime, CLI de migrations e testes de integração. */
export default defineConfig({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    dbName: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,

    // Em produção, Bun deve carregar somente o JavaScript compilado pelo TypeScript.
    // Carregar os .ts diretamente ativa o transform de decorators do Bun, incompatível
    // com os decorators legados usados pelas entidades do MikroORM.
    entities: ['./dist/**/*.entity.js'],
    ...(isProduction ? {} : { entitiesTs: ['./src/**/*.entity.ts'] }),

    extensions: [Migrator],

    migrations: isProduction
        ? { path: './dist/migrations' }
        : { path: './dist/migrations', pathTs: './src/migrations' },

    metadataProvider: ReflectMetadataProvider,
});
