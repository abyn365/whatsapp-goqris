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
const { createInvoiceService, formatRupiah, getHumanStatus } = require('../src/services/invoice-service');

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
  
  const idx53 = dynamicQris.indexOf('5303360');
  const idx54 = dynamicQris.indexOf('540550000');
  assert.ok(idx53 !== -1, 'Tag 53 (Currency) missing');
  assert.ok(idx54 !== -1, 'Tag 54 (Amount) missing');
  assert.ok(idx53 < idx54, 'EMVCo Violation: Tag 53 must come BEFORE Tag 54');
  assert.strictEqual(validateCRC16(dynamicQris), true, 'Generated dynamic QRIS has invalid CRC16 checksum');
  console.log('   ✅ Tag 54 EMVCo placement & Dynamic QRIS conversion test passed.\n');

  // Test 3: QR Code PNG Buffer Generation
  console.log('3️⃣ Testing QR Code PNG Buffer Generation...');
  const qrBuffer = await generateQRBuffer(dynamicQris);
  assert.ok(Buffer.isBuffer(qrBuffer), 'QR Buffer is not a Buffer instance');
  assert.ok(qrBuffer.length > 500, 'QR Buffer size is suspiciously small');
  console.log(`   QR Buffer generated successfully (${qrBuffer.length} bytes)`);
  console.log('   ✅ QR Code Buffer test passed.\n');

  // Test 4: Database & Invoice Workflow with Rejection & Flexible INV- Prefix
  console.log('4️⃣ Testing Database Invoice, Flexible INV- Prefix & Rejection Workflow...');
  const { invoice, invoiceText } = await createInvoiceService({
    customerJid: '197341567021139@lid',
    customerName: 'Abyn Admin',
    chatJid: '197341567021139@lid',
    isGroup: false,
    amount: 75000,
    itemsSummary: 'Kopi Espresso x2, Roti Bakar x1',
    notes: 'Tanpa gula'
  });

  console.log('   Generated Invoice Number:', invoice.invoice_number);
  
  // Test lookup without INV- prefix (e.g. '20260722-0001')
  const rawNum = invoice.invoice_number.replace('INV-', '');
  const foundByRaw = invoiceRepo.getInvoiceByNumber(rawNum);
  assert.ok(foundByRaw, `Failed to lookup invoice without INV- prefix (${rawNum})`);
  assert.strictEqual(foundByRaw.id, invoice.id);
  console.log(`   Lookup without INV- prefix (${rawNum}) -> Found: ${foundByRaw.invoice_number}`);

  // Test status updates to PROOF_SUBMITTED
  invoiceRepo.updateInvoiceProof(invoice.id, './data/proofs/test_proof.jpg');
  const proofInv = invoiceRepo.getInvoiceById(invoice.id);
  assert.strictEqual(proofInv.status, 'PROOF_SUBMITTED');
  assert.strictEqual(getHumanStatus(proofInv.status), 'Menunggu Verifikasi Admin');

  // Test status update to REJECTED with reason
  const rejectionReason = 'Foto bukti transfer tidak jelas';
  invoiceRepo.rejectInvoiceProof(invoice.id, rejectionReason);
  const rejectedInv = invoiceRepo.getInvoiceById(invoice.id);
  assert.strictEqual(rejectedInv.status, 'REJECTED');
  assert.strictEqual(rejectedInv.rejection_reason, rejectionReason);

  // Test status update to PAID
  invoiceRepo.markInvoicePaid(invoice.id);
  const paidInv = invoiceRepo.getInvoiceById(invoice.id);
  assert.strictEqual(paidInv.status, 'PAID');

  console.log('   ✅ Flexible Invoice Number & Rejection Workflow test passed.\n');

  // Test 5: Recap Query Test (getActiveAndRejectedInvoices)
  console.log('5️⃣ Testing Recap Query (getActiveAndRejectedInvoices)...');
  const { invoice: activeInv } = await createInvoiceService({
    customerJid: '6281234567890@s.whatsapp.net',
    customerName: 'Budi Test',
    chatJid: '6281234567890@s.whatsapp.net',
    isGroup: false,
    amount: 15000,
    itemsSummary: 'Teh Obeng',
    notes: ''
  });

  const activeAndRejected = invoiceRepo.getActiveAndRejectedInvoices({ limit: 10 });
  const hasActiveInv = activeAndRejected.some(i => i.id === activeInv.id);
  assert.strictEqual(hasActiveInv, true, 'Recap query should return newly created active invoice');
  console.log(`   Found ${activeAndRejected.length} active/rejected invoices for recap`);
  console.log('   ✅ Recap Query test passed.\n');

  console.log('🎉 ALL TESTS COMPLETED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
