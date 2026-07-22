const path = require('path');
const fs = require('fs');
const assert = require('assert');

// Load environment variables
require('dotenv').config();

const { calcCRC16, validateCRC16 } = require('../src/qris/crc16');
const { parseTLV, buildTLV } = require('../src/qris/parser');
const { convertStaticToDynamic } = require('../src/qris/converter');
const { generateQRBuffer } = require('../src/qris/qr-generator');
const invoiceRepo = require('../src/database/invoice-repo');
const { createInvoiceService, formatRupiah } = require('../src/services/invoice-service');
const { getRealMessage, getTextFromMessage } = require('../src/bot/message-handler');

async function runTests() {
  console.log('🧪 Starting Unit & Integration Test Suite...\n');

  // Sample static QRIS string with valid CRC (8D64)
  const sampleStr = '00020101021126680016ID.CO.QRIS.WWW01189360091400000000000215ID10265535641090303A0151440014ID.LINKAJA.WWW01189360091400000000005204581253033605802ID5910ABYN.XYZ, 6013KOTA JAKARTA 61051234562070703A0163048D64';

  // Test 1: CRC16 Calculation & Validation
  console.log('1️⃣ Testing CRC16 Checksum Calculation & Validation...');
  const isValidCrc = validateCRC16(sampleStr);
  console.log('   Sample Static QRIS Valid CRC:', isValidCrc);
  assert.strictEqual(isValidCrc, true, 'CRC16 validation failed for sample static QRIS');
  console.log('   ✅ CRC16 Checksum test passed.\n');

  // Test 2: Static to Dynamic Conversion
  console.log('2️⃣ Testing Static to Dynamic QRIS Conversion...');
  const testAmount = 50000; // Rp 50.000
  const dynamicQris = convertStaticToDynamic(sampleStr, testAmount);
  
  console.log('   Original Static QRIS length:', sampleStr.length);
  console.log('   Generated Dynamic QRIS length:', dynamicQris.length);
  console.log('   Generated Dynamic Payload:', dynamicQris);

  // Assertions
  assert.strictEqual(validateCRC16(dynamicQris), true, 'Generated dynamic QRIS has invalid CRC16 checksum');
  assert.ok(dynamicQris.includes('010212'), 'Tag 01 was not updated to 12 (Dynamic)');
  assert.ok(dynamicQris.includes('540550000'), 'Tag 54 with amount 50000 (length 05) was not found');
  console.log('   ✅ Static to Dynamic QRIS conversion test passed.\n');

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
    customerJid: '628999888777@s.whatsapp.net',
    customerName: 'Budi Santoso',
    chatJid: '628999888777@s.whatsapp.net',
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

  // Test status updates
  invoiceRepo.updateInvoiceProof(invoice.id, './data/proofs/test_proof.jpg');
  const proofInv = invoiceRepo.getInvoiceById(invoice.id);
  assert.strictEqual(proofInv.status, 'PROOF_SUBMITTED');

  invoiceRepo.markInvoicePaid(invoice.id);
  const paidInv = invoiceRepo.getInvoiceById(invoice.id);
  assert.strictEqual(paidInv.status, 'PAID');
  assert.ok(paidInv.paid_at.length > 0, 'Paid timestamp missing');

  // Test 5: Ephemeral / Disappearing Message Unwrapping
  console.log('5️⃣ Testing Ephemeral & Wrapped Message Parsing...');
  const mockEphemeralMsg = {
    ephemeralMessage: {
      message: {
        extendedTextMessage: { text: '!qris 25000 Espresso' }
      }
    }
  };

  const unwrapped = getRealMessage(mockEphemeralMsg);
  const text = getTextFromMessage(unwrapped);
  assert.strictEqual(text, '!qris 25000 Espresso');
  console.log('   Extracted Ephemeral Text:', text);
  console.log('   ✅ Ephemeral Message Parsing test passed.\n');

  console.log('🎉 ALL TESTS COMPLETED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
