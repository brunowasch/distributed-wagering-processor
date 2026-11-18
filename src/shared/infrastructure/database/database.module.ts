import { Global, Module } from '@nestjs/common';
import { DatabaseUnitOfWork } from './database-unit-of-work.js';

/**
 * Módulo responsável por disponibilizar recursos compartilhados
 * de infraestrutura relacionados ao banco de dados.
 *
 * Como é global, seus providers ficam disponíveis nos demais
 * módulos após sua importação pela aplicação.
 */
@Global()
@Module({
    providers: [DatabaseUnitOfWork],
    exports: [DatabaseUnitOfWork],
})
export class DatabaseModule {}
