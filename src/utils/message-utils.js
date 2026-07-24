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
    const pure = normalizePhoneNumber(user);
    return pure ? `${pure}@s.whatsapp.net` : user.toLowerCase();
  }

  domain = domain.toLowerCase();
  if (domain === 'c.us') domain = 's.whatsapp.net';

  return `${user}@${domain}`.toLowerCase();
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

// Bi-directional LID <-> Phone Number JID Map
const lidToPnMap = new Map();
const pnToLidMap = new Map();

function registerJidPair(jid1, jid2) {
  if (!jid1 || !jid2) return;
  const clean1 = cleanJid(jid1);
  const clean2 = cleanJid(jid2);
  if (clean1 === clean2) return;

  if (clean1.endsWith('@lid') && clean2.endsWith('@s.whatsapp.net')) {
    lidToPnMap.set(clean1, clean2);
    pnToLidMap.set(clean2, clean1);
  } else if (clean2.endsWith('@lid') && clean1.endsWith('@s.whatsapp.net')) {
    lidToPnMap.set(clean2, clean1);
    pnToLidMap.set(clean1, clean2);
  }
}

function hasJidPair(jid) {
  const clean = cleanJid(jid);
  return lidToPnMap.has(clean) || pnToLidMap.has(clean);
}

function getAlternateJid(jid) {
  const clean = cleanJid(jid);
  if (clean.endsWith('@lid')) {
    return lidToPnMap.get(clean) || null;
  }
  if (clean.endsWith('@s.whatsapp.net')) {
    return pnToLidMap.get(clean) || null;
  }
  return null;
}

/**
 * Resolves a JID to a deliverable WhatsApp destination JID
 * Groups (g.us) remain untouched. User DMs with @lid are mapped to @s.whatsapp.net.
 */
function getDeliverableJid(jid) {
  if (!jid) return '';
  const cleaned = cleanJid(jid);
  if (cleaned.endsWith('@g.us')) return cleaned;

  if (cleaned.endsWith('@lid')) {
    const alt = getAlternateJid(cleaned);
    if (alt && alt.endsWith('@s.whatsapp.net')) {
      return alt;
    }
  }
  return cleaned;
}

function resolveAllJids(jid) {
  if (!jid) return [];
  const clean = cleanJid(jid);
  const alt = getAlternateJid(clean);
  if (alt) {
    return [clean, alt];
  }
  return [clean];
}

/**
 * Resolves LID <-> PN pair on WhatsApp servers via onWhatsApp query
 */
async function resolveJidOnWhatsApp(sock, jidOrPhone) {
  if (!sock || !jidOrPhone) return null;
  try {
    const clean = cleanJid(jidOrPhone);
    const pure = getPureNumber(clean);
    if (!pure) return null;

    const results = await sock.onWhatsApp(pure);
    if (results && results.length > 0) {
      for (const res of results) {
        const pnJid = cleanJid(res.jid);
        const lidJid = res.lid ? cleanJid(res.lid) : '';
        if (pnJid && lidJid) {
          registerJidPair(pnJid, lidJid);
          return { pnJid, lidJid };
        } else if (pnJid) {
          return { pnJid, lidJid: '' };
        }
      }
    }
  } catch (e) {
    // Ignore transient onWhatsApp resolution errors
  }
  return null;
}

/**
 * Extracts all possible sender JID identifiers from Baileys message object
 * Supports both @lid and @s.whatsapp.net, participant, authorPn, etc.
 */
function extractAllSenderJids(msg, senderJid) {
  const set = new Set();

  if (senderJid) {
    for (const r of resolveAllJids(senderJid)) {
      set.add(r);
    }
  }

  if (msg && msg.key) {
    if (msg.key.remoteJid) {
      for (const r of resolveAllJids(msg.key.remoteJid)) set.add(r);
    }
    if (msg.key.participant) {
      for (const r of resolveAllJids(msg.key.participant)) set.add(r);
    }
    if (msg.key.authorPn) {
      for (const r of resolveAllJids(msg.key.authorPn)) set.add(r);
    }
    if (msg.key.participantAlt) {
      for (const r of resolveAllJids(msg.key.participantAlt)) set.add(r);
    }
    if (msg.key.remoteJidAlt) {
      for (const r of resolveAllJids(msg.key.remoteJidAlt)) set.add(r);
    }
  }

  const realMsg = getRealMessage(msg?.message);
  if (realMsg) {
    for (const sub of Object.values(realMsg)) {
      if (sub && sub.contextInfo) {
        if (sub.contextInfo.participant) {
          for (const r of resolveAllJids(sub.contextInfo.participant)) set.add(r);
        }
      }
    }
  }

  return Array.from(set).filter(Boolean);
}

/**
 * Sanitizes a mentions array to ensure all JIDs are valid @s.whatsapp.net JIDs
 */
function sanitizeMentions(mentions) {
  if (!Array.isArray(mentions)) return [];
  const result = [];
  for (const m of mentions) {
    if (!m) continue;
    const deliverable = getDeliverableJid(m);
    if (deliverable && deliverable.endsWith('@s.whatsapp.net')) {
      result.push(deliverable);
    }
  }
  return Array.from(new Set(result));
}

/**
 * Sanitizes quoted message object so remoteJid & participant match deliverable JIDs
 */
function sanitizeQuotedMessage(quotedMsg, targetJid) {
  if (!quotedMsg || !quotedMsg.key) return quotedMsg;

  const deliverableTarget = getDeliverableJid(targetJid);
  const clonedKey = { ...quotedMsg.key };

  if (deliverableTarget.endsWith('@g.us')) {
    clonedKey.remoteJid = deliverableTarget;
    if (clonedKey.participant) {
      clonedKey.participant = getDeliverableJid(clonedKey.participant);
    }
  } else {
    clonedKey.remoteJid = deliverableTarget;
    if (clonedKey.participant) {
      delete clonedKey.participant;
    }
  }

  return {
    ...quotedMsg,
    key: clonedKey
  };
}

/**
 * Sends WhatsApp message safely with target resolution, quoted key sanitization & mention validation
 */
async function safeSendMessage(sock, targetJid, content, options = {}) {
  if (!sock || !targetJid) return null;

  // 1. Resolve deliverable target JID (convert @lid -> @s.whatsapp.net for DMs)
  let deliverableTarget = getDeliverableJid(targetJid);

  // If target is @lid and not resolved in memory yet, attempt onWhatsApp resolution
  if (deliverableTarget.endsWith('@lid')) {
    const resolved = await resolveJidOnWhatsApp(sock, deliverableTarget);
    if (resolved && resolved.pnJid) {
      deliverableTarget = resolved.pnJid;
    }
  }

  // 2. Clone and sanitize content & options
  const sendContent = { ...content };
  const sendOptions = { ...options };

  if (sendContent.mentions) {
    sendContent.mentions = sanitizeMentions(sendContent.mentions);
  }

  if (sendOptions.quoted) {
    sendOptions.quoted = sanitizeQuotedMessage(sendOptions.quoted, deliverableTarget);
  }

  try {
    const sentMsg = await sock.sendMessage(deliverableTarget, sendContent, sendOptions);
    return sentMsg;
  } catch (err) {
    console.error(`⚠️ Failed to send message to ${deliverableTarget}:`, err.message);
    throw err;
  }
}

module.exports = {
  getRealMessage,
  getTextFromMessage,
  cleanJid,
  normalizePhoneNumber,
  getPureNumber,
  registerJidPair,
  hasJidPair,
  getAlternateJid,
  getDeliverableJid,
  resolveAllJids,
  resolveJidOnWhatsApp,
  extractAllSenderJids,
  sanitizeMentions,
  sanitizeQuotedMessage,
  safeSendMessage
};
