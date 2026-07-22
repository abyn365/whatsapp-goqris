require('dotenv').config();
const { startWhatsAppBot } = require('./bot/client');

console.log('======================================================');
console.log('       INDONESIA DYNAMIC QRIS WHATSAPP BOT            ');
console.log('======================================================');

startWhatsAppBot().catch(err => {
  console.error('Fatal error starting WhatsApp Bot:', err);
  process.exit(1);
});
