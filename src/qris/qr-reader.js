const { Jimp } = require('jimp');
const jsQR = require('jsqr');

/**
 * Decodes QR Code payload from an image Buffer
 * @param {Buffer} imageBuffer 
 * @returns {Promise<string|null>} QR code content string or null if not found
 */
async function decodeQRFromBuffer(imageBuffer) {
  try {
    const image = await Jimp.read(imageBuffer);
    const width = image.bitmap.width;
    const height = image.bitmap.height;
    const bufferData = new Uint8ClampedArray(image.bitmap.data);
    
    const code = jsQR(bufferData, width, height, {
      inversionAttempts: 'dontInvert'
    });

    if (code && code.data) {
      return code.data;
    }
    return null;
  } catch (err) {
    console.error('Error decoding QR image:', err.message);
    return null;
  }
}

module.exports = {
  decodeQRFromBuffer
};
