const invoiceRepo = require('../database/invoice-repo');
const { createInvoiceService, formatRupiah, formatAdminInvoiceNotification } = require('../services/invoice-service');
const { decodeQRFromBuffer } = require('../qris/qr-reader');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

function isAdmin(senderJid) {
  return invoiceRepo.isAdmin(senderJid);
}

/**
 * Perintah !qris <nominal> [keterangan]
 * Mengirim SATU PESAN berupa Gambar Kode QRIS dengan caption Invoice lengkap
 */
async function handleQrisCommand(sock, msg, args, customerJid, customerName, chatJid, isGroup) {
  if (!args || args.length === 0) {
    return sock.sendMessage(chatJid, {
      text: `Format Perintah Salah\nPenggunaan: !qris <nominal> [keterangan]\nContoh: !qris 15000 Kopi Susu`
    }, { quoted: msg });
  }

  const rawAmount = args[0].replace(/[^0-9]/g, '');
  const amount = parseInt(rawAmount, 10);
  if (isNaN(amount) || amount <= 0) {
    return sock.sendMessage(chatJid, {
      text: `Nominal pembayaran tidak valid. Masukkan angka positif.`
    }, { quoted: msg });
  }

  const description = args.slice(1).join(' ') || 'Pembayaran Quick QRIS';

  try {
    const { invoice, qrBuffer, invoiceText } = await createInvoiceService({
      customerJid,
      customerName,
      chatJid,
      isGroup,
      amount,
      itemsSummary: description,
      notes: ''
    });

    // Kirim HANYA SATU PESAN berupa Gambar QRIS dengan deskripsi (caption) berisi teks invoice lengkap
    await sock.sendMessage(chatJid, {
      image: qrBuffer,
      caption: invoiceText
    }, { quoted: msg });

    // Notifikasi ke nomor / JID Admin
    notifyAdminNewInvoice(sock, invoice);

  } catch (err) {
    console.error('Error generating !qris:', err);
    await sock.sendMessage(chatJid, {
      text: `Gagal membuat QRIS: ${err.message}`
    }, { quoted: msg });
  }
}

/**
 * Perintah !invoice <nominal> | [rincian] | [catatan]
 * Mengirim SATU PESAN berupa Gambar Kode QRIS dengan caption Invoice terstruktur lengkap
 */
async function handleInvoiceCommand(sock, msg, args, customerJid, customerName, chatJid, isGroup) {
  const fullText = args.join(' ');
  const parts = fullText.split('|').map(p => p.trim());

  if (parts.length === 0 || !parts[0]) {
    return sock.sendMessage(chatJid, {
      text: `Format Perintah Salah\nPenggunaan: !invoice <nominal> | [rincian_barang] | [catatan]\nContoh: !invoice 50000 | Kopi Susu x2, Roti x1 | Tanpa Gula`
    }, { quoted: msg });
  }

  const amount = parseInt(parts[0].replace(/[^0-9]/g, ''), 10);
  if (isNaN(amount) || amount <= 0) {
    return sock.sendMessage(chatJid, {
      text: `Nominal pembayaran tidak valid.`
    }, { quoted: msg });
  }

  const itemsSummary = parts[1] || 'Transaksi QRIS';
  const notes = parts[2] || '';

  try {
    const { invoice, qrBuffer, invoiceText } = await createInvoiceService({
      customerJid,
      customerName,
      chatJid,
      isGroup,
      amount,
      itemsSummary,
      notes
    });

    // Kirim HANYA SATU PESAN berupa Gambar QRIS dengan deskripsi (caption) berisi teks invoice lengkap
    await sock.sendMessage(chatJid, {
      image: qrBuffer,
      caption: invoiceText
    }, { quoted: msg });

    // Notifikasi ke nomor / JID Admin
    notifyAdminNewInvoice(sock, invoice);

  } catch (err) {
    console.error('Error generating !invoice:', err);
    await sock.sendMessage(chatJid, {
      text: `Gagal membuat Invoice: ${err.message}`
    }, { quoted: msg });
  }
}

/**
 * Notifikasi ke Admin ketika Invoice baru dibuat
 */
async function notifyAdminNewInvoice(sock, invoice) {
  const adminJid = invoiceRepo.getAdminJid();
  if (!adminJid) return;

  const noticeText = formatAdminInvoiceNotification(invoice);
  try {
    await sock.sendMessage(adminJid, { text: noticeText });
  } catch (e) {
    console.error('Gagal mengirim notifikasi ke admin:', e.message);
  }
}

/**
 * Perintah !status [no_invoice]
 */
async function handleStatusCommand(sock, msg, args, customerJid, chatJid) {
  let invoice;
  if (args.length > 0) {
    invoice = invoiceRepo.getInvoiceByNumber(args[0].trim());
  } else {
    invoice = invoiceRepo.getPendingInvoiceForUser(customerJid, chatJid);
  }

  if (!invoice) {
    return sock.sendMessage(chatJid, {
      text: `Tidak ditemukan invoice yang pending atau nomor invoice tidak sesuai.`
    }, { quoted: msg });
  }

  let text = `DETAIL INVOICE ${invoice.invoice_number}\n`;
  text += `----------------------------------------\n`;
  text += `Nominal Tagihan: ${formatRupiah(invoice.amount)}\n`;
  text += `Waktu Dibuat: ${invoice.created_at}\n`;
  text += `Pelanggan: ${invoice.customer_name}\n`;
  text += `Status Saat Ini: ${invoice.status}\n`;
  if (invoice.paid_at) {
    text += `Waktu Lunas: ${invoice.paid_at}\n`;
  }
  text += `----------------------------------------\n`;
  text += `abyn.xyz`;

  await sock.sendMessage(chatJid, { text }, { quoted: msg });
}

/**
 * Perintah !history [limit] (Admin & Pelanggan)
 */
async function handleHistoryCommand(sock, msg, args, senderJid, chatJid) {
  const isSenderAdmin = isAdmin(senderJid);
  const limit = parseInt(args[0], 10) || 5;

  let invoices;
  if (isSenderAdmin) {
    invoices = invoiceRepo.listInvoices({ limit });
  } else {
    const userPure = invoiceRepo.getPureNumber(senderJid);
    const userClean = invoiceRepo.cleanJid(senderJid);
    invoices = invoiceRepo.listInvoices({ limit: 20 }).filter(inv => {
      return invoiceRepo.getPureNumber(inv.customer_jid) === userPure || invoiceRepo.cleanJid(inv.customer_jid) === userClean;
    }).slice(0, limit);
  }

  if (invoices.length === 0) {
    return sock.sendMessage(chatJid, {
      text: `Belum ada riwayat transaksi.`
    }, { quoted: msg });
  }

  let text = `RIWAYAT TRANSAKSI (${invoices.length} TERAKHIR)\n`;
  text += `----------------------------------------\n`;

  for (const inv of invoices) {
    text += `• ${inv.invoice_number} - ${formatRupiah(inv.amount)}\n`;
    text += `  Waktu: ${inv.created_at}\n`;
    text += `  Pelanggan: ${inv.customer_name}\n`;
    text += `  Status: ${inv.status}\n\n`;
  }
  text += `----------------------------------------\n`;
  text += `abyn.xyz`;

  await sock.sendMessage(chatJid, { text }, { quoted: msg });
}

/**
 * Perintah !markpaid <no_invoice> (Khusus Admin)
 */
async function handleMarkPaidCommand(sock, msg, args, senderJid, chatJid) {
  if (!isAdmin(senderJid)) {
    return sock.sendMessage(chatJid, {
      text: `Perintah ini hanya dapat dijalankan oleh Admin toko.`
    }, { quoted: msg });
  }

  if (!args || args.length === 0) {
    return sock.sendMessage(chatJid, {
      text: `Format: !markpaid <no_invoice>\nContoh: !markpaid INV-20260722-0001`
    }, { quoted: msg });
  }

  const invoiceNumber = args[0].trim();
  const invoice = invoiceRepo.getInvoiceByNumber(invoiceNumber);

  if (!invoice) {
    return sock.sendMessage(chatJid, {
      text: `Invoice ${invoiceNumber} tidak ditemukan.`
    }, { quoted: msg });
  }

  invoiceRepo.markInvoicePaid(invoice.id);
  const updatedInv = invoiceRepo.getInvoiceById(invoice.id);

  // Konfirmasi ke Admin
  await sock.sendMessage(chatJid, {
    text: `Invoice ${invoice.invoice_number} senilai ${formatRupiah(invoice.amount)} berhasil ditandai LUNAS (PAID).`
  }, { quoted: msg });

  // Notifikasi pelunasan ke pelanggan
  try {
    await sock.sendMessage(invoice.chat_jid, {
      text: `PEMBAYARAN TERKONFIRMASI LUNAS\n\nNo. Invoice: ${invoice.invoice_number}\nTotal: ${formatRupiah(invoice.amount)}\nWaktu Lunas: ${updatedInv.paid_at}\nStatus: LUNAS\n\nTerima kasih atas pembayaran Anda!\n\nabyn.xyz`
    });
  } catch (err) {
    console.error('Gagal mengirim notifikasi lunas ke pelanggan:', err.message);
  }
}

/**
 * Perintah !stats (Khusus Admin)
 */
async function handleStatsCommand(sock, msg, senderJid, chatJid) {
  if (!isAdmin(senderJid)) {
    return sock.sendMessage(chatJid, {
      text: `Perintah ini hanya dapat dijalankan oleh Admin toko.`
    }, { quoted: msg });
  }

  const stats = invoiceRepo.getInvoiceStats();

  let text = `STATISTIK PENJUALAN & QRIS TOKO\n`;
  text += `----------------------------------------\n`;
  text += `Total Invoice Dibuat: ${stats.totalInvoices}\n`;
  text += `Invoice Lunas (PAID): ${stats.paidInvoices}\n`;
  text += `Invoice Pending/Proof: ${stats.pendingInvoices}\n`;
  text += `Total Pendapatan Lunas: ${formatRupiah(stats.totalRevenue)}\n`;
  text += `----------------------------------------\n`;
  text += `abyn.xyz`;

  await sock.sendMessage(chatJid, { text }, { quoted: msg });
}

/**
 * Perintah !setqris <string> atau kirim foto QRIS (Khusus Admin)
 */
async function handleSetQrisCommand(sock, msg, args, senderJid, chatJid) {
  if (!isAdmin(senderJid)) {
    return sock.sendMessage(chatJid, {
      text: `Perintah ini hanya dapat dijalankan oleh Admin toko.`
    }, { quoted: msg });
  }

  const messageType = Object.keys(msg.message || {})[0];
  if (messageType === 'imageMessage' || messageType === 'extendedTextMessage') {
    if (msg.message.imageMessage || (msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo && msg.message.extendedTextMessage.contextInfo.quotedMessage && msg.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage)) {
      try {
        const imageMsg = msg.message.imageMessage || msg.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
        const buffer = await downloadMediaMessage({ message: { imageMessage: imageMsg } }, 'buffer', {});
        const scannedQris = await decodeQRFromBuffer(buffer);

        if (scannedQris) {
          invoiceRepo.setConfig('static_qris', scannedQris);
          return sock.sendMessage(chatJid, {
            text: `QRIS Statis Toko berhasil diperbarui dari foto!\n\nPayload QRIS: ${scannedQris.substring(0, 40)}...`
          }, { quoted: msg });
        } else {
          return sock.sendMessage(chatJid, {
            text: `Tidak dapat membaca kode QR dari gambar. Pastikan foto QRIS jelas.`
          }, { quoted: msg });
        }
      } catch (err) {
        console.error('Error membaca QR code dari gambar:', err);
      }
    }
  }

  if (!args || args.length === 0) {
    return sock.sendMessage(chatJid, {
      text: `Format: !setqris <string_qris_statis> atau kirim foto QRIS dengan caption !setqris`
    }, { quoted: msg });
  }

  const qrisStr = args.join('').trim();
  invoiceRepo.setConfig('static_qris', qrisStr);

  await sock.sendMessage(chatJid, {
    text: `QRIS Statis Toko berhasil diperbarui!`
  }, { quoted: msg });
}

/**
 * Perintah !help / !bantuan / !menu
 */
async function handleHelpCommand(sock, msg, senderJid, chatJid) {
  const isSenderAdmin = isAdmin(senderJid);

  let text = `BOT PEMBAYARAN QRIS OTOMATIS\n`;
  text += `----------------------------------------\n`;
  text += `PERINTAH UMUM:\n\n`;
  text += `1. Buat QRIS Dinamis Cepat:\n`;
  text += `   Format: !qris <nominal> [keterangan]\n`;
  text += `   Contoh: !qris 15000 Kopi Susu\n\n`;
  text += `2. Buat Invoice Terstruktur:\n`;
  text += `   Format: !invoice <nominal> | [rincian] | [catatan]\n`;
  text += `   Contoh: !invoice 50000 | Kopi Susu x2, Roti x1 | Tanpa Gula\n\n`;
  text += `3. Cek Status Pembayaran:\n`;
  text += `   Format: !status [no_invoice]\n`;
  text += `   Contoh: !status INV-20260722-0001\n\n`;
  text += `4. Lihat Riwayat Transaksi:\n`;
  text += `   Format: !history\n\n`;
  text += `5. Kirim Bukti Pembayaran:\n`;
  text += `   Balas (reply) pesan foto QRIS invoice dengan mengunggah screenshot bukti transfer.\n`;

  if (isSenderAdmin) {
    text += `\n----------------------------------------\n`;
    text += `PERINTAH KHUSUS ADMIN:\n\n`;
    text += `• !markpaid <no_invoice>\n`;
    text += `  Contoh: !markpaid INV-20260722-0001\n`;
    text += `• !stats\n`;
    text += `  Contoh: !stats\n`;
    text += `• !setqris <string_atau_foto>\n`;
    text += `  Contoh: !setqris 000201010211...\n`;
  }

  text += `----------------------------------------\n`;
  text += `abyn.xyz`;

  await sock.sendMessage(chatJid, { text }, { quoted: msg });
}

module.exports = {
  isAdmin,
  handleQrisCommand,
  handleInvoiceCommand,
  handleStatusCommand,
  handleHistoryCommand,
  handleMarkPaidCommand,
  handleStatsCommand,
  handleSetQrisCommand,
  handleHelpCommand
};
