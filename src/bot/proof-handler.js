const path = require('path');
const fs = require('fs');
const invoiceRepo = require('../database/invoice-repo');
const { formatAdminProofNotification, formatRupiah } = require('../services/invoice-service');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const proofDir = path.join(process.cwd(), 'data', 'proofs');
if (!fs.existsSync(proofDir)) {
  fs.mkdirSync(proofDir, { recursive: true });
}

/**
 * Handles image media messages as payment proofs
 */
async function handlePaymentProof(sock, msg, customerJid, chatJid, isGroup) {
  // Find recent pending or proof_submitted invoice
  const invoice = invoiceRepo.getLatestPendingInvoice(customerJid, chatJid);
  if (!invoice) {
    return false; // No pending invoice found for this user/chat
  }

  try {
    // Download image media buffer from WhatsApp
    const buffer = await downloadMediaMessage(msg, 'buffer', {});
    if (!buffer) return false;

    // Save image proof file locally
    const filename = `proof_${invoice.invoice_number}_${Date.now()}.jpg`;
    const filePath = path.join(proofDir, filename);
    fs.writeFileSync(filePath, buffer);

    // Update DB
    invoiceRepo.updateInvoiceProof(invoice.id, filePath);

    // Send confirmation to user
    await sock.sendMessage(chatJid, {
      text: `✅ *Bukti Pembayaran Diterima!*\n\nNo. Invoice: \`${invoice.invoice_number}\`\nTotal: *${formatRupiah(invoice.amount)}*\n\nBukti pembayaran Anda telah diteruskan ke Admin untuk diverifikasi. Anda akan menerima konfirmasi setelah disetujui.`
    }, { quoted: msg });

    // Forward proof screenshot & notification to Admin
    const adminRaw = process.env.ADMIN_NUMBER || '';
    if (adminRaw) {
      const adminJid = adminRaw.includes('@s.whatsapp.net') 
        ? adminRaw 
        : `${adminRaw.replace(/[^0-9]/g, '')}@s.whatsapp.net`;

      const adminNoticeText = formatAdminProofNotification(invoice);

      await sock.sendMessage(adminJid, {
        image: buffer,
        caption: adminNoticeText
      });
    }

    return true;
  } catch (err) {
    console.error('Error handling payment proof screenshot:', err);
    await sock.sendMessage(chatJid, {
      text: `⚠️ Gagal memproses foto bukti pembayaran: ${err.message}`
    }, { quoted: msg });
    return false;
  }
}

module.exports = {
  handlePaymentProof
};
