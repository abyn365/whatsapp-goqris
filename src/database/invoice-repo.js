const db = require('./db');

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

  const stmt = db.prepare(`
    INSERT INTO invoices (
      invoice_number, customer_jid, customer_name, chat_jid, is_group,
      amount, items_summary, notes, qris_payload, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
  `);

  const result = stmt.run(
    invoiceNumber,
    customerJid,
    customerName || customerJid.split('@')[0],
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
 * Get invoice by ID
 */
function getInvoiceById(id) {
  return db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(id));
}

/**
 * Get invoice by Invoice Number (e.g. INV-20260722-0001)
 */
function getInvoiceByNumber(invoiceNumber) {
  return db.prepare('SELECT * FROM invoices WHERE UPPER(invoice_number) = UPPER(?)').get(invoiceNumber);
}

/**
 * Get active/latest pending invoice for a user or chat
 */
function getLatestPendingInvoice(customerJid, chatJid) {
  return db.prepare(`
    SELECT * FROM invoices 
    WHERE (customer_jid = ? OR chat_jid = ?) AND status IN ('PENDING', 'PROOF_SUBMITTED')
    ORDER BY id DESC LIMIT 1
  `).get(customerJid, chatJid);
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
    SELECT COUNT(*) as count FROM invoices WHERE status IN ('PENDING', 'PROOF_SUBMITTED')
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
  generateInvoiceNumber,
  getCurrentFormattedTimestamp,
  createInvoice,
  getInvoiceById,
  getInvoiceByNumber,
  getLatestPendingInvoice,
  updateInvoiceProof,
  markInvoicePaid,
  listInvoices,
  getInvoiceStats,
  getConfig,
  setConfig
};
