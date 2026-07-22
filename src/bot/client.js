const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const qrcode = require('qrcode-terminal');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const { handleIncomingMessage } = require('./message-handler');

const AUTH_DIR = path.join(process.cwd(), 'data', 'auth_info_baileys');

// Suppress Baileys internal signal debug logs ("Closing session: SessionEntry ...")
const originalConsoleLog = console.log;
console.log = function (...args) {
  if (typeof args[0] === 'string' && args[0].startsWith('Closing session:')) {
    return;
  }
  originalConsoleLog.apply(console, args);
};

let currentSock = null;

async function startWhatsAppBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`🚀 Starting WhatsApp QRIS Bot with Baileys v${version.join('.')}...`);

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
    getMessage: async (key) => {
      return { conversation: '' };
    }
  });

  currentSock = sock;

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
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = (statusCode === DisconnectReason.loggedOut || statusCode === 401);
      console.log(`⚠️ Connection closed (statusCode: ${statusCode}). Logged Out: ${isLoggedOut}...`);
      
      try {
        sock.ev.removeAllListeners();
      } catch (e) {}

      if (isLoggedOut) {
        console.log('🔒 WhatsApp Session Logged Out / Invalidated (401). Clearing auth directory and restarting to generate new QR Code...');
        try {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        } catch (e) {
          console.error('Failed to clear auth directory:', e.message);
        }
        setTimeout(startWhatsAppBot, 2000);
      } else {
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
        try {
          await handleIncomingMessage(sock, msg);
        } catch (err) {
          console.error('Error processing incoming message:', err);
        }
      }
    }
  });

  return sock;
}

module.exports = {
  startWhatsAppBot
};
