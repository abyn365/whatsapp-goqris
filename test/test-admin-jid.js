const assert = require('assert');
const { cleanJid, normalizePhoneNumber, getPureNumber, extractAllSenderJids, registerJidPair, getAlternateJid, safeSendMessage } = require('../src/utils/message-utils');
const invoiceRepo = require('../src/database/invoice-repo');

async function testJidAndAdminSupport() {
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

  // Test 3: Bi-directional LID <-> PN Pair Registration
  console.log('3️⃣ Testing bi-directional LID <-> PN pair registration & lookup...');
  registerJidPair('197341567021139@lid', '6285117569816@s.whatsapp.net');
  assert.strictEqual(getAlternateJid('197341567021139@lid'), '6285117569816@s.whatsapp.net');
  assert.strictEqual(getAlternateJid('6285117569816@s.whatsapp.net'), '197341567021139@lid');
  console.log('   ✅ Bi-directional LID <-> PN pair registration test passed.\n');

  // Test 4: Admin matching with @lid and @s.whatsapp.net formats when .env has phone number
  console.log('4️⃣ Testing Admin JID matching (@lid sender matching phone in .env)...');
  process.env.ADMIN_JID = '6285117569816@s.whatsapp.net';

  // Sender sending from @lid matching linked phone in .env
  assert.strictEqual(invoiceRepo.isAdmin('197341567021139:10@lid'), true);
  // Sender sending from @s.whatsapp.net matching phone in .env
  assert.strictEqual(invoiceRepo.isAdmin('6285117569816:5@s.whatsapp.net'), true);

  // Non-admin user
  assert.strictEqual(invoiceRepo.isAdmin('628111222333@s.whatsapp.net'), false);
  console.log('   ✅ Admin JID matching test passed.\n');

  // Test 5: safeSendMessage Dual Routing Mock Test
  console.log('5️⃣ Testing safeSendMessage dual routing...');
  const sentRecipients = [];
  const mockSock = {
    sendMessage: async (jid, content, options) => {
      sentRecipients.push(jid);
      return { key: { remoteJid: jid, id: 'MOCK123' } };
    }
  };

  await safeSendMessage(mockSock, '197341567021139@lid', { text: 'Test' });
  assert.ok(sentRecipients.includes('197341567021139@lid'), 'Should send to primary LID');
  assert.ok(sentRecipients.includes('6285117569816@s.whatsapp.net'), 'Should also send to linked alternate PN');
  console.log('   ✅ safeSendMessage dual routing test passed.\n');

  console.log('🎉 ALL JID & ADMIN TESTS PASSED!');
}

testJidAndAdminSupport().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
