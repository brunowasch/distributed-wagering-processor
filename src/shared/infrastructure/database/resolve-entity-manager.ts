import { EntityManager } from '@mikro-orm/postgresql';

/** Usa o manager transacional/request-scoped ou cria um fork para workers e chamadas isoladas. */
export function resolveEntityManager(defaultEm: EntityManager, providedEm?: EntityManager): EntityManager {
    if (providedEm) return providedEm;
    const manager = typeof defaultEm.getContext === 'function' ? defaultEm.getContext(false) : defaultEm;
    if (manager !== defaultEm) return manager;
    return typeof defaultEm.fork === 'function' ? defaultEm.fork() : defaultEm;
}
