const { parseTLV, buildTLV } = require('./parser');
const { calcCRC16 } = require('./crc16');

/**
 * Clean QRIS string by stripping extra quotes or spaces
 */
function sanitizeQrisString(qrisStr) {
  if (!qrisStr) return '';
  return String(qrisStr).trim().replace(/^["']|["']$/g, '');
}

/**
 * Converts a Static QRIS payload string to a Dynamic QRIS payload string with a given amount.
 * 
 * @param {string} staticQris - The static QRIS string
 * @param {number|string} amount - Transaction amount (IDR)
 * @returns {string} Dynamic QRIS string
 */
function convertStaticToDynamic(staticQris, amount) {
  const cleanQris = sanitizeQrisString(staticQris);
  if (!cleanQris) {
    throw new Error('Payload QRIS Statis tidak valid.');
  }

  // Ensure amount is formatted as integer without decimals (e.g. 50000)
  const numAmount = Math.round(Number(amount));
  if (isNaN(numAmount) || numAmount <= 0) {
    throw new Error('Nominal transaksi harus berupa angka positif.');
  }
  const amountStr = String(numAmount);

  const tlvItems = parseTLV(cleanQris);
  if (tlvItems.length === 0) {
    throw new Error('Format QRIS tidak dapat di-parse.');
  }

  let tag01Found = false;
  let tag54Found = false;

  const newItems = [];

  for (const item of tlvItems) {
    if (item.tag === '63') continue; // Exclude original CRC

    if (item.tag === '01') {
      // Change initiation method from 11 (Static) to 12 (Dynamic)
      newItems.push({ tag: '01', value: '12' });
      tag01Found = true;
    } else if (item.tag === '54') {
      // Update transaction amount tag
      newItems.push({ tag: '54', value: amountStr });
      tag54Found = true;
    } else {
      newItems.push({ tag: item.tag, value: item.value });
    }
  }

  // If Tag 01 wasn't found, insert it after Tag 00
  if (!tag01Found) {
    const idx00 = newItems.findIndex(i => i.tag === '00');
    const insertIdx = idx00 !== -1 ? idx00 + 1 : 0;
    newItems.splice(insertIdx, 0, { tag: '01', value: '12' });
  }

  // If Tag 54 wasn't found, insert it directly AFTER Tag 53 (Transaction Currency)
  if (!tag54Found) {
    const idx53 = newItems.findIndex(i => i.tag === '53');
    if (idx53 !== -1) {
      newItems.splice(idx53 + 1, 0, { tag: '54', value: amountStr });
    } else {
      const idxNext = newItems.findIndex(i => i.tag === '58' || i.tag === '59' || i.tag === '60');
      const insertIdx = idxNext !== -1 ? idxNext : newItems.length;
      newItems.splice(insertIdx, 0, { tag: '54', value: amountStr });
    }
  }

  // Rebuild string without CRC
  const payloadToCrc = buildTLV(newItems) + '6304';
  
  // Calculate new CRC16
  const crc = calcCRC16(payloadToCrc);

  return `${payloadToCrc}${crc}`;
}

module.exports = {
  sanitizeQrisString,
  convertStaticToDynamic
};
