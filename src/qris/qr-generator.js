const QRCode = require('qrcode');

/**
 * Generates a PNG Buffer for a given QRIS string
 * @param {string} qrisString 
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function generateQRBuffer(qrisString) {
  if (!qrisString) {
    throw new Error('QRIS string cannot be empty.');
  }

  const options = {
    errorCorrectionLevel: 'M',
    type: 'png',
    quality: 0.95,
    margin: 2,
    scale: 8,
    color: {
      dark: '#000000',
      light: '#FFFFFF'
    }
  };

  return await QRCode.toBuffer(qrisString, options);
}

module.exports = {
  generateQRBuffer
};
