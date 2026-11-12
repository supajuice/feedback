'use strict';
// Runs the reviews page in a real browser (Chromium) against the fake feedback service.
// Run with: npm test   (the browser tests need the playwright package and its Chromium; see README)
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startDevServer } = require('./dev-server');

let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { if (browser) await browser.close(); });

// A fresh fake service, browser context and page for one test. Everything is closed afterwards.
async function open(t, opts) {
  opts = opts || {};
  const dev = await startDevServer({ mode: opts.mode || 'seeded', latency: opts.latency || 0 });
  const ctx = await browser.newContext({
    viewport: { width: opts.width || 390, height: opts.height || 844 },
    deviceScaleFactor: 1,
    isMobile: opts.mobile !== false,
    hasTouch: opts.mobile !== false,
    colorScheme: opts.scheme || 'light'
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  t.after(async () => {
    await ctx.close();
    await dev.close();
  });
  return { dev, ctx, page, errors };
}

// The text as written (textContent), not as shown: some labels are uppercased by CSS.
async function text(page, selector) {
  return ((await page.locator(selector).textContent()) || '').trim();
}

test('reviews and suggestions, with a toggle, checked, and sent to the feedback Sheet', async (t) => {
  // The pretend orders: Thandi's SJ-0001 was delivered and Liam's SJ-0003 is paid.
  const { dev, page, errors } = await open(t);
  await page.goto(dev.siteUrl + '/');
  await page.waitForSelector('#fb-form');
  assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex, nofollow');
  // The header leads back to the shop, and shows Reviews as the current page, also on a phone.
  assert.equal(await page.isVisible('.bar-link--reviews'), true);
  assert.equal(await page.locator('.bar-link--reviews').getAttribute('aria-current'), 'page');
  assert.match(await page.locator('.bar-cta').getAttribute('href'), /^https:\/\/supajuice\.co\.za\/.*#order$/);
  assert.equal(await page.isHidden('#fb-demo-note'), true, 'it sends for real, so no demo note');

  // A review: a star and the email they ordered with are needed. The words are optional.
  assert.equal(await page.isVisible('#fb-review'), true);
  assert.equal(await page.isVisible('#fb-suggest'), false);
  assert.match(await text(page, '#fb-email-note'), /won't spam you[\s\S]*check you bought from us/);
  assert.equal(await page.isHidden('#fb-email-optional'), true);
  await page.click('#fb-send');
  assert.match(await text(page, '#fb-rating-error'), /Tap a star/);
  assert.match(await text(page, '#fb-email-error'), /email you ordered with/);
  assert.match(await text(page, '#fb-share-error'), /Choose yes or no/);
  assert.match(await text(page, '#fb-share-note'), /Never your name, email or any other personal details/);
  assert.equal(await page.locator('input[name="share"]:checked').count(), 0, 'nothing is picked for them');
  assert.equal(await page.isHidden('#fb-review-text-error'), true, 'the written review is optional');
  await page.fill('#fb-email', 'thandi@');
  assert.equal(await page.isHidden('#fb-email-error'), true, 'typing clears the message');
  await page.click('#fb-send');
  assert.match(await text(page, '#fb-email-error'), /Check the email/);
  await page.fill('#fb-email', 'thandi@example.com');
  await page.click('.fb-choice:has(input[name="share"][value="yes"])');
  assert.equal(await page.isHidden('#fb-share-error'), true);
  await page.click('.fb-star:nth-child(4)');
  assert.equal(await text(page, '#fb-star-word'), 'Really good');
  assert.equal(await page.isHidden('#fb-rating-error'), true);
  await page.click('.fb-choice:has(input[value="Orange"])');
  await page.click('.fb-choice:has(input[value="Running"])');
  await page.fill('#fb-review-text', 'Tasted like real oranges, and no stomach trouble on a 21 km run.');
  assert.equal(await text(page, '#fb-review-count'), '64 / 600');
  await page.fill('#fb-name', 'Thandi Mokoena');
  await page.click('#fb-send');
  await page.waitForSelector('#fb-thanks:not([hidden])');
  assert.equal(await page.locator('#fb-thanks-title').textContent(), 'Thank you, Thandi!');
  assert.match(await text(page, '#fb-thanks-text'), /4-star review[\s\S]*check it against your order, then post it without any of your details/);
  assert.equal(await page.isHidden('#fb-thanks-demo'), true);
  let row = dev.gas.rows('Reviews')[0];
  assert.deepEqual([row.Stars, row.Flavour, row['Used for'], row.Name, row.Email, row['May post'], row['Verified buyer'], row.Invoice],
    [4, 'Orange', 'Running', 'Thandi Mokoena', 'thandi@example.com', 'yes', 'yes', 'SJ-0001']);
  assert.equal(row.Review, 'Tasted like real oranges, and no stomach trouble on a 21 km run.');

  // A review with only a star, an email and an answer is fine, and No keeps it private.
  await page.click('#fb-again');
  assert.equal(await page.locator('input[name="share"]:checked').count(), 0, 'the answer is cleared for the next one');
  await page.click('.fb-star:nth-child(5)');
  await page.fill('#fb-email', 'liam@example.com');
  await page.click('.fb-choice:has(input[name="share"][value="no"])');
  await page.click('#fb-send');
  await page.waitForSelector('#fb-thanks:not([hidden])');
  assert.equal(await page.locator('#fb-thanks-title').textContent(), 'Thank you!');
  assert.match(await text(page, '#fb-thanks-text'), /keep it private/);
  row = dev.gas.rows('Reviews')[1];
  assert.deepEqual([row.Stars, row.Review, row['May post'], row['Verified buyer'], row.Invoice], [5, '', 'no', 'yes', 'SJ-0003']);

  // The toggle switches to a suggestion, and the address says so. There the email is optional.
  await page.click('#fb-again');
  await page.click('.fb-toggle-option:has(input[value="suggest"])');
  assert.equal(await page.isVisible('#fb-suggest'), true);
  assert.equal(await page.isVisible('#fb-review'), false);
  assert.equal(new URL(page.url()).hash, '#suggest');
  assert.equal(await text(page, '#fb-send'), 'Send suggestion');
  assert.equal(await page.isVisible('#fb-email-optional'), true);
  assert.match(await text(page, '#fb-email-note'), /Only if you'd like us to get back to you/);
  await page.fill('#fb-suggest-text', 'A lemon flavour?');
  await page.fill('#fb-email', 'not an email');
  await page.click('#fb-send');
  assert.match(await text(page, '#fb-topic-error'), /Pick what/);
  assert.match(await text(page, '#fb-email-error'), /Check the email/);
  await page.click('.fb-choice:has(input[value="A new flavour"])');
  await page.fill('#fb-email', 'sam@example.com');
  await page.click('#fb-send');
  await page.waitForSelector('#fb-thanks:not([hidden])');
  assert.match(await text(page, '#fb-thanks-text'), /get back to you by email/);
  assert.deepEqual(dev.gas.rows('Suggestions').map((r) => [r.Topic, r.Idea, r.Email]), [['A new flavour', 'A lemon flavour?', 'sam@example.com']]);

  // A link can open the suggestion side directly.
  await page.goto('about:blank');
  await page.goto(dev.siteUrl + '/#suggest');
  assert.equal(await page.isVisible('#fb-suggest'), true);

  // Three sends, all simple requests (no preflight).
  const sent = dev.calls.filter((c) => c.method === 'POST');
  assert.deepEqual(sent.map((c) => c.action), ['review', 'review', 'suggest']);
  sent.forEach((c) => assert.match(c.contentType, /^text\/plain/));
  // Nothing was kept in the browser.
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
  assert.deepEqual(errors, []);

  // The local Sheet page shows what was saved.
  await page.goto(dev.siteUrl + '/sheet');
  assert.match(await text(page, 'body'), /Reviews \(2\)[\s\S]*thandi@example\.com[\s\S]*Suggestions \(1\)[\s\S]*A lemon flavour\?/);
});

test('a review from someone who has not bought is saved as not verified, and they are not told', async (t) => {
  const { dev, page } = await open(t);
  await page.goto(dev.siteUrl + '/');
  await page.waitForSelector('#fb-form');
  await page.click('.fb-star:nth-child(2)');
  await page.click('.fb-choice:has(input[name="share"][value="yes"])');
  await page.fill('#fb-email', 'naledi@example.com'); // cancelled her order
  await page.click('#fb-send');
  await page.waitForSelector('#fb-thanks:not([hidden])');
  assert.match(await text(page, '#fb-thanks-text'), /2-star review[\s\S]*check it against your order/, 'the same thanks as a buyer gets');
  const row = dev.gas.rows('Reviews')[0];
  assert.deepEqual([row.Email, row['Verified buyer'], row.Invoice], ['naledi@example.com', 'no', '']);
});

test('without a feedback address it sends nothing, and says so', async (t) => {
  const { dev, page } = await open(t);
  dev.setEndpoint('');
  await page.goto(dev.siteUrl + '/');
  await page.waitForSelector('#fb-form');
  assert.match(await text(page, '#fb-demo-note'), /nothing you write here is sent/);
  await page.click('.fb-star:nth-child(5)');
  await page.click('.fb-choice:has(input[name="share"][value="yes"])');
  await page.fill('#fb-email', 'jane@example.com');
  await page.click('#fb-send');
  await page.waitForSelector('#fb-thanks:not([hidden])');
  assert.match(await text(page, '#fb-thanks-demo'), /nothing was sent/);
  assert.equal(dev.calls.length, 0);
  assert.equal(dev.gas.rows('Reviews').length, 0);
});

test('when the feedback cannot be sent, it says so and keeps what was written', async (t) => {
  const { dev, page } = await open(t);
  dev.setEndpoint('http://127.0.0.1:9/exec');
  await page.goto(dev.siteUrl + '/#suggest');
  await page.waitForSelector('#fb-form');
  await page.click('.fb-choice:has(input[value="The website"])');
  await page.fill('#fb-suggest-text', 'Please add a dark mode.');
  await page.click('#fb-send');
  await page.waitForSelector('#fb-form-error:not([hidden])');
  assert.match(await text(page, '#fb-form-error'), /couldn't send that[\s\S]*still here/);
  assert.equal(await page.inputValue('#fb-suggest-text'), 'Please add a dark mode.');
  assert.equal(await page.isHidden('#fb-thanks'), true);
  assert.equal(await page.isDisabled('#fb-send'), false, 'they can try again');

  // A problem the feedback service finds is shown under its field.
  dev.setEndpoint(null);
  await page.reload();
  await page.waitForSelector('#fb-form');
  await page.route('**/exec', (route) => route.continue({ postData: JSON.stringify({ action: 'suggest', topic: 'Nope', text: 'Please add a dark mode.' }) }));
  await page.click('.fb-choice:has(input[value="The website"])');
  await page.fill('#fb-suggest-text', 'Please add a dark mode.');
  await page.click('#fb-send');
  await page.waitForSelector('#fb-topic-error:not([hidden])');
  assert.match(await text(page, '#fb-topic-error'), /Pick what your idea is about/);
});
