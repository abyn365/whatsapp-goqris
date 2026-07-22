const path = require('path');
const fs = require('fs');
const assert = require('assert');

// Load environment variables
require('dotenv').config();

const { calcCRC16, validateCRC16 } = require('../src/qris/crc16');
const { parseTLV, buildTLV } = require('../src/qris/parser');
const { convertStaticToDynamic, sanitizeQrisString } = require('../src/qris/converter');
const { generateQRBuffer } = require('../src/qris/qr-generator');
const invoiceRepo = require('../src/database/invoice-repo');
const { createInvoiceService, formatRupiah } = require('../src/services/invoice-service');
const { getRealMessage, getTextFromMessage } = require('../src/bot/message-handler');

async function runTests() {
  console.log('🧪 Starting Unit & Integration Test Suite...\n');

  // User's actual static QRIS payload
  const userStaticQris = '00020101021126610014COM.GO-JEK.WWW01189360091434842069580210G4842069580303UMI51440014ID.CO.QRIS.WWW0215ID10265535641090303UMI5204899953033605802ID5925ABYN.XYZ, Digital & Kreat6006BANTUL61055575262070703A0163045B58';

  // Test 1: CRC16 Calculation & Validation
  console.log('1️⃣ Testing CRC16 Checksum Calculation & Validation...');
  const isValidCrc = validateCRC16(userStaticQris);
  console.log('   User Static QRIS Valid CRC:', isValidCrc);
  assert.strictEqual(isValidCrc, true, 'CRC16 validation failed for user static QRIS');
  console.log('   ✅ CRC16 Checksum test passed.\n');

  // Test 2: Static to Dynamic Conversion with EMVCo Tag 54 Order Verification
  console.log('2️⃣ Testing Static to Dynamic QRIS Conversion (Tag 54 after Tag 53)...');
  const testAmount = 50000; // Rp 50.000
  const dynamicQris = convertStaticToDynamic(userStaticQris, testAmount);
  
  console.log('   Original Static QRIS length:', userStaticQris.length);
  console.log('   Generated Dynamic QRIS length:', dynamicQris.length);
  console.log('   Generated Dynamic Payload:', dynamicQris);

  // Verify EMVCo compliance: Tag 53 (360) must come BEFORE Tag 54 (50000)
  const idx53 = dynamicQris.indexOf('5303360');
  const idx54 = dynamicQris.indexOf('540550000');
  assert.ok(idx53 !== -1, 'Tag 53 (Currency) missing');
  assert.ok(idx54 !== -1, 'Tag 54 (Amount) missing');
  assert.ok(idx53 < idx54, 'EMVCo Violation: Tag 53 must come BEFORE Tag 54');
  assert.strictEqual(validateCRC16(dynamicQris), true, 'Generated dynamic QRIS has invalid CRC16 checksum');
  console.log('   ✅ Tag 54 EMVCo placement & Dynamic QRIS conversion test passed.\n');

  // Test 3: QR Code Image Generation Buffer
  console.log('3️⃣ Testing QR Code PNG Buffer Generation...');
  const qrBuffer = await generateQRBuffer(dynamicQris);
  assert.ok(Buffer.isBuffer(qrBuffer), 'QR Buffer is not a Buffer instance');
  assert.ok(qrBuffer.length > 500, 'QR Buffer size is suspiciously small');
  console.log(`   QR Buffer generated successfully (${qrBuffer.length} bytes)`);
  console.log('   ✅ QR Code Buffer test passed.\n');

  // Test 4: Database & Invoice Workflow
  console.log('4️⃣ Testing Database Invoice & Timestamp Recording...');
  const { invoice, invoiceText } = await createInvoiceService({
    customerJid: '6285117569816:45@s.whatsapp.net',
    customerName: 'Abyn Admin',
    chatJid: '6285117569816@s.whatsapp.net',
    isGroup: false,
    amount: 75000,
    itemsSummary: 'Kopi Espresso x2, Roti Bakar x1',
    notes: 'Tanpa gula'
  });

  console.log('   Generated Invoice Number:', invoice.invoice_number);
  console.log('   Invoice Created At:', invoice.created_at);
  console.log('   Formatted Rupiah:', formatRupiah(invoice.amount));
  
  assert.strictEqual(invoice.amount, 75000);
  assert.strictEqual(invoice.status, 'PENDING');
  assert.ok(invoice.created_at.includes('WIB'), 'Timestamp missing WIB timezone');
  assert.ok(invoiceText.includes('75.000'), 'Invoice text missing formatted amount');
  assert.ok(invoiceText.includes('abyn.xyz'), 'Invoice text missing copyright abyn.xyz');

  // Test status updates
  invoiceRepo.updateInvoiceProof(invoice.id, './data/proofs/test_proof.jpg');
  const proofInv = invoiceRepo.getInvoiceById(invoice.id);
  assert.strictEqual(proofInv.status, 'PROOF_SUBMITTED');

  invoiceRepo.markInvoicePaid(invoice.id);
  const paidInv = invoiceRepo.getInvoiceById(invoice.id);
  assert.strictEqual(paidInv.status, 'PAID');
  assert.ok(paidInv.paid_at.length > 0, 'Paid timestamp missing');

  // Test 5: Admin JID normalization check
  console.log('5️⃣ Testing Admin JID Normalization (getPureNumber)...');
  const pureNum = invoiceRepo.getPureNumber('6285117569816:45@s.whatsapp.net');
  assert.strictEqual(pureNum, '6285117569816');
  console.log('   Pure Admin Number:', pureNum);
  console.log('   ✅ Admin JID Normalization test passed.\n');

  console.log('🎉 ALL TESTS COMPLETED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
