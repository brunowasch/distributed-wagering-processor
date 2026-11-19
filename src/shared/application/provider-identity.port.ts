/**
 * Ponto de integração para validar a identidade de um provedor via OIDC.
 * A autenticação foi omitida pelo escopo permitido no desafio; a implementação
 * de produção pode adaptar Keycloak/Zitadel sem acoplar domínio ou controllers.
 */
export abstract class ProviderIdentityPort {
    abstract assertAuthenticatedProvider(providerId: string): Promise<void>;
}
