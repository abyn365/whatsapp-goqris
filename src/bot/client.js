const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const qrcode = require('qrcode-terminal');
const pino = require('pino');
const path = require('path');
const { handleIncomingMessage } = require('./message-handler');

const AUTH_DIR = path.join(process.cwd(), 'data', 'auth_info_baileys');

async function startWhatsAppBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`🚀 Starting WhatsApp QRIS Bot with Baileys v${version.join('.')}...`);

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    generateHighQualityLinkPreview: true
  });

  // Handle credentials update
  sock.ev.on('creds.update', saveCreds);

  // Handle connection state changes
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n======================================================');
      console.log('📲 SCAN QR CODE INI MENGGUNAKAN WHATSAPP DI HP ANDA:');
      console.log('======================================================\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
      console.log('⚠️ Connection closed due to:', lastDisconnect?.error, ', reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(startWhatsAppBot, 3000);
      }
    } else if (connection === 'open') {
      console.log('✅ WhatsApp Bot successfully connected and online!');
    }
  });

  // Handle incoming messages
  sock.ev.on('messages.upsert', async (m) => {
    if (m.type === 'notify') {
      for (const msg of m.messages) {
        if (!msg.key.fromMe) {
          try {
            await handleIncomingMessage(sock, msg);
          } catch (err) {
            console.error('Error handling message:', err);
          }
        }
      }
    }
  });

  return sock;
}

module.exports = {
  startWhatsAppBot
};
