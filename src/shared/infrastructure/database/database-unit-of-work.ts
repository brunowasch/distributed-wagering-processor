import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';

/**
 * Coordena operações de persistência que precisam compartilhar
 * uma única transação SQL.
 *
 * Disponibiliza o EntityManager transacional para que diferentes
 * repositórios executem suas operações dentro da mesma unidade
 * de trabalho.
 */
/** Executa vários repositórios com o mesmo EntityManager e resultado transacional. */
@Injectable()
export class DatabaseUnitOfWork {
    /** Recebe o manager raiz que cria os contextos SQL transacionais. */
    constructor(private readonly em: EntityManager) {}

    /**
     * Executa uma operação dentro de uma transação SQL.
     *
     * O MikroORM confirma a transação quando o callback termina
     * com sucesso e realiza rollback caso ocorra uma exceção.
     */
    /** Confirma ao concluir com sucesso e propaga a exceção após rollback em caso de falha. */
    async execute<T>(
        work: (em: EntityManager) => Promise<T>,
    ): Promise<T> {
        return this.em.transactional(async (transactionalEm) => {
            return work(transactionalEm);
        });
    }
}
