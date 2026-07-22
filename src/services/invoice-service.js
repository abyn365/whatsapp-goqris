const { convertStaticToDynamic, sanitizeQrisString } = require('../qris/converter');
const { generateQRBuffer } = require('../qris/qr-generator');
const invoiceRepo = require('../database/invoice-repo');

/**
 * Format angka ke format mata uang Rupiah (contoh: Rp 50.000)
 */
function formatRupiah(amount) {
  const num = Number(amount) || 0;
  return 'Rp ' + num.toLocaleString('id-ID');
}

/**
 * Buat invoice baru dan hasilkan buffer gambar QRIS dinamis
 */
async function createInvoiceService({
  customerJid,
  customerName,
  chatJid,
  isGroup,
  amount,
  itemsSummary,
  notes
}) {
  // Ambil payload QRIS statis dari konfigurasi toko
  const rawStaticQris = invoiceRepo.getConfig('static_qris', process.env.DEFAULT_STATIC_QRIS || '');
  const staticQris = sanitizeQrisString(rawStaticQris);

  if (!staticQris) {
    throw new Error('QRIS Statis Toko belum dikonfigurasi. Silakan hubungi Admin.');
  }

  // Konversi QRIS Statis ke Dinamis dengan nominal (menempatkan Tag 54 setelah Tag 53)
  const dynamicQris = convertStaticToDynamic(staticQris, amount);

  // Simpan record invoice di database
  const invoice = invoiceRepo.createInvoice({
    customerJid,
    customerName,
    chatJid,
    isGroup,
    amount,
    itemsSummary,
    notes,
    qrisPayload: dynamicQris
  });

  // Hasikan buffer gambar PNG kode QR
  const qrBuffer = await generateQRBuffer(dynamicQris);

  // Format teks invoice untuk caption gambar
  const storeName = invoiceRepo.getConfig('store_name', process.env.STORE_NAME || 'ABYN.XYZ DIGITAL & KREATIF');
  const invoiceText = formatInvoiceText(invoice, storeName);

  return {
    invoice,
    qrBuffer,
    invoiceText
  };
}

/**
 * Format teks invoice sebagai caption gambar tunggal
 */
function formatInvoiceText(invoice, storeName) {
  const rupiah = formatRupiah(invoice.amount);
  
  let text = `INVOICE PEMBAYARAN QRIS\n`;
  text += `${storeName}\n`;
  text += `----------------------------------------\n`;
  text += `No. Invoice: ${invoice.invoice_number}\n`;
  text += `Waktu Transaksi: ${invoice.created_at}\n`;
  text += `Pelanggan: ${invoice.customer_name}\n`;

  if (invoice.items_summary) {
    text += `Rincian Pesanan: ${invoice.items_summary}\n`;
  }

  if (invoice.notes) {
    text += `Catatan: ${invoice.notes}\n`;
  }

  text += `----------------------------------------\n`;
  text += `TOTAL TAGIHAN: ${rupiah}\n`;
  text += `Status: PENDING\n`;
  text += `----------------------------------------\n`;
  text += `PETUNJUK PEMBAYARAN:\n`;
  text += `1. Scan Kode QRIS pada gambar ini menggunakan aplikasi GoPay, OVO, Dana, ShopeePay, BCA, Mandiri, dll.\n`;
  text += `2. Pastikan nominal pembayaran sesuai yaitu ${rupiah}.\n`;
  text += `3. Wajib! Balas (reply) foto QRIS ini dengan mengunggah screenshot bukti pembayaran agar admin memverifikasi.\n`;
  text += `----------------------------------------\n`;
  text += `abyn.xyz`;

  return text;
}

/**
 * Format teks notifikasi untuk Admin saat invoice baru dibuat
 */
function formatAdminInvoiceNotification(invoice) {
  const rupiah = formatRupiah(invoice.amount);
  let text = `NOTIFIKASI INVOICE BARU\n`;
  text += `----------------------------------------\n`;
  text += `No. Invoice: ${invoice.invoice_number}\n`;
  text += `Waktu: ${invoice.created_at}\n`;
  text += `Pelanggan: ${invoice.customer_name} (${invoice.customer_jid.split('@')[0]})\n`;
  text += `Nominal: ${rupiah}\n`;
  if (invoice.items_summary) {
    text += `Rincian: ${invoice.items_summary}\n`;
  }
  text += `Status: PENDING\n`;
  text += `----------------------------------------\n`;
  text += `Ketik !markpaid ${invoice.invoice_number} untuk melunasi invoice ini.\n`;
  text += `abyn.xyz`;
  return text;
}

/**
 * Format teks notifikasi untuk Admin saat foto bukti transfer dikirim
 */
function formatAdminProofNotification(invoice) {
  const rupiah = formatRupiah(invoice.amount);
  let text = `BUKTI PEMBAYARAN DITERIMA\n`;
  text += `----------------------------------------\n`;
  text += `No. Invoice: ${invoice.invoice_number}\n`;
  text += `Waktu Invoice: ${invoice.created_at}\n`;
  text += `Pelanggan: ${invoice.customer_name} (${invoice.customer_jid.split('@')[0]})\n`;
  text += `Total Tagihan: ${rupiah}\n`;
  text += `----------------------------------------\n`;
  text += `Foto bukti transfer terlampir di atas.\n`;
  text += `Ketik !markpaid ${invoice.invoice_number} untuk mengonfirmasi pelunasan.\n`;
  text += `abyn.xyz`;
  return text;
}

module.exports = {
  formatRupiah,
  createInvoiceService,
  formatInvoiceText,
  formatAdminInvoiceNotification,
  formatAdminProofNotification
};
