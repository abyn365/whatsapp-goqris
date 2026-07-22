const {
  handleQrisCommand,
  handleInvoiceCommand,
  handleStatusCommand,
  handleHistoryCommand,
  handleMarkPaidCommand,
  handleRejectCommand,
  handleStatsCommand,
  handleSetQrisCommand,
  handleHelpCommand
} = require('./commands');

const { handlePaymentProof } = require('./proof-handler');
const { getRealMessage, getTextFromMessage } = require('../utils/message-utils');

const BOT_PREFIX = process.env.BOT_PREFIX || '!';

// Message deduplication cache
const processedMessageIds = new Set();

/**
 * Parses and routes incoming WhatsApp messages
 */
async function handleIncomingMessage(sock, msg) {
  if (!msg || !msg.message || !msg.key || !msg.key.id) return;

  const msgId = msg.key.id;
  if (processedMessageIds.has(msgId)) {
    return; // Skip duplicate event delivery
  }
  processedMessageIds.add(msgId);

  // Clean memory if cache grows large
  if (processedMessageIds.size > 1000) {
    const arr = Array.from(processedMessageIds);
    arr.slice(0, 500).forEach(id => processedMessageIds.delete(id));
  }

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

    case 'reject':
    case 'rejectproof':
    case 'tolak':
      await handleRejectCommand(sock, msg, args, customerJid, chatJid);
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
    case 'adminhelp':
      await handleHelpCommand(sock, msg, customerJid, chatJid);
      break;

    default:
      console.log(`❓ Perintah tidak dikenal: ${command}`);
      break;
  }
}

module.exports = {
  handleIncomingMessage
};
