export {};

/**
 * @typedef {{
 *   [P in keyof T]: NonNullable<T[P]>;
 * }} NonNullableFields
 * @template T
 */
/**
 * @typedef {{
 *   language: LanguageCode;
 *   country: CountryCode;
 *   label: string;
 *   currency: CurrencyCode;
 * }} Locale
 */
/** @typedef {Record<string, Locale>} Localizations */
/**
 * @typedef {Locale & {
 *   pathPrefix: string;
 * }} I18nLocale
 */
/** @typedef {HydrogenStorefront<I18nLocale>} Storefront */

/** @typedef {import('@shopify/hydrogen').Storefront} Storefront */
/** @typedef {import('@shopify/hydrogen/storefront-api-types').CountryCode} CountryCode */
/** @typedef {import('@shopify/hydrogen/storefront-api-types').CurrencyCode} CurrencyCode */
/** @typedef {import('@shopify/hydrogen/storefront-api-types').LanguageCode} LanguageCode */
