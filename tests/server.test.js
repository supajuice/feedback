'use strict';
// The feedback script (apps-script/Code.gs) against the in-memory Apps Script stand-in.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas, MockSpreadsheet } = require('./gas-mock');

const ORDER_HEADERS = ['Invoice', 'Created', 'Source', 'Name', 'Contact', 'Address', 'Notes', 'Qty', 'Unit price',
  'Delivery fee', 'Total', 'Status', 'Paid on', 'Delivered on', 'Request ID', 'Email'];

// A pretend order Sheet with a few orders, and the feedback script set up next to it.
function feedback(opts) {
  opts = opts || {};
  const orders = new MockSpreadsheet();
  const tab = orders.insertSheet('Orders');
  const rows = [ORDER_HEADERS].concat([
    ['SJ-0001', '2026-10-01 09:00', 'kiosk', 'Thandi', '', '', '', 3, 40, 30, 150, 'Delivered', '2026-10-01 10:00', '2026-10-02 10:00', 'a', 'Thandi@Example.com'],
    ['SJ-0002', '2026-10-05 09:00', 'kiosk', 'Naledi', '', '', '', 2, 40, 30, 110, 'Cancelled', '', '', 'b', 'naledi@example.com'],
    ['SJ-0003', '2026-10-06 09:00', 'kiosk', 'Pieter', '', '', '', 5, 40, 30, 230, 'Awaiting payment', '', '', 'c', 'pieter@example.com'],
    ['SJ-0004', '2026-10-20 09:00', 'kiosk', 'Thandi', '', '', '', 1, 40, 30, 70, 'Paid', '2026-10-20 10:00', '', 'd', 'thandi@example.com']
  ]);
  tab.getRange(1, 1, rows.length, ORDER_HEADERS.length).setValues(rows);
  const before = JSON.stringify(Array.from(tab.cells.entries()));
  const gas = createGas({ sheets: { 'order-sheet-id': orders } });
  gas.run('setup()');
  if (opts.connected !== false) gas.store.set('ORDER_SHEET_ID', opts.orderSheetId || 'order-sheet-id');
  const review = (over) => gas.call(Object.assign({ action: 'review', stars: 5, share: 'yes', email: 'thandi@example.com', text: 'Lovely', website: '' }, over));
  const suggest = (over) => gas.call(Object.assign({ action: 'suggest', topic: 'A new flavour', text: 'A lemon one, please!', website: '' }, over));
  const ordersUnchanged = () => JSON.stringify(Array.from(tab.cells.entries())) === before;
  return { gas, review, suggest, ordersUnchanged };
}

test('setup makes the Reviews and Suggestions tabs, and is safe to run again', () => {
  const { gas } = feedback();
  assert.deepEqual(gas.sheet('Reviews').getRange(1, 1, 1, 11).getValues()[0],
    ['Received', 'Stars', 'Flavour', 'Used for', 'Review', 'Name', 'Email', 'May post', 'Verified buyer', 'Invoice', 'Show on site']);
  assert.deepEqual(gas.sheet('Suggestions').getRange(1, 1, 1, 5).getValues()[0], ['Received', 'Topic', 'Idea', 'Name', 'Email']);
  assert.equal(gas.sheet('Sheet1'), null);
  gas.run('setup()');
  assert.equal(gas.rows('Reviews').length, 0);
  assert.match(gas.logs.join('\n'), /Buyer check/);
  assert.deepEqual(JSON.parse(gas.ctx.doGet().getContent()), { ok: true, service: 'feedback' });
});

test('a review from a buyer is saved and marked verified with their newest order', () => {
  const t = feedback();
  const r = t.review({ email: '  THANDI@example.com ', stars: 4, flavour: 'Orange', used: ['Running', 'Gym', 'Running', 'Flying'], text: 'Tasted like real oranges.\n\nNo stomach trouble.', name: 'Thandi M' });
  assert.deepEqual(r, { ok: true }, 'the reply never says whether the email belongs to a buyer');
  const row = t.gas.rows('Reviews')[0];
  assert.equal(row.Received, '2026-10-28 15:41');
  assert.equal(row.Stars, 4);
  assert.equal(row.Flavour, 'Orange');
  assert.equal(row['Used for'], 'Running, Gym', 'unknown and repeated choices are dropped');
  assert.equal(row.Review, 'Tasted like real oranges.\n\nNo stomach trouble.');
  assert.equal(row.Name, 'Thandi M');
  assert.equal(row.Email, 'thandi@example.com');
  assert.equal(row['May post'], 'yes');
  assert.equal(row['Verified buyer'], 'yes');
  assert.equal(row.Invoice, 'SJ-0004', 'the newest paid or delivered order');
  assert.equal(row['Show on site'], '', 'Greg decides');
  assert.equal(t.ordersUnchanged(), true, 'the order Sheet is only read');
});

test('cancelled and unpaid orders, and strangers, are not verified buyers', () => {
  const t = feedback();
  ['naledi@example.com', 'pieter@example.com', 'someone@example.com'].forEach((email) => {
    assert.deepEqual(t.review({ email }), { ok: true });
  });
  assert.deepEqual(t.gas.rows('Reviews').map((r) => [r['Verified buyer'], r.Invoice]), [['no', ''], ['no', ''], ['no', '']]);
});

test('without the order Sheet the review is still saved, marked not checked', () => {
  const unconnected = feedback({ connected: false });
  assert.deepEqual(unconnected.review(), { ok: true });
  assert.equal(unconnected.gas.rows('Reviews')[0]['Verified buyer'], 'not checked');
  const wrong = feedback({ orderSheetId: 'nope' });
  wrong.review();
  assert.equal(wrong.gas.rows('Reviews')[0]['Verified buyer'], 'not checked');
  // The whole address of the order Sheet works as well as its ID.
  const address = feedback({ orderSheetId: 'https://docs.google.com/spreadsheets/d/order-sheet-id/edit#gid=0' });
  address.review();
  assert.equal(address.gas.rows('Reviews')[0]['Verified buyer'], 'yes');
});

test('a review needs a star, an answer to "may we post it" and an email; the words are optional', () => {
  const t = feedback();
  const bad = (over) => t.review(over);
  assert.equal(bad({ stars: 0 }).field, 'stars');
  assert.equal(bad({ stars: 6 }).field, 'stars');
  assert.equal(bad({ stars: 2.5 }).field, 'stars');
  assert.equal(bad({ share: '' }).field, 'share');
  assert.equal(bad({ share: 'maybe' }).field, 'share');
  assert.equal(bad({ email: '' }).field, 'email');
  assert.match(bad({ email: '' }).message, /email you ordered with/);
  assert.equal(bad({ email: 'not-an-email' }).field, 'email');
  assert.equal(t.gas.rows('Reviews').length, 0);
  assert.deepEqual(t.review({ text: '', name: '', flavour: 'Lemon' }), { ok: true });
  const row = t.gas.rows('Reviews')[0];
  assert.equal(row.Review, '');
  assert.equal(row.Flavour, '', 'unknown flavours are dropped');
});

test('long text is cut, and text that looks like a formula is kept as plain text', () => {
  const t = feedback();
  t.review({ text: '=HYPERLINK("http://x")' + 'a'.repeat(700), name: '@me' });
  const row = t.gas.rows('Reviews')[0];
  assert.equal(row.Review.length, 601, 'a leading space, then 600 letters');
  assert.ok(row.Review.startsWith(' =HYPERLINK'));
  assert.equal(row.Name, ' @me');
});

test('a suggestion needs a topic and a few words; the email is optional', () => {
  const t = feedback();
  assert.equal(t.suggest({ topic: 'Cheaper gels' }).field, 'topic');
  assert.equal(t.suggest({ text: 'Lemon?' }).field, 'text');
  assert.equal(t.suggest({ email: 'nope' }).field, 'email');
  assert.equal(t.gas.rows('Suggestions').length, 0);
  assert.deepEqual(t.suggest({ email: 'Sam@Example.com', name: 'Sam' }), { ok: true });
  assert.deepEqual(t.suggest({ topic: 'The website', text: 'A dark mode would be nice.' }), { ok: true });
  assert.deepEqual(t.gas.rows('Suggestions').map((r) => [r.Topic, r.Idea, r.Name, r.Email]), [
    ['A new flavour', 'A lemon one, please!', 'Sam', 'sam@example.com'],
    ['The website', 'A dark mode would be nice.', '', '']
  ]);
});

test('bots that fill in the hidden field get a thank-you, and nothing is saved', () => {
  const t = feedback();
  assert.deepEqual(t.review({ website: 'http://spam.example' }), { ok: true });
  assert.deepEqual(t.suggest({ website: 'x' }), { ok: true });
  assert.equal(t.gas.rows('Reviews').length + t.gas.rows('Suggestions').length, 0);
});

test('at most 30 an hour, so the Sheet cannot be flooded', () => {
  const t = feedback();
  for (let i = 0; i < 20; i++) assert.equal(t.review().ok, true);
  for (let i = 0; i < 10; i++) assert.equal(t.suggest().ok, true);
  const r = t.review();
  assert.equal(r.error, 'busy');
  assert.equal(t.gas.rows('Reviews').length, 20);
  // The next hour is fine again.
  t.gas.clock.now += 60 * 60 * 1000;
  assert.equal(t.review().ok, true);
});

test('bad requests get a clear answer', () => {
  const t = feedback();
  assert.equal(t.gas.raw('not json').error, 'bad_request');
  assert.equal(t.gas.call({ action: 'list' }).error, 'bad_request');
  t.gas.lock.failNext = true;
  assert.equal(t.review().error, 'busy');
});

test('the carousel only gets reviews that may be posted, are from a buyer, and Greg marked to show', () => {
  const { gas, review } = feedback();
  review({ stars: 5, text: 'Shown one', used: ['Trail running'], flavour: 'Cranberry', name: 'Thandi' });
  review({ stars: 4, text: 'Not ticked yet' });
  review({ stars: 5, text: 'Private', share: 'no' });
  review({ stars: 5, text: 'Not a buyer', email: 'stranger@example.com' });
  review({ stars: 3, text: 'Also shown', used: ['Road running', 'Gym'] });
  const sheet = gas.sheet('Reviews');
  [2, 4, 5, 6].forEach((row) => sheet.getRange(row, 11).setValue('yes')); // not row 3
  const get = (params) => JSON.parse(gas.ctx.doGet({ parameter: params }).getContent());
  const out = get({ action: 'reviews' });
  assert.equal(out.ok, true);
  assert.deepEqual(out.reviews, [
    { stars: 3, text: 'Also shown', flavour: '', used: 'Road running, Gym' },
    { stars: 5, text: 'Shown one', flavour: 'Cranberry', used: 'Trail running' }
  ]);
  assert.doesNotMatch(JSON.stringify(out), /thandi|example\.com|SJ-/i, 'no names, emails or invoices');
  assert.deepEqual(get({}), { ok: true, service: 'feedback' });
});
