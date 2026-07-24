const assert = require('assert');
const { cleanJid, normalizePhoneNumber, getPureNumber, extractAllSenderJids, registerJidPair, getAlternateJid, getDeliverableJid, sanitizeMentions, sanitizeQuotedMessage, safeSendMessage } = require('../src/utils/message-utils');
const invoiceRepo = require('../src/database/invoice-repo');

async function testJidAndAdminSupport() {
  console.log('🧪 Testing JID cleaning, phone normalization & deliverable target resolution...\n');

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

  // Test 3: Bi-directional LID <-> PN Pair Registration & Deliverable Resolution
  console.log('3️⃣ Testing bi-directional LID <-> PN pair registration & deliverable resolution...');
  registerJidPair('197341567021139@lid', '6285117569816@s.whatsapp.net');
  assert.strictEqual(getAlternateJid('197341567021139@lid'), '6285117569816@s.whatsapp.net');
  assert.strictEqual(getDeliverableJid('197341567021139@lid'), '6285117569816@s.whatsapp.net');
  assert.strictEqual(getDeliverableJid('120363000@g.us'), '120363000@g.us');
  console.log('   ✅ Bi-directional LID <-> PN pair deliverable resolution test passed.\n');

  // Test 4: Mention & Quoted Message Sanitization
  console.log('4️⃣ Testing mention & quoted message key sanitization...');
  const sanitizedMents = sanitizeMentions(['197341567021139@lid', '628123456789@s.whatsapp.net']);
  assert.strictEqual(sanitizedMents.includes('6285117569816@s.whatsapp.net'), true);
  assert.strictEqual(sanitizedMents.includes('628123456789@s.whatsapp.net'), true);

  const mockQuoted = { key: { remoteJid: '197341567021139@lid', id: 'MSG123' } };
  const sanitizedQuoted = sanitizeQuotedMessage(mockQuoted, '197341567021139@lid');
  assert.strictEqual(sanitizedQuoted.key.remoteJid, '197341567021139@lid');
  console.log('   ✅ Mention & quoted message key sanitization test passed.\n');

  // Test 5: Admin matching with @lid and @s.whatsapp.net formats when .env has phone number
  console.log('5️⃣ Testing Admin JID matching (@lid sender matching phone in .env)...');
  process.env.ADMIN_JID = '6285117569816@s.whatsapp.net';

  // Sender sending from @lid matching linked phone in .env
  assert.strictEqual(invoiceRepo.isAdmin('197341567021139:10@lid'), true);
  // Sender sending from @s.whatsapp.net matching phone in .env
  assert.strictEqual(invoiceRepo.isAdmin('6285117569816:5@s.whatsapp.net'), true);

  // Non-admin user
  assert.strictEqual(invoiceRepo.isAdmin('628111222333@s.whatsapp.net'), false);
  console.log('   ✅ Admin JID matching test passed.\n');

  // Test 6: safeSendMessage Chat Thread Target Delivery (DM vs Group)
  console.log('6️⃣ Testing safeSendMessage chat thread target delivery (DM vs Group)...');
  let sentTargetJid = '';
  let sentMentions = [];
  let sentQuotedJid = '';

  const mockSock = {
    sendMessage: async (jid, content, options) => {
      sentTargetJid = jid;
      sentMentions = content.mentions || [];
      sentQuotedJid = options?.quoted?.key?.remoteJid || '';
      return { key: { remoteJid: jid, id: 'MOCK123' } };
    }
  };

  // Test DM (resolves @lid to @s.whatsapp.net, quoted removed to prevent WhatsApp silent drop)
  await safeSendMessage(mockSock, '197341567021139@lid', {
    text: 'Test DM',
    mentions: ['197341567021139@lid']
  }, {
    quoted: { key: { remoteJid: '197341567021139@lid', id: 'Q1' } }
  });

  assert.strictEqual(sentTargetJid, '6285117569816@s.whatsapp.net');
  assert.strictEqual(sentMentions[0], '6285117569816@s.whatsapp.net');
  assert.strictEqual(sentQuotedJid, '', 'Quoted should be omitted in DM to prevent WhatsApp silent drop');

  // Test Group (quoted preserved for group chats)
  await safeSendMessage(mockSock, '120363000@g.us', {
    text: 'Test Group'
  }, {
    quoted: { key: { remoteJid: '120363000@g.us', id: 'Q2' } }
  });

  assert.strictEqual(sentTargetJid, '120363000@g.us');
  assert.strictEqual(sentQuotedJid, '120363000@g.us', 'Quoted should be preserved in Group chat');

  console.log('   ✅ safeSendMessage chat thread target delivery test passed.\n');

  console.log('🎉 ALL JID & ADMIN TESTS PASSED!');
}

testJidAndAdminSupport().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
