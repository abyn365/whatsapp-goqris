/**
 * CRC16 CCITT (FALSE) Implementation for EMVCo / QRIS standard
 * Polynomial: 0x1021
 * Initial value: 0xFFFF
 */
function calcCRC16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    crc ^= (c << 8);
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Validates whether the given QRIS string has a valid CRC16 (Tag 63)
 */
function validateCRC16(qrisStr) {
  if (!qrisStr || qrisStr.length < 8) return false;
  const tag63Idx = qrisStr.lastIndexOf('6304');
  if (tag63Idx === -1) return false;

  const dataToCrc = qrisStr.substring(0, tag63Idx + 4);
  const expectedCrc = qrisStr.substring(tag63Idx + 4, tag63Idx + 8).toUpperCase();
  const calculatedCrc = calcCRC16(dataToCrc);

  return expectedCrc === calculatedCrc;
}

module.exports = {
  calcCRC16,
  validateCRC16
};
