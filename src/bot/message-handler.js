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
 * Parses and routes incoming WhatsApp messages
 */
async function handleIncomingMessage(sock, msg) {
  if (!msg.message) return;

  // Ignore status broadcast updates
  if (msg.key.remoteJid === 'status@broadcast') return;

  // Extract JID & chat info
  const chatJid = msg.key.remoteJid;
  const isGroup = chatJid.endsWith('@g.us');
  const customerJid = isGroup ? (msg.key.participant || msg.key.remoteJid) : chatJid;
  const customerName = msg.pushName || customerJid.split('@')[0];

  // Extract text content from message
  const messageType = Object.keys(msg.message)[0];
  let bodyText = '';

  if (messageType === 'conversation') {
    bodyText = msg.message.conversation;
  } else if (messageType === 'extendedTextMessage') {
    bodyText = msg.message.extendedTextMessage.text;
  } else if (messageType === 'imageMessage') {
    bodyText = msg.message.imageMessage.caption || '';
  }

  const trimmedText = bodyText.trim();

  // Check if image upload is a payment proof (if image sent without command)
  if (messageType === 'imageMessage' && !trimmedText.startsWith(BOT_PREFIX)) {
    const isProofProcessed = await handlePaymentProof(sock, msg, customerJid, chatJid, isGroup);
    if (isProofProcessed) return;
  }

  // Handle command prefix
  if (!trimmedText.startsWith(BOT_PREFIX)) {
    return;
  }

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
      // Unknown command
      break;
  }
}

module.exports = {
  handleIncomingMessage
};
