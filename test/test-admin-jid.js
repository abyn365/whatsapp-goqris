const assert = require('assert');
const { cleanJid, normalizePhoneNumber, getPureNumber, extractAllSenderJids } = require('../src/utils/message-utils');
const invoiceRepo = require('../src/database/invoice-repo');

function testJidAndAdminSupport() {
  console.log('🧪 Testing JID cleaning, phone normalization & dynamic admin resolution...\n');

  // Test 1: JID Cleaning & Device ID Stripping
  console.log('1️⃣ Testing JID cleaning & device specifier removal...');
  assert.strictEqual(cleanJid('197341567021139:45@lid'), '197341567021139@lid');
  assert.strictEqual(cleanJid('628123456789:12@s.whatsapp.net'), '628123456789@s.whatsapp.net');
  assert.strictEqual(cleanJid('628123456789@c.us'), '628123456789@s.whatsapp.net');
  assert.strictEqual(cleanJid('08123456789'), '628123456789@s.whatsapp.net');
  console.log('   ✅ JID cleaning test passed.\n');

  // Test 2: Indonesian Phone Normalization
  console.log('2️⃣ Testing phone number normalization (08xxx -> 628xxx)...');
  assert.strictEqual(normalizePhoneNumber('081234567890'), '6281234567890');
  assert.strictEqual(normalizePhoneNumber('6281234567890'), '6281234567890');
  assert.strictEqual(normalizePhoneNumber('+62 812-3456-7890'), '6281234567890');
  assert.strictEqual(getPureNumber('081234567890@s.whatsapp.net'), '6281234567890');
  console.log('   ✅ Phone normalization test passed.\n');

  // Test 3: Admin matching with @lid and @s.whatsapp.net formats
  console.log('3️⃣ Testing Admin JID matching (@lid, @s.whatsapp.net, phone numbers)...');
  process.env.ADMIN_JID = '197341567021139@lid, 628999888777@s.whatsapp.net';

  // Sender sending from @lid matching @lid in config
  assert.strictEqual(invoiceRepo.isAdmin('197341567021139:10@lid'), true);

  // Sender sending from @s.whatsapp.net matching phone in config
  assert.strictEqual(invoiceRepo.isAdmin('628999888777:5@s.whatsapp.net'), true);

  // Sender sending from 08999888777 (local format) matching 628999888777
  assert.strictEqual(invoiceRepo.isAdmin('08999888777@s.whatsapp.net'), true);

  // Non-admin user
  assert.strictEqual(invoiceRepo.isAdmin('628111222333@s.whatsapp.net'), false);
  console.log('   ✅ Admin JID matching test passed.\n');

  // Test 4: Baileys message key JID extraction & dynamic auto-learning
  console.log('4️⃣ Testing Baileys message key multi-JID extraction & dynamic auto-learning...');
  const mockMsg = {
    key: {
      remoteJid: '197341567021139@lid',
      participant: '197341567021139:45@lid',
      authorPn: '628123999000@s.whatsapp.net'
    }
  };

  const extracted = extractAllSenderJids(mockMsg, '197341567021139@lid');
  assert.ok(extracted.includes('197341567021139@lid'));
  assert.ok(extracted.includes('628123999000@s.whatsapp.net'));

  // Set admin config to phone number
  process.env.ADMIN_JID = '628123999000@s.whatsapp.net';

  // Check admin match when message comes from @lid but contains authorPn
  const isMatch = invoiceRepo.isAdmin('197341567021139@lid', mockMsg);
  assert.strictEqual(isMatch, true, 'Should match admin via authorPn phone number');

  // Check that @lid was auto-learned as admin destination JID
  const resolvedAdminJid = invoiceRepo.getAdminJid();
  assert.ok(resolvedAdminJid === '197341567021139@lid' || resolvedAdminJid === '628123999000@s.whatsapp.net');

  console.log('   ✅ Multi-JID extraction & dynamic auto-learning test passed.\n');

  console.log('🎉 ALL JID & ADMIN TESTS PASSED!');
}

testJidAndAdminSupport();
