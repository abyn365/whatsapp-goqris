const invoiceRepo = require('../database/invoice-repo');
const { createInvoiceService, formatRupiah, formatInvoiceText, formatAdminInvoiceNotification, getHumanStatus, formatCustomerMentionText } = require('../services/invoice-service');
const { decodeQRFromBuffer } = require('../qris/qr-reader');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { safeSendMessage, cleanJid } = require('../utils/message-utils');

function isAdmin(senderJid, msg = null) {
  return invoiceRepo.isAdmin(senderJid, msg);
}

/**
 * Perintah !qris <nominal> [keterangan]
 * Mengirim SATU PESAN berupa Gambar Kode QRIS dengan caption Invoice lengkap
 */
async function handleQrisCommand(sock, msg, args, customerJid, customerName, chatJid, isGroup) {
  if (!args || args.length === 0) {
    return safeSendMessage(sock, chatJid, {
      text: `Format Perintah Salah\nPenggunaan: !qris <nominal> [keterangan]\nContoh: !qris 15000 Kopi Susu`
    }, { quoted: msg });
  }

  const rawAmount = args[0].replace(/[^0-9]/g, '');
  const amount = parseInt(rawAmount, 10);
  if (isNaN(amount) || amount <= 0) {
    return safeSendMessage(sock, chatJid, {
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

    const sentCustomerMsg = await safeSendMessage(sock, chatJid, {
      image: qrBuffer,
      caption: invoiceText,
      mentions: [customerJid]
    }, { quoted: msg });

    if (sentCustomerMsg && sentCustomerMsg.key) {
      invoiceRepo.saveCustomerMsgKey(invoice.id, sentCustomerMsg.key);
    }

    notifyAdminNewInvoice(sock, invoice, customerJid);

  } catch (err) {
    console.error('Error generating !qris:', err);
    await safeSendMessage(sock, chatJid, {
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
    return safeSendMessage(sock, chatJid, {
      text: `Format Perintah Salah\nPenggunaan: !invoice <nominal> | [rincian_barang] | [catatan]\nContoh: !invoice 50000 | Kopi Susu x2, Roti x1 | Tanpa Gula`
    }, { quoted: msg });
  }

  const amount = parseInt(parts[0].replace(/[^0-9]/g, ''), 10);
  if (isNaN(amount) || amount <= 0) {
    return safeSendMessage(sock, chatJid, {
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

    const sentCustomerMsg = await safeSendMessage(sock, chatJid, {
      image: qrBuffer,
      caption: invoiceText,
      mentions: [customerJid]
    }, { quoted: msg });

    if (sentCustomerMsg && sentCustomerMsg.key) {
      invoiceRepo.saveCustomerMsgKey(invoice.id, sentCustomerMsg.key);
    }

    notifyAdminNewInvoice(sock, invoice, customerJid);

  } catch (err) {
    console.error('Error generating !invoice:', err);
    await safeSendMessage(sock, chatJid, {
      text: `Gagal membuat Invoice: ${err.message}`
    }, { quoted: msg });
  }
}

/**
 * Notifikasi ke Admin ketika Invoice baru dibuat
 */
async function notifyAdminNewInvoice(sock, invoice, preferredAdminJid = '') {
  const adminJid = invoiceRepo.getAdminJid(preferredAdminJid);
  if (!adminJid) return;

  if (cleanJid(invoice.chat_jid) === cleanJid(adminJid)) {
    return;
  }

  const noticeText = formatAdminInvoiceNotification(invoice);
  try {
    const sentAdminMsg = await safeSendMessage(sock, adminJid, { text: noticeText });
    if (sentAdminMsg && sentAdminMsg.key) {
      invoiceRepo.saveAdminMsgKey(invoice.id, sentAdminMsg.key);
    }
  } catch (e) {
    console.error(`Gagal mengirim notifikasi invoice ke admin (${adminJid}):`, e.message);
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
    return safeSendMessage(sock, chatJid, {
      text: `Tidak ditemukan invoice yang pending atau nomor invoice tidak sesuai.`
    }, { quoted: msg });
  }

  const humanStatus = getHumanStatus(invoice.status, invoice.paid_at, invoice.rejection_reason);
  const customerTag = formatCustomerMentionText(invoice.customer_jid, invoice.customer_name);

  let text = `DETAIL INVOICE\n`;
  text += `----------------------------------------\n`;
  text += `No. Invoice: \`${invoice.invoice_number}\`\n`;
  text += `Nominal Tagihan: ${formatRupiah(invoice.amount)}\n`;
  text += `Waktu Dibuat: ${invoice.created_at}\n`;
  text += `Pelanggan: ${customerTag}\n`;
  text += `Status Saat Ini: ${humanStatus}\n`;
  if (invoice.paid_at) {
    text += `Waktu Lunas: ${invoice.paid_at}\n`;
  }
  if (invoice.rejection_reason) {
    text += `Alasan Penolakan: ${invoice.rejection_reason}\n`;
  }
  text += `----------------------------------------\n`;
  text += `abyn.xyz`;

  await safeSendMessage(sock, chatJid, { text, mentions: [invoice.customer_jid] }, { quoted: msg });
}

/**
 * Perintah !recap / !rekap
 * Menampilkan rekap transaksi yang masih aktif (PENDING, PROOF_SUBMITTED) dan DITOLAK (REJECTED)
 */
async function handleRecapCommand(sock, msg, args, senderJid, chatJid) {
  const isSenderAdmin = isAdmin(senderJid, msg);

  let invoices;
  if (isSenderAdmin) {
    invoices = invoiceRepo.getActiveAndRejectedInvoices({ limit: 30 });
  } else {
    const userPure = invoiceRepo.getPureNumber(senderJid);
    const userClean = cleanJid(senderJid);
    invoices = invoiceRepo.getActiveAndRejectedInvoices({ limit: 30 }).filter(inv => {
      return invoiceRepo.getPureNumber(inv.customer_jid) === userPure || cleanJid(inv.customer_jid) === userClean;
    });
  }

  if (invoices.length === 0) {
    return safeSendMessage(sock, chatJid, {
      text: `REKAP TRANSAKSI AKTIF & DITOLAK\n----------------------------------------\nTidak ada transaksi aktif (pending) atau ditolak saat ini.\n----------------------------------------\nabyn.xyz`
    }, { quoted: msg });
  }

  let text = `REKAP TRANSAKSI AKTIF & DITOLAK\n`;
  text += `----------------------------------------\n`;

  let totalAmount = 0;
  const mentions = [];

  for (const inv of invoices) {
    const humanStatus = getHumanStatus(inv.status, inv.paid_at, inv.rejection_reason);
    const customerTag = formatCustomerMentionText(inv.customer_jid, inv.customer_name);
    totalAmount += Number(inv.amount) || 0;

    let icon = '📌';
    if (inv.status === 'PROOF_SUBMITTED') icon = '📸';
    if (inv.status === 'REJECTED') icon = '⚠️';

    text += `${icon} Invoice: \`${inv.invoice_number}\`\n`;
    text += `   Pelanggan: ${customerTag}\n`;
    text += `   Nominal: ${formatRupiah(inv.amount)}\n`;
    text += `   Status: ${humanStatus}\n`;
    text += `   Waktu: ${inv.created_at}\n\n`;

    if (inv.customer_jid && !mentions.includes(inv.customer_jid)) {
      mentions.push(inv.customer_jid);
    }
  }

  text += `----------------------------------------\n`;
  text += `Total Invoice: ${invoices.length}\n`;
  text += `Total Nominal: ${formatRupiah(totalAmount)}\n`;
  text += `----------------------------------------\n`;
  text += `abyn.xyz`;

  await safeSendMessage(sock, chatJid, { text, mentions }, { quoted: msg });
}

/**
 * Perintah !history [limit] (Admin & Pelanggan)
 */
async function handleHistoryCommand(sock, msg, args, senderJid, chatJid) {
  const isSenderAdmin = isAdmin(senderJid, msg);
  const limit = parseInt(args[0], 10) || 5;

  let invoices;
  if (isSenderAdmin) {
    invoices = invoiceRepo.listInvoices({ limit });
  } else {
    const userPure = invoiceRepo.getPureNumber(senderJid);
    const userClean = cleanJid(senderJid);
    invoices = invoiceRepo.listInvoices({ limit: 20 }).filter(inv => {
      return invoiceRepo.getPureNumber(inv.customer_jid) === userPure || cleanJid(inv.customer_jid) === userClean;
    }).slice(0, limit);
  }

  if (invoices.length === 0) {
    return safeSendMessage(sock, chatJid, {
      text: `Belum ada riwayat transaksi.`
    }, { quoted: msg });
  }

  let text = `RIWAYAT TRANSAKSI (${invoices.length} TERAKHIR)\n`;
  text += `----------------------------------------\n`;

  for (const inv of invoices) {
    const humanStatus = getHumanStatus(inv.status, inv.paid_at, inv.rejection_reason);
    text += `• \`${inv.invoice_number}\` - ${formatRupiah(inv.amount)}\n`;
    text += `  Waktu: ${inv.created_at}\n`;
    text += `  Pelanggan: ${inv.customer_name}\n`;
    text += `  Status: ${humanStatus}\n\n`;
  }
  text += `----------------------------------------\n`;
  text += `abyn.xyz`;

  await safeSendMessage(sock, chatJid, { text }, { quoted: msg });
}

/**
 * Perintah !markpaid <no_invoice> (Khusus Admin)
 */
async function handleMarkPaidCommand(sock, msg, args, senderJid, chatJid) {
  if (!isAdmin(senderJid, msg)) {
    return safeSendMessage(sock, chatJid, {
      text: `Perintah ini hanya dapat dijalankan oleh Admin toko.`
    }, { quoted: msg });
  }

  if (!args || args.length === 0) {
    return safeSendMessage(sock, chatJid, {
      text: `Format: !markpaid <no_invoice>\nContoh: !markpaid 20260722-0001`
    }, { quoted: msg });
  }

  const invoiceNumber = args[0].trim();
  const invoice = invoiceRepo.getInvoiceByNumber(invoiceNumber);

  if (!invoice) {
    return safeSendMessage(sock, chatJid, {
      text: `Invoice ${invoiceNumber} tidak ditemukan.`
    }, { quoted: msg });
  }

  invoiceRepo.markInvoicePaid(invoice.id);
  const updatedInv = invoiceRepo.getInvoiceById(invoice.id);

  // In-place edit admin notification
  if (updatedInv.admin_msg_key) {
    try {
      const adminKey = JSON.parse(updatedInv.admin_msg_key);
      const updatedAdminNotice = formatAdminInvoiceNotification(updatedInv);
      await safeSendMessage(sock, adminKey.remoteJid || chatJid, {
        text: updatedAdminNotice,
        edit: adminKey
      });
    } catch (e) {}
  }

  // Konfirmasi ke Admin
  await safeSendMessage(sock, chatJid, {
    text: `Invoice \`${invoice.invoice_number}\` senilai ${formatRupiah(invoice.amount)} berhasil ditandai LUNAS.`
  }, { quoted: msg });

  // In-place edit customer invoice caption
  const storeName = invoiceRepo.getConfig('store_name', process.env.STORE_NAME || 'ABYN.XYZ DIGITAL & KREATIF');
  const updatedCustomerInvoiceText = formatInvoiceText(updatedInv, storeName);

  if (updatedInv.customer_msg_key) {
    try {
      const customerKey = JSON.parse(updatedInv.customer_msg_key);
      await safeSendMessage(sock, customerKey.remoteJid || updatedInv.chat_jid, {
        text: updatedCustomerInvoiceText,
        edit: customerKey,
        mentions: [updatedInv.customer_jid]
      });
    } catch (e) {}
  }

  // Kirim notifikasi pelunasan ke pelanggan dengan tag mention
  const customerTag = formatCustomerMentionText(updatedInv.customer_jid, updatedInv.customer_name);
  try {
    await safeSendMessage(sock, updatedInv.chat_jid, {
      text: `PEMBAYARAN TERKONFIRMASI LUNAS\n\nPelanggan: ${customerTag}\nNo. Invoice: \`${updatedInv.invoice_number}\`\nTotal: ${formatRupiah(updatedInv.amount)}\nWaktu Lunas: ${updatedInv.paid_at}\nStatus: Lunas\n\nTerima kasih atas pembayaran Anda!\n\nabyn.xyz`,
      mentions: [updatedInv.customer_jid]
    });
  } catch (err) {
    console.error('Gagal mengirim notifikasi lunas ke pelanggan:', err.message);
  }
}

/**
 * Perintah !reject <no_invoice> [alasan] (Khusus Admin)
 */
async function handleRejectCommand(sock, msg, args, senderJid, chatJid) {
  if (!isAdmin(senderJid, msg)) {
    return safeSendMessage(sock, chatJid, {
      text: `Perintah ini hanya dapat dijalankan oleh Admin toko.`
    }, { quoted: msg });
  }

  if (!args || args.length === 0) {
    return safeSendMessage(sock, chatJid, {
      text: `Format: !reject <no_invoice> [alasan]\nContoh: !reject 20260722-0001 Foto bukti transfer tidak jelas`
    }, { quoted: msg });
  }

  const invoiceNumber = args[0].trim();
  const reason = args.slice(1).join(' ') || 'Bukti transfer tidak valid atau tidak terlihat jelas';

  const invoice = invoiceRepo.getInvoiceByNumber(invoiceNumber);
  if (!invoice) {
    return safeSendMessage(sock, chatJid, {
      text: `Invoice ${invoiceNumber} tidak ditemukan.`
    }, { quoted: msg });
  }

  invoiceRepo.rejectInvoiceProof(invoice.id, reason);
  const updatedInv = invoiceRepo.getInvoiceById(invoice.id);

  // In-place edit admin notification
  if (updatedInv.admin_msg_key) {
    try {
      const adminKey = JSON.parse(updatedInv.admin_msg_key);
      const updatedAdminNotice = formatAdminInvoiceNotification(updatedInv);
      await safeSendMessage(sock, adminKey.remoteJid || chatJid, {
        text: updatedAdminNotice,
        edit: adminKey
      });
    } catch (e) {}
  }

  // Konfirmasi ke Admin
  await safeSendMessage(sock, chatJid, {
    text: `Invoice \`${invoice.invoice_number}\` ditolak.\nAlasan: ${reason}`
  }, { quoted: msg });

  // In-place edit customer invoice caption
  const storeName = invoiceRepo.getConfig('store_name', process.env.STORE_NAME || 'ABYN.XYZ DIGITAL & KREATIF');
  const updatedCustomerInvoiceText = formatInvoiceText(updatedInv, storeName);

  if (updatedInv.customer_msg_key) {
    try {
      const customerKey = JSON.parse(updatedInv.customer_msg_key);
      await safeSendMessage(sock, customerKey.remoteJid || updatedInv.chat_jid, {
        text: updatedCustomerInvoiceText,
        edit: customerKey,
        mentions: [updatedInv.customer_jid]
      });
    } catch (e) {}
  }

  // Kirim notifikasi penolakan ke pelanggan dengan tag mention
  const customerTag = formatCustomerMentionText(updatedInv.customer_jid, updatedInv.customer_name);
  try {
    await safeSendMessage(sock, updatedInv.chat_jid, {
      text: `PEMBAYARAN DITOLAK\n\nPelanggan: ${customerTag}\nNo. Invoice: \`${updatedInv.invoice_number}\`\nTotal: ${formatRupiah(updatedInv.amount)}\nStatus: Ditolak\nAlasan: ${reason}\n\nSilakan balas (reply) foto QRIS invoice dengan mengunggah screenshot bukti pembayaran yang baru dan jelas.\n\nabyn.xyz`,
      mentions: [updatedInv.customer_jid]
    });
  } catch (err) {
    console.error('Gagal mengirim notifikasi penolakan ke pelanggan:', err.message);
  }
}

/**
 * Perintah !stats (Khusus Admin)
 */
async function handleStatsCommand(sock, msg, senderJid, chatJid) {
  if (!isAdmin(senderJid, msg)) {
    return safeSendMessage(sock, chatJid, {
      text: `Perintah ini hanya dapat dijalankan oleh Admin toko.`
    }, { quoted: msg });
  }

  const stats = invoiceRepo.getInvoiceStats();

  let text = `STATISTIK PENJUALAN & QRIS TOKO\n`;
  text += `----------------------------------------\n`;
  text += `Total Invoice Dibuat: ${stats.totalInvoices}\n`;
  text += `Invoice Lunas (PAID): ${stats.paidInvoices}\n`;
  text += `Invoice Pending/Proof/Ditolak: ${stats.pendingInvoices}\n`;
  text += `Total Pendapatan Lunas: ${formatRupiah(stats.totalRevenue)}\n`;
  text += `----------------------------------------\n`;
  text += `abyn.xyz`;

  await safeSendMessage(sock, chatJid, { text }, { quoted: msg });
}

/**
 * Perintah !setqris <string> atau kirim foto QRIS (Khusus Admin)
 */
async function handleSetQrisCommand(sock, msg, args, senderJid, chatJid) {
  if (!isAdmin(senderJid, msg)) {
    return safeSendMessage(sock, chatJid, {
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
          return safeSendMessage(sock, chatJid, {
            text: `QRIS Statis Toko berhasil diperbarui dari foto!\n\nPayload QRIS: ${scannedQris.substring(0, 40)}...`
          }, { quoted: msg });
        } else {
          return safeSendMessage(sock, chatJid, {
            text: `Tidak dapat membaca kode QR dari gambar. Pastikan foto QRIS jelas.`
          }, { quoted: msg });
        }
      } catch (err) {
        console.error('Error membaca QR code dari gambar:', err);
      }
    }
  }

  if (!args || args.length === 0) {
    return safeSendMessage(sock, chatJid, {
      text: `Format: !setqris <string_qris_statis> atau kirim foto QRIS dengan caption !setqris`
    }, { quoted: msg });
  }

  const qrisStr = args.join('').trim();
  invoiceRepo.setConfig('static_qris', qrisStr);

  await safeSendMessage(sock, chatJid, {
    text: `QRIS Statis Toko berhasil diperbarui!`
  }, { quoted: msg });
}

/**
 * Perintah !help / !bantuan / !menu / !adminhelp
 */
async function handleHelpCommand(sock, msg, senderJid, chatJid) {
  const isSenderAdmin = isAdmin(senderJid, msg);

  let text = `BOT PEMBAYARAN QRIS DINAMIS\n`;
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
  text += `   Contoh: !status INV-20260722-0001 (atau !status 20260722-0001)\n\n`;
  text += `4. Rekap Transaksi Aktif & Ditolak:\n`;
  text += `   Format: !recap atau !rekap\n\n`;
  text += `5. Lihat Riwayat Transaksi:\n`;
  text += `   Format: !history\n\n`;
  text += `6. Kirim Bukti Pembayaran:\n`;
  text += `   Balas (reply) pesan foto QRIS invoice dengan mengunggah screenshot bukti transfer.\n`;

  if (isSenderAdmin) {
    text += `\n----------------------------------------\n`;
    text += `PERINTAH KHUSUS ADMIN TOKO:\n\n`;
    text += `• !recap / !rekap\n`;
    text += `  Lihat rekap seluruh transaksi aktif & ditolak.\n`;
    text += `  Contoh: !recap\n\n`;
    text += `• !markpaid <no_invoice>\n`;
    text += `  Konfirmasi pelunasan invoice.\n`;
    text += `  Contoh: !markpaid 20260722-0001\n\n`;
    text += `• !reject <no_invoice> [alasan]\n`;
    text += `  Tolak bukti pembayaran dengan alasan penolakan.\n`;
    text += `  Contoh: !reject 20260722-0001 Foto bukti buram\n\n`;
    text += `• !stats\n`;
    text += `  Lihat statistik omset penjualan & transaksi toko.\n`;
    text += `  Contoh: !stats\n\n`;
    text += `• !setqris <string_atau_foto>\n`;
    text += `  Update QRIS Statis Toko dari teks atau foto.\n`;
    text += `  Contoh: !setqris 000201010211...\n\n`;
    text += `• !history [limit]\n`;
    text += `  Lihat riwayat transaksi seluruh pelanggan.\n`;
    text += `  Contoh: !history 10\n`;
  }

  text += `----------------------------------------\n`;
  text += `abyn.xyz`;

  await safeSendMessage(sock, chatJid, { text }, { quoted: msg });
}

module.exports = {
  isAdmin,
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
};
