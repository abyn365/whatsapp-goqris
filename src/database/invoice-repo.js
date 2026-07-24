const db = require('./db');
const { cleanJid, getPureNumber, normalizePhoneNumber, extractAllSenderJids } = require('../utils/message-utils');

// Dynamic cache of recognized admin JIDs (auto-learned from admin interactions)
const dynamicAdminJidMap = new Set();

/**
 * Memeriksa apakah JID pengirim cocok dengan daftar Admin
 * Mendukung format @lid, @s.whatsapp.net, maupun nomor telepon biasa
 */
function isAdmin(senderJid, msg = null) {
  const adminRaw = process.env.ADMIN_JID || process.env.ADMIN_NUMBER || '';
  if (!adminRaw && dynamicAdminJidMap.size === 0) return false;

  const candidateJids = extractAllSenderJids(msg, senderJid);
  const adminList = adminRaw.split(',').map(a => a.trim()).filter(Boolean);

  const adminSet = new Set();
  const adminPureSet = new Set();

  for (const item of adminList) {
    const cleaned = cleanJid(item);
    const pure = getPureNumber(item);
    if (cleaned) adminSet.add(cleaned);
    if (pure) adminPureSet.add(pure);
  }

  for (const dynJid of dynamicAdminJidMap) {
    adminSet.add(dynJid);
    const pure = getPureNumber(dynJid);
    if (pure) adminPureSet.add(pure);
  }

  let matched = false;
  for (const candidate of candidateJids) {
    const pure = getPureNumber(candidate);
    if (adminSet.has(candidate) || (pure && adminPureSet.has(pure))) {
      matched = true;
      break;
    }
  }

  // If matched, dynamically auto-learn all JID representations (@lid and @s.whatsapp.net)
  if (matched) {
    for (const candidate of candidateJids) {
      if (candidate && !candidate.endsWith('@g.us')) {
        dynamicAdminJidMap.add(candidate);
      }
    }
  }

  return matched;
}

/**
 * Get primary single Admin JID for sending notifications (strictly 1 destination to prevent duplicate deliveries)
 * Auto-resolves between preferred active JID (@lid or @s.whatsapp.net) and configured ADMIN_JID
 */
function getAdminJid(preferredJid = '') {
  if (preferredJid && isAdmin(preferredJid)) {
    return cleanJid(preferredJid);
  }

  if (dynamicAdminJidMap.size > 0) {
    const learnedList = Array.from(dynamicAdminJidMap);
    const latest = learnedList[learnedList.length - 1];
    if (latest) return cleanJid(latest);
  }

  const adminRaw = process.env.ADMIN_JID || process.env.ADMIN_NUMBER || '';
  if (!adminRaw) return '';

  const firstAdmin = adminRaw.split(',')[0].trim();
  return cleanJid(firstAdmin);
}

/**
 * Get unique admin destinations
 */
function getUniqueAdminJids() {
  const primary = getAdminJid();
  return primary ? [primary] : [];
}

/**
 * Generate unique Invoice Number (e.g. INV-20260722-0001)
 */
function generateInvoiceNumber() {
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM invoices WHERE invoice_number LIKE ?
  `).get(`INV-${dateStr}-%`);

  const count = row ? Number(row.count) : 0;
  const nextSeq = count + 1;
  const seqStr = String(nextSeq).padStart(4, '0');
  return `INV-${dateStr}-${seqStr}`;
}

/**
 * Format local date time string in WIB / local standard format
 */
function getCurrentFormattedTimestamp() {
  const now = new Date();
  const date = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const hours = String(now.getHours()).padStart(2, '0');
  const mins = String(now.getMinutes()).padStart(2, '0');
  const secs = String(now.getSeconds()).padStart(2, '0');
  return `${date}/${month}/${year} ${hours}:${mins}:${secs} WIB`;
}

/**
 * Create a new invoice record
 */
function createInvoice({
  customerJid,
  customerName,
  chatJid,
  isGroup = false,
  amount,
  itemsSummary = '',
  notes = '',
  qrisPayload = ''
}) {
  const invoiceNumber = generateInvoiceNumber();
  const createdAt = getCurrentFormattedTimestamp();
  const pureNum = getPureNumber(customerJid);

  const stmt = db.prepare(`
    INSERT INTO invoices (
      invoice_number, customer_jid, customer_name, chat_jid, is_group,
      amount, items_summary, notes, qris_payload, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
  `);

  const result = stmt.run(
    invoiceNumber,
    customerJid,
    customerName || pureNum,
    chatJid,
    isGroup ? 1 : 0,
    amount,
    itemsSummary,
    notes,
    qrisPayload,
    createdAt
  );

  const lastId = Number(result.lastInsertRowid);
  return getInvoiceById(lastId);
}

/**
 * Save Customer Message Key for editing/updates
 */
function saveCustomerMsgKey(id, msgKey) {
  const keyStr = typeof msgKey === 'object' ? JSON.stringify(msgKey) : String(msgKey);
  return db.prepare('UPDATE invoices SET customer_msg_key = ? WHERE id = ?').run(keyStr, Number(id));
}

/**
 * Save Admin Message Key for editing/updates
 */
function saveAdminMsgKey(id, msgKey) {
  const keyStr = typeof msgKey === 'object' ? JSON.stringify(msgKey) : String(msgKey);
  return db.prepare('UPDATE invoices SET admin_msg_key = ? WHERE id = ?').run(keyStr, Number(id));
}

/**
 * Get invoice by ID
 */
function getInvoiceById(id) {
  return db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(id));
}

/**
 * Get invoice by Invoice Number (supports both 'INV-20260722-0001' and '20260722-0001')
 */
function getInvoiceByNumber(inputStr) {
  if (!inputStr) return null;
  let cleanInput = String(inputStr).trim().toUpperCase();

  if (!cleanInput.startsWith('INV-')) {
    cleanInput = `INV-${cleanInput}`;
  }

  return db.prepare('SELECT * FROM invoices WHERE UPPER(invoice_number) = UPPER(?)').get(cleanInput);
}

/**
 * Get active/latest pending invoice specifically for a user (matching user ID / JID)
 */
function getPendingInvoiceForUser(customerJid, chatJid) {
  const pureUser = getPureNumber(customerJid);
  const cleanUser = cleanJid(customerJid);

  const rows = db.prepare(`
    SELECT * FROM invoices 
    WHERE status IN ('PENDING', 'PROOF_SUBMITTED', 'REJECTED')
    ORDER BY id DESC
  `).all();

  for (const row of rows) {
    if (cleanJid(row.customer_jid) === cleanUser && (row.chat_jid === chatJid || !chatJid)) {
      return row;
    }
  }

  for (const row of rows) {
    if (getPureNumber(row.customer_jid) === pureUser || cleanJid(row.customer_jid) === cleanUser) {
      return row;
    }
  }

  return null;
}

/**
 * List active and rejected invoices (PENDING, PROOF_SUBMITTED, REJECTED)
 */
function getActiveAndRejectedInvoices({ limit = 30 } = {}) {
  const lim = Number(limit);
  return db.prepare(`
    SELECT * FROM invoices 
    WHERE status IN ('PENDING', 'PROOF_SUBMITTED', 'REJECTED')
    ORDER BY id DESC LIMIT ?
  `).all(lim);
}

/**
 * Update invoice payment proof
 */
function updateInvoiceProof(id, proofImagePath) {
  return db.prepare(`
    UPDATE invoices 
    SET proof_image_path = ?, status = 'PROOF_SUBMITTED' 
    WHERE id = ?
  `).run(proofImagePath, Number(id));
}

/**
 * Mark invoice as paid
 */
function markInvoicePaid(id) {
  const paidAt = getCurrentFormattedTimestamp();
  return db.prepare(`
    UPDATE invoices 
    SET status = 'PAID', paid_at = ? 
    WHERE id = ?
  `).run(paidAt, Number(id));
}

/**
 * Reject invoice payment proof with a reason
 */
function rejectInvoiceProof(id, reason) {
  const rejectionReason = reason || 'Bukti transfer tidak valid atau tidak terlihat jelas';
  return db.prepare(`
    UPDATE invoices 
    SET status = 'REJECTED', rejection_reason = ? 
    WHERE id = ?
  `).run(rejectionReason, Number(id));
}

/**
 * List recent invoices with optional limit & status filter
 */
function listInvoices({ limit = 10, status = null } = {}) {
  const lim = Number(limit);
  if (status) {
    return db.prepare(`
      SELECT * FROM invoices WHERE status = ? ORDER BY id DESC LIMIT ?
    `).all(status, lim);
  }
  return db.prepare(`
    SELECT * FROM invoices ORDER BY id DESC LIMIT ?
  `).all(lim);
}

/**
 * Get store revenue & status statistics
 */
function getInvoiceStats() {
  const totalRow = db.prepare('SELECT COUNT(*) as count FROM invoices').get();
  const totalInvoices = totalRow ? Number(totalRow.count) : 0;

  const paidStats = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total_revenue 
    FROM invoices WHERE status = 'PAID'
  `).get();

  const pendingRow = db.prepare(`
    SELECT COUNT(*) as count FROM invoices WHERE status IN ('PENDING', 'PROOF_SUBMITTED', 'REJECTED')
  `).get();

  return {
    totalInvoices,
    paidInvoices: paidStats ? Number(paidStats.count) : 0,
    totalRevenue: paidStats ? Number(paidStats.total_revenue) : 0,
    pendingInvoices: pendingRow ? Number(pendingRow.count) : 0
  };
}

/**
 * Get App Configuration value
 */
function getConfig(key, defaultValue = '') {
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

/**
 * Set App Configuration value
 */
function setConfig(key, value) {
  const existing = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key);
  if (existing) {
    return db.prepare('UPDATE app_config SET value = ? WHERE key = ?').run(value, key);
  } else {
    return db.prepare('INSERT INTO app_config (key, value) VALUES (?, ?)').run(key, value);
  }
}

module.exports = {
  cleanJid,
  getPureNumber,
  isAdmin,
  getAdminJid,
  getUniqueAdminJids,
  generateInvoiceNumber,
  getCurrentFormattedTimestamp,
  createInvoice,
  saveCustomerMsgKey,
  saveAdminMsgKey,
  getInvoiceById,
  getInvoiceByNumber,
  getPendingInvoiceForUser,
  getActiveAndRejectedInvoices,
  updateInvoiceProof,
  markInvoicePaid,
  rejectInvoiceProof,
  listInvoices,
  getInvoiceStats,
  getConfig,
  setConfig
};
