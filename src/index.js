require('dotenv').config();
const { startWhatsAppBot } = require('./bot/client');

console.log('======================================================');
console.log('       INDONESIA DYNAMIC QRIS WHATSAPP BOT            ');
console.log('======================================================');

process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception detected:', err.message || err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Promise Rejection detected:', reason);
});

startWhatsAppBot().catch(err => {
  console.error('Fatal error starting WhatsApp Bot:', err);
  process.exit(1);
});
