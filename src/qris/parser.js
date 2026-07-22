/**
 * EMVCo / QRIS TLV (Tag-Length-Value) Parser and Builder
 */

/**
 * Parses a QRIS string into an array of TLV items
 * @param {string} qrisStr 
 * @returns {Array<{tag: string, length: number, value: string}>}
 */
function parseTLV(qrisStr) {
  const items = [];
  let i = 0;
  while (i < qrisStr.length) {
    if (i + 4 > qrisStr.length) break;
    const tag = qrisStr.substring(i, i + 2);
    const length = parseInt(qrisStr.substring(i + 2, i + 4), 10);
    if (isNaN(length) || i + 4 + length > qrisStr.length) {
      break;
    }
    const value = qrisStr.substring(i + 4, i + 4 + length);
    items.push({ tag, length, value });
    i += 4 + length;
  }
  return items;
}

/**
 * Builds a QRIS string from an array of TLV items (excluding CRC Tag 63)
 * @param {Array<{tag: string, value: string}>} items 
 * @returns {string}
 */
function buildTLV(items) {
  let result = '';
  for (const item of items) {
    if (item.tag === '63') continue; // CRC tag will be recalculated separately
    const val = String(item.value);
    const lenStr = String(val.length).padStart(2, '0');
    result += `${item.tag}${lenStr}${val}`;
  }
  return result;
}

module.exports = {
  parseTLV,
  buildTLV
};
