const {
  handleQrisCommand,
  handleInvoiceCommand,
  handleStatusCommand,
  handleRecapCommand,
  handleHistoryCommand,
  handleMarkPaidCommand,
  handleRejectCommand,
  handleStatsCommand,
  handleSetQrisCommand,
  handleHelpCommand
} = require('./commands');

const { handlePaymentProof } = require('./proof-handler');
const {
  getRealMessage,
  getTextFromMessage,
  cleanJid,
  hasJidPair,
  resolveJidOnWhatsApp,
  extractAndRegisterJidPairs
} = require('../utils/message-utils');

const BOT_PREFIX = process.env.BOT_PREFIX || '!';

// Message deduplication cache with timestamp TTL
const processedMessageMap = new Map();

function isDuplicateMessage(msgId) {
  if (!msgId) return false;
  const now = Date.now();
  if (processedMessageMap.has(msgId)) {
    return true;
  }
  processedMessageMap.set(msgId, now);

  // Evict items older than 10 minutes
  if (processedMessageMap.size > 1000) {
    for (const [id, time] of processedMessageMap.entries()) {
      if (now - time > 600000) {
        processedMessageMap.delete(id);
      }
    }
  }
  return false;
}

/**
 * Parses and routes incoming WhatsApp messages
 */
async function handleIncomingMessage(sock, msg) {
  if (!msg || !msg.message || !msg.key || !msg.key.id) return;

  // Extract and register any JID pair (@lid <-> @s.whatsapp.net) present in incoming message metadata
  extractAndRegisterJidPairs(msg);

  const rawChatJid = msg.key.remoteJid;
  // Ignore status broadcast updates
  if (!rawChatJid || rawChatJid === 'status@broadcast') return;

  const chatJid = cleanJid(rawChatJid);
  const isGroup = chatJid.endsWith('@g.us');

  let rawCustomerJid = isGroup ? (msg.key.participant || rawChatJid) : rawChatJid;
  if (msg.key.fromMe && !isGroup) {
    rawCustomerJid = sock.user?.id || rawChatJid;
  }

  const customerJid = cleanJid(rawCustomerJid);
  const customerName = msg.pushName || customerJid.split('@')[0];

  // Resolve customer JID LID <-> PN pair on WhatsApp servers if not mapped yet
  if (customerJid && !hasJidPair(customerJid)) {
    resolveJidOnWhatsApp(sock, customerJid).catch(() => {});
  }

  // Unwrap message content
  const realMessage = getRealMessage(msg.message);
  if (!realMessage) return;

  // Extract body text
  const bodyText = getTextFromMessage(realMessage);
  const trimmedText = bodyText.trim();
  const isImage = !!realMessage.imageMessage;

  // Only process prefix commands or image proofs
  if (!trimmedText.startsWith(BOT_PREFIX) && !isImage) {
    return;
  }

  // If message is sent by bot itself (fromMe):
  // Only process if it starts with BOT_PREFIX (allowing self-testing commands)
  if (msg.key.fromMe && !trimmedText.startsWith(BOT_PREFIX)) {
    return;
  }

  // Deduplicate AFTER confirming it is a processable command or proof
  const msgId = msg.key.id;
  if (isDuplicateMessage(msgId)) {
    return;
  }

  // Check if image upload is a payment proof (if image sent without prefix command)
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

    case 'recap':
    case 'rekap':
      await handleRecapCommand(sock, msg, args, customerJid, chatJid);
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
