const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const dbPath = process.env.DB_PATH || './data/qris_bot.db';
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseSync(dbPath);

// Enable WAL mode for better concurrency
try {
  db.exec('PRAGMA journal_mode = WAL;');
} catch (e) {
  // Ignore if pragma WAL is restricted
}

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT UNIQUE NOT NULL,
    customer_jid TEXT NOT NULL,
    customer_name TEXT,
    chat_jid TEXT NOT NULL,
    is_group INTEGER DEFAULT 0,
    amount INTEGER NOT NULL,
    items_summary TEXT,
    notes TEXT,
    qris_payload TEXT,
    status TEXT DEFAULT 'PENDING',
    proof_image_path TEXT,
    created_at TEXT NOT NULL,
    paid_at TEXT,
    admin_msg_key TEXT,
    customer_msg_key TEXT,
    rejection_reason TEXT
  );

  CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Migrations for existing databases
try {
  db.exec('ALTER TABLE invoices ADD COLUMN admin_msg_key TEXT;');
} catch (e) {}

try {
  db.exec('ALTER TABLE invoices ADD COLUMN customer_msg_key TEXT;');
} catch (e) {}

try {
  db.exec('ALTER TABLE invoices ADD COLUMN rejection_reason TEXT;');
} catch (e) {}

// Insert default configs if not existing
if (process.env.DEFAULT_STATIC_QRIS) {
  try {
    const check = db.prepare('SELECT value FROM app_config WHERE key = ?').get('static_qris');
    if (!check) {
      db.prepare('INSERT INTO app_config (key, value) VALUES (?, ?)').run('static_qris', process.env.DEFAULT_STATIC_QRIS);
    }
  } catch (e) {}
}

if (process.env.STORE_NAME) {
  try {
    const check = db.prepare('SELECT value FROM app_config WHERE key = ?').get('store_name');
    if (!check) {
      db.prepare('INSERT INTO app_config (key, value) VALUES (?, ?)').run('store_name', process.env.STORE_NAME);
    }
  } catch (e) {}
}

module.exports = db;
