const {
  handleQrisCommand,
  handleInvoiceCommand,
  handleStatusCommand,
  handleHistoryCommand,
  handleMarkPaidCommand,
  handleStatsCommand,
  handleSetQrisCommand,
  handleHelpCommand
} = require('./commands');

const { handlePaymentProof } = require('./proof-handler');

const BOT_PREFIX = process.env.BOT_PREFIX || '!';

/**
 * Unwraps nested message structures (ephemeral, viewOnce, documentWithCaption, etc.)
 */
function getRealMessage(message) {
  if (!message) return null;
  let m = message;
  if (m.ephemeralMessage) m = m.ephemeralMessage.message;
  if (m.viewOnceMessage) m = m.viewOnceMessage.message;
  if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
  if (m.viewOnceMessageV2Extension) m = m.viewOnceMessageV2Extension.message;
  if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
  return m;
}

/**
 * Extracts text content from any message object
 */
function getTextFromMessage(m) {
  if (!m) return '';
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage && m.extendedTextMessage.text) return m.extendedTextMessage.text;
  if (m.imageMessage && m.imageMessage.caption) return m.imageMessage.caption;
  if (m.videoMessage && m.videoMessage.caption) return m.videoMessage.caption;
  if (m.documentMessage && m.documentMessage.caption) return m.documentMessage.caption;
  return '';
}

/**
 * Parses and routes incoming WhatsApp messages
 */
async function handleIncomingMessage(sock, msg) {
  if (!msg || !msg.message) return;

  const chatJid = msg.key.remoteJid;
  // Ignore status broadcast updates
  if (!chatJid || chatJid === 'status@broadcast') return;

  const isGroup = chatJid.endsWith('@g.us');
  const customerJid = isGroup 
    ? (msg.key.participant || msg.key.remoteJid) 
    : (msg.key.fromMe ? (sock.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : chatJid) : chatJid);

  const customerName = msg.pushName || customerJid.split('@')[0];

  // Unwrap message content
  const realMessage = getRealMessage(msg.message);
  if (!realMessage) return;

  // Extract body text
  const bodyText = getTextFromMessage(realMessage);
  const trimmedText = bodyText.trim();

  // If message is sent by bot itself (fromMe):
  // Only process if it starts with BOT_PREFIX (allowing self-testing commands)
  if (msg.key.fromMe && !trimmedText.startsWith(BOT_PREFIX)) {
    return;
  }

  // Check if image upload is a payment proof (if image sent without prefix command)
  const isImage = !!realMessage.imageMessage;
  if (isImage && !trimmedText.startsWith(BOT_PREFIX) && !msg.key.fromMe) {
    console.log(`📸 [${isGroup ? 'GROUP' : 'DM'}] Foto diterima dari ${customerName} (${customerJid}), mengecek bukti transfer...`);
    const isProofProcessed = await handlePaymentProof(sock, msg, customerJid, chatJid, isGroup);
    if (isProofProcessed) return;
  }

  // Handle command prefix
  if (!trimmedText.startsWith(BOT_PREFIX)) {
    return;
  }

  console.log(`📩 [${isGroup ? 'GROUP' : 'DM'}] Perintah diterima dari ${customerName} (${customerJid}): "${trimmedText}"`);

  // Extract command name & arguments
  const args = trimmedText.slice(BOT_PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  switch (command) {
    case 'qris':
      await handleQrisCommand(sock, msg, args, customerJid, customerName, chatJid, isGroup);
      break;

    case 'invoice':
      await handleInvoiceCommand(sock, msg, args, customerJid, customerName, chatJid, isGroup);
      break;

    case 'status':
      await handleStatusCommand(sock, msg, args, customerJid, chatJid);
      break;

    case 'history':
    case 'riwayat':
      await handleHistoryCommand(sock, msg, args, customerJid, chatJid);
      break;

    case 'markpaid':
    case 'lunas':
      await handleMarkPaidCommand(sock, msg, args, customerJid, chatJid);
      break;

    case 'stats':
    case 'omset':
      await handleStatsCommand(sock, msg, customerJid, chatJid);
      break;

    case 'setqris':
      await handleSetQrisCommand(sock, msg, args, customerJid, chatJid);
      break;

    case 'help':
    case 'bantuan':
    case 'menu':
      await handleHelpCommand(sock, msg, customerJid, chatJid);
      break;

    default:
      console.log(`❓ Perintah tidak dikenal: ${command}`);
      break;
  }
}

module.exports = {
  handleIncomingMessage,
  getRealMessage,
  getTextFromMessage
};
