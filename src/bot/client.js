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
const { resolveJidOnWhatsApp, cleanJid } = require('../utils/message-utils');

const AUTH_DIR = path.join(process.cwd(), 'data', 'auth_info_baileys');

// Suppress Baileys internal noisy signal/decryption debug logs
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = function (...args) {
  if (typeof args[0] === 'string' && (
    args[0].includes('Closing session') ||
    args[0].includes('Closing open session') ||
    args[0].includes('SessionEntry') ||
    args[0].includes('Failed to decrypt message') ||
    args[0].includes('Bad MAC')
  )) {
    return;
  }
  originalConsoleLog.apply(console, args);
};

console.error = function (...args) {
  if (typeof args[0] === 'string' && (
    args[0].includes('Closing session') ||
    args[0].includes('Closing open session') ||
    args[0].includes('SessionEntry') ||
    args[0].includes('Bad MAC') ||
    args[0].includes('Failed to decrypt message') ||
    args[0].includes('Session error')
  )) {
    return;
  }
  originalConsoleError.apply(console, args);
};

let currentSock = null;
let watchdogInterval = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let lastActivityTime = Date.now();

// In-memory message store to answer WhatsApp server retries & prevent session key corruption
const messageStore = new Map();
const MAX_STORE_SIZE = 2000;

function storeMessage(msg) {
  if (!msg || !msg.key || !msg.key.id || !msg.key.remoteJid) return;
  const keyStr = `${msg.key.remoteJid}_${msg.key.id}`;
  messageStore.set(keyStr, msg.message);

  if (messageStore.size > MAX_STORE_SIZE) {
    const firstKey = messageStore.keys().next().value;
    if (firstKey) messageStore.delete(firstKey);
  }
}

function getStoredMessage(key) {
  if (!key || !key.id || !key.remoteJid) return null;
  const keyStr = `${key.remoteJid}_${key.id}`;
  return messageStore.get(keyStr) || null;
}

/**
 * Resolves all configured Admin numbers on startup to link PN <-> LID JIDs
 */
async function resolveAdminJids(sock) {
  const adminRaw = process.env.ADMIN_JID || process.env.ADMIN_NUMBER || '';
  if (!adminRaw || !sock) return;

  const adminList = adminRaw.split(',').map(a => a.trim()).filter(Boolean);
  for (const item of adminList) {
    try {
      const res = await resolveJidOnWhatsApp(sock, item);
      if (res && res.pnJid && res.lidJid) {
        console.log(`🔗 [ADMIN LINK] Successfully registered Admin PN (${res.pnJid}) <-> LID (${res.lidJid})`);
      }
    } catch (e) {}
  }
}

/**
 * Cleanly closes existing socket connection & clears active timers
 */
function cleanupSocket() {
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (currentSock) {
    try {
      currentSock.ev.removeAllListeners();
    } catch (e) {}
    try {
      if (currentSock.ws && typeof currentSock.ws.close === 'function') {
        currentSock.ws.close();
      }
    } catch (e) {}
    currentSock = null;
  }
}

async function startWhatsAppBot() {
  cleanupSocket();

  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

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
    markOnlineOnConnect: true,
    keepAliveIntervalMs: 25000, // Send WS ping every 25 seconds for persistent connection
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: undefined,
    retryRequestDelayMs: 500,
    maxMsgRetryCount: 5,
    getMessage: async (key) => {
      const stored = getStoredMessage(key);
      if (stored) return stored;
      return { conversation: '' };
    }
  });

  currentSock = sock;
  lastActivityTime = Date.now();

  // Save authentication credentials on update
  sock.ev.on('creds.update', saveCreds);

  // Connection state management
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    lastActivityTime = Date.now();

    if (qr) {
      console.log('\n======================================================');
      console.log('📲 SCAN QR CODE INI MENGGUNAKAN WHATSAPP DI HP ANDA:');
      console.log('======================================================\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = (statusCode === DisconnectReason.loggedOut || statusCode === 401);
      const isRestartRequired = (statusCode === DisconnectReason.restartRequired || statusCode === 515);

      console.log(`⚠️ Connection closed (statusCode: ${statusCode}). Logged Out: ${isLoggedOut}...`);

      cleanupSocket();

      if (isLoggedOut) {
        console.log('🔒 WhatsApp Session Logged Out / Invalidated (401). Clearing auth directory and restarting to generate new QR Code...');
        reconnectAttempts = 0;
        try {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        } catch (e) {
          console.error('Failed to clear auth directory:', e.message);
        }
        reconnectTimer = setTimeout(startWhatsAppBot, 2000);
      } else if (isRestartRequired) {
        console.log('🔄 Restart required by WhatsApp server (515). Reconnecting immediately...');
        reconnectTimer = setTimeout(startWhatsAppBot, 1000);
      } else {
        reconnectAttempts++;
        const backoffDelay = Math.min(30000, Math.max(2000, 1500 * Math.pow(1.4, reconnectAttempts)));
        console.log(`📡 Reconnecting automatically in ${(backoffDelay / 1000).toFixed(1)}s (Attempt #${reconnectAttempts})...`);
        reconnectTimer = setTimeout(startWhatsAppBot, backoffDelay);
      }
    } else if (connection === 'open') {
      reconnectAttempts = 0;
      console.log('✅ WhatsApp Bot successfully connected and 100% online!');
      resolveAdminJids(sock).catch(err => {
        console.error('Error resolving admin JIDs on connect:', err.message);
      });
    }
  });

  // Incoming message processing & store caching
  sock.ev.on('messages.upsert', async (m) => {
    lastActivityTime = Date.now();
    if (m.messages) {
      for (const msg of m.messages) {
        storeMessage(msg);
      }
    }

    if (m.type === 'notify' || m.type === 'append') {
      for (const msg of m.messages) {
        try {
          await handleIncomingMessage(sock, msg);
        } catch (err) {
          console.error('Error processing incoming message:', err);
        }
      }
    }
  });

  // Watchdog Health Check Timer (checks every 45 seconds)
  watchdogInterval = setInterval(() => {
    if (!currentSock) return;

    const isWsClosed = currentSock.ws && (currentSock.ws.readyState === 2 || currentSock.ws.readyState === 3);
    const inactiveDuration = Date.now() - lastActivityTime;

    // If WS is closed or frozen with no ping activity for over 3 minutes, force reconnect
    if (isWsClosed || inactiveDuration > 180000) {
      console.log(`🐕 Watchdog: Connection frozen or closed (inactive for ${(inactiveDuration / 1000).toFixed(0)}s). Forcing clean reconnect...`);
      startWhatsAppBot();
    }
  }, 45000);

  return sock;
}

module.exports = {
  startWhatsAppBot,
  getCurrentSock: () => currentSock
};
