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
 * Strips device ID and normalizes domain from WhatsApp JID
 * Examples:
 * - 197341567021139:45@lid -> 197341567021139@lid
 * - 628123456789:12@s.whatsapp.net -> 628123456789@s.whatsapp.net
 * - 628123456789@c.us -> 628123456789@s.whatsapp.net
 */
function cleanJid(jid) {
  if (!jid) return '';
  const raw = String(jid).trim();
  let [userAndDevice, domain] = raw.split('@');
  const user = userAndDevice.split(':')[0];

  if (!domain) {
    // Check if user is pure number (e.g. 0812... or 62812...)
    const pure = normalizePhoneNumber(user);
    return pure ? `${pure}@s.whatsapp.net` : user.toLowerCase();
  }

  domain = domain.toLowerCase();
  if (domain === 'c.us') domain = 's.whatsapp.net';

  return `${user}@${domain}`.toLowerCase();
}

/**
 * Normalizes phone numbers (converts 08xxx to 628xxx)
 */
function normalizePhoneNumber(str) {
  if (!str) return '';
  let digits = String(str).replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('08')) {
    digits = '62' + digits.slice(1);
  } else if (digits.startsWith('8') && digits.length >= 9 && digits.length <= 13) {
    digits = '62' + digits;
  }
  return digits;
}

/**
 * Extract digits/pure number representation of a JID or phone string
 */
function getPureNumber(jidOrPhone) {
  if (!jidOrPhone) return '';
  const cleaned = cleanJid(jidOrPhone);
  const userPart = cleaned.split('@')[0];
  return normalizePhoneNumber(userPart);
}

/**
 * Extracts all possible sender JID identifiers from Baileys message object
 * Supports both @lid and @s.whatsapp.net, participant, authorPn, etc.
 */
function extractAllSenderJids(msg, senderJid) {
  const set = new Set();

  if (senderJid) {
    set.add(cleanJid(senderJid));
  }

  if (msg && msg.key) {
    if (msg.key.remoteJid) set.add(cleanJid(msg.key.remoteJid));
    if (msg.key.participant) set.add(cleanJid(msg.key.participant));
    if (msg.key.authorPn) set.add(cleanJid(msg.key.authorPn));
    if (msg.key.participantAlt) set.add(cleanJid(msg.key.participantAlt));
    if (msg.key.remoteJidAlt) set.add(cleanJid(msg.key.remoteJidAlt));
  }

  return Array.from(set).filter(Boolean);
}

module.exports = {
  getRealMessage,
  getTextFromMessage,
  cleanJid,
  normalizePhoneNumber,
  getPureNumber,
  extractAllSenderJids
};
