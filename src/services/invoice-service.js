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

  // Konversi QRIS Statis ke Dinamis dengan nominal
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

  // Hasilkan buffer gambar PNG kode QR
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
 * Format teks status invoice
 */
function formatStatusString(status, paidAt) {
  if (status === 'PAID') {
    return `LUNAS (Diperbarui pada ${paidAt || 'sekarang'})`;
  }
  if (status === 'PROOF_SUBMITTED') {
    return `PROOF_SUBMITTED (Bukti Dikirim, Menunggu Verifikasi Admin)`;
  }
  return `PENDING (Menunggu Pembayaran)`;
}

/**
 * Format teks invoice sebagai caption gambar tunggal
 */
function formatInvoiceText(invoice, storeName) {
  const rupiah = formatRupiah(invoice.amount);
  const statusStr = formatStatusString(invoice.status, invoice.paid_at);
  
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
  text += `Status: ${statusStr}\n`;
  text += `----------------------------------------\n`;
  
  if (invoice.status === 'PAID') {
    text += `PEMBAYARAN LUNAS. TERIMA KASIH!\n`;
  } else if (invoice.status === 'PROOF_SUBMITTED') {
    text += `Bukti transfer Anda telah dikirim dan sedang dalam proses verifikasi Admin.\n`;
  } else {
    text += `PETUNJUK PEMBAYARAN:\n`;
    text += `1. Scan Kode QRIS pada gambar ini menggunakan aplikasi GoPay, OVO, Dana, ShopeePay, BCA, Mandiri, dll.\n`;
    text += `2. Pastikan nominal pembayaran sesuai yaitu ${rupiah}.\n`;
    text += `3. Wajib! Balas (reply) foto QRIS ini dengan mengunggah screenshot bukti pembayaran agar admin memverifikasi.\n`;
  }

  text += `----------------------------------------\n`;
  text += `abyn.xyz`;

  return text;
}

/**
 * Format teks notifikasi untuk Admin saat invoice baru dibuat / diperbarui
 */
function formatAdminInvoiceNotification(invoice) {
  const rupiah = formatRupiah(invoice.amount);
  const statusStr = formatStatusString(invoice.status, invoice.paid_at);

  let text = `NOTIFIKASI INVOICE TOKO\n`;
  text += `----------------------------------------\n`;
  text += `No. Invoice: ${invoice.invoice_number}\n`;
  text += `Waktu: ${invoice.created_at}\n`;
  text += `Pelanggan: ${invoice.customer_name} (${invoice.customer_jid})\n`;
  text += `Nominal: ${rupiah}\n`;
  if (invoice.items_summary) {
    text += `Rincian: ${invoice.items_summary}\n`;
  }
  text += `Status: ${statusStr}\n`;
  text += `----------------------------------------\n`;

  if (invoice.status === 'PAID') {
    text += `INVOICE TELAH LUNAS (PAID).\n`;
  } else if (invoice.status === 'PROOF_SUBMITTED') {
    text += `Bukti transfer telah dikirim oleh pelanggan.\nKetik !markpaid ${invoice.invoice_number} untuk mengonfirmasi pelunasan.\n`;
  } else {
    text += `Menunggu pembayaran dari pelanggan.\nKetik !markpaid ${invoice.invoice_number} jika lunas.\n`;
  }

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
  text += `Pelanggan: ${invoice.customer_name} (${invoice.customer_jid})\n`;
  text += `Total Tagihan: ${rupiah}\n`;
  text += `Status: PROOF_SUBMITTED (Menunggu Verifikasi Admin)\n`;
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
