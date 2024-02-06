/**
 * Formats a number as USD. Example: 1800 => $1,800.00
 * @param {string | number} price
 */
export function formatPrice(price, currency = 'USD', locale = 'en-US') {
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  });

  return formatter.format(Number(price));
}

/**
 * Removes symbols and decimals from a price and converts to number.
 * @param {string | null} price
 */
export function normalizePrice(price) {
  if (!price || !/^[$\d.,]+$/.test(price)) {
    throw new Error('Price was not found');
  }

  return Number(
    price
      .replace('$', '')
      .trim()
      .replace(/[.,](\d\d)$/, '-$1')
      .replace(/[.,]/g, '')
      .replace('-', '.'),
  );
}
