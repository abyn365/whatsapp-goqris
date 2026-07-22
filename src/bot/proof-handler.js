const path = require('path');
const fs = require('fs');
const invoiceRepo = require('../database/invoice-repo');
const { formatAdminProofNotification, formatRupiah } = require('../services/invoice-service');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { getRealMessage } = require('../utils/message-utils');

const proofDir = path.join(process.cwd(), 'data', 'proofs');
if (!fs.existsSync(proofDir)) {
  fs.mkdirSync(proofDir, { recursive: true });
}

/**
 * Handles image media messages as payment proofs
 * ONLY triggers if:
 * 1. The image message is a reply (quoted message) to the invoice/QRIS message
 * 2. The exact user ID (customerJid) has an active pending invoice
 */
async function handlePaymentProof(sock, msg, customerJid, chatJid, isGroup) {
  const realMsg = getRealMessage(msg.message);
  if (!realMsg || !realMsg.imageMessage) return false;

  // 1. Check if the image message is a reply to another message (quoted message)
  const contextInfo = realMsg.imageMessage.contextInfo;
  if (!contextInfo || !contextInfo.quotedMessage) {
    // Image sent without replying to invoice message -> Ignore as regular image
    return false;
  }

  // 2. Verify that the exact user ID (customerJid) has an active pending invoice
  const invoice = invoiceRepo.getPendingInvoiceForUser(customerJid, chatJid);
  if (!invoice) {
    console.log(`ℹ️ [PROOF] Gambar balasan diterima dari ${customerJid}, tetapi pengguna ini tidak memiliki invoice pending.`);
    return false;
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
      text: `✅ Bukti Pembayaran Diterima!\n\nNo. Invoice: ${invoice.invoice_number}\nTotal: ${formatRupiah(invoice.amount)}\n\nBukti pembayaran Anda telah diteruskan ke Admin untuk diverifikasi.\n\nabyn.xyz`
    }, { quoted: msg });

    // Forward proof screenshot & notification to Admin
    const adminRaw = process.env.ADMIN_NUMBER || '';
    if (adminRaw) {
      const adminPure = invoiceRepo.getPureNumber(adminRaw);
      const adminJid = `${adminPure}@s.whatsapp.net`;
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
