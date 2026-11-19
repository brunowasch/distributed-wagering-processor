// Validar se a moeda fornecida é suportada pelo JavaScript usando o objeto Intl. 
// Isso garante que apenas moedas válidas sejam aceitas no sistema.
const SUPPORTED_CURRENCIES = new Set(
    Intl.supportedValuesOf('currency'),
);

/** Verifica se o código ISO consta entre as moedas reconhecidas pelo runtime. */
export function isValidCurrency(currency: string): boolean {
    return SUPPORTED_CURRENCIES.has(currency);
}
