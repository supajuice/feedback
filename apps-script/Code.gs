/**
 * Supa Juice feedback: Google Apps Script backend for reviews and suggestions.
 *
 * Lives in its own Google Sheet ("Supa Juice Feedback", Extensions > Apps Script) and is
 * deployed as its own web app (Execute as: Me, Who has access: Anyone). It is separate from
 * the order backend: deploying this never changes the order page or its Sheet.
 *
 *   Reviews      one row per review, with whether the email belongs to a real buyer
 *   Suggestions  one row per idea
 *
 * To mark a review as a real buyer's, this script READS the order Sheet (its ID or address is
 * kept in Script properties as ORDER_SHEET_ID). It never writes to the order Sheet.
 *
 * The page calls this with POST requests. The body is JSON sent as text/plain, which avoids a
 * CORS preflight request (Apps Script cannot answer one).
 *
 * Public actions   review, suggest
 *
 * The reply never says whether an email belongs to a buyer, so nobody can use the form to find
 * out who has ordered. Greg sees that in the Sheet's "Verified buyer" column.
 *
 * Run setup() once after pasting this in. See SETUP-GUIDE.md.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REVIEWS_TAB = 'Reviews';
const SUGGESTIONS_TAB = 'Suggestions';

const REVIEW_HEADERS = ['Received', 'Stars', 'Flavour', 'Used for', 'Review', 'Name', 'Email', 'May post', 'Verified buyer', 'Invoice', 'Show on site'];
const REVIEW_WIDTHS = [130, 60, 90, 160, 360, 120, 200, 80, 110, 90, 100];
const SUGGESTION_HEADERS = ['Received', 'Topic', 'Idea', 'Name', 'Email'];
const SUGGESTION_WIDTHS = [130, 170, 420, 120, 200];

const FLAVOURS = ['Orange', 'Cranberry', 'Both'];
const USES = ['Running', 'Riding', 'Hiking', 'Gym', 'Something else'];
const TOPICS = ['A new flavour', 'The pouch', 'Delivery or collection', 'The website', 'Something else'];

const MAX_TEXT = 600;
const MIN_IDEA = 10;
// Reviews and suggestions together, per clock hour, so a bot cannot flood the Sheet.
const MAX_PER_HOUR = 30;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Orders that count as a real purchase.
const BOUGHT = ['Paid', 'Delivered'];

// ---------------------------------------------------------------------------
// Web app entry points
// ---------------------------------------------------------------------------

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e && e.postData && e.postData.contents ? e.postData.contents : '');
  } catch (err) {
    return json_({ ok: false, error: 'bad_request', message: 'Could not read the request.' });
  }
  return json_(handle_(body));
}

// Opening the web app address in a browser shows that it is alive.
function doGet() {
  return json_({ ok: true, service: 'feedback' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(body) {
  try {
    if (!body || typeof body !== 'object') throw fail_('bad_request', 'Could not read the request.');
    // A hidden field real people never fill in. Bots usually do: they get a thank-you and nothing is saved.
    if (body.website) return { ok: true };
    switch (body.action) {
      case 'review': return withLock_(function () { return saveReview_(body); });
      case 'suggest': return withLock_(function () { return saveSuggestion_(body); });
      default: throw fail_('bad_request', 'Unknown action.');
    }
  } catch (err) {
    if (err && err.code) {
      const out = { ok: false, error: err.code, message: err.publicMessage || '' };
      if (err.field) out.field = err.field;
      return out;
    }
    console.error(err && err.stack ? err.stack : String(err));
    return { ok: false, error: 'server_error', message: 'Something went wrong. Please try again.' };
  }
}

// An error with a code the page understands and a message safe to show.
function fail_(code, message, field) {
  const e = new Error(message || code);
  e.code = code;
  e.publicMessage = message || '';
  if (field) e.field = field;
  return e;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    throw fail_('busy', 'Lots of people are writing in right now. Please try again in a moment.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Reviews and suggestions
// ---------------------------------------------------------------------------

function saveReview_(body) {
  const stars = Number(body.stars);
  if (!(stars >= 1 && stars <= 5 && Math.floor(stars) === stars)) throw fail_('invalid', 'Tap a star to rate them.', 'stars');
  const share = body.share === 'yes' ? 'yes' : body.share === 'no' ? 'no' : '';
  if (!share) throw fail_('invalid', 'Choose yes or no.', 'share');
  const email = checkEmail_(body.email, true);
  const flavour = FLAVOURS.indexOf(body.flavour) !== -1 ? body.flavour : '';
  const used = (Array.isArray(body.used) ? body.used : []).filter(function (u, i, all) {
    return USES.indexOf(u) !== -1 && all.indexOf(u) === i;
  });
  const text = cleanText_(body.text, MAX_TEXT);
  const name = clean_(body.name, 60);

  checkRate_();
  const bought = findPurchase_(email);
  appendRow_(REVIEWS_TAB, [
    nowString_(), stars, flavour, used.join(', '), safe_(text), safe_(name), safe_(email), share,
    bought.checked ? (bought.invoice ? 'yes' : 'no') : 'not checked', bought.invoice, ''
  ]);
  return { ok: true };
}

function saveSuggestion_(body) {
  if (TOPICS.indexOf(body.topic) === -1) throw fail_('invalid', 'Pick what your idea is about.', 'topic');
  const idea = cleanText_(body.text, MAX_TEXT);
  if (idea.length < MIN_IDEA) throw fail_('invalid', 'Tell us a little more: at least ' + MIN_IDEA + ' letters.', 'text');
  const email = checkEmail_(body.email, false);
  const name = clean_(body.name, 60);

  checkRate_();
  appendRow_(SUGGESTIONS_TAB, [nowString_(), body.topic, safe_(idea), safe_(name), safe_(email)]);
  return { ok: true };
}

function checkEmail_(value, required) {
  const email = clean_(value, 120).toLowerCase();
  if (!email) {
    if (required) throw fail_('invalid', 'Enter the email you ordered with, so we can check you bought from us.', 'email');
    return '';
  }
  if (!EMAIL_PATTERN.test(email)) throw fail_('invalid', 'Check the email address.', 'email');
  return email;
}

// Counts this clock hour's rows in both tabs.
function checkRate_() {
  const hour = nowString_().slice(0, 13);
  let count = 0;
  [REVIEWS_TAB, SUGGESTIONS_TAB].forEach(function (tab) {
    const sheet = tabSheet_(tab);
    const last = sheet.getLastRow();
    if (last < 2) return;
    const from = Math.max(2, last - MAX_PER_HOUR);
    sheet.getRange(from, 1, last - from + 1, 1).getValues().forEach(function (r) {
      if (str_(r[0]).slice(0, 13) === hour) count++;
    });
  });
  if (count >= MAX_PER_HOUR) throw fail_('busy', 'Lots of people are writing in right now. Please try again a bit later.');
}

function appendRow_(tab, values) {
  const sheet = tabSheet_(tab);
  const row = Math.max(sheet.getLastRow(), 1) + 1;
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 500);
  sheet.getRange(row, 1, 1, values.length).setValues([values]);
}

function tabSheet_(tab) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tab);
  if (!sheet) throw fail_('not_ready', 'Reviews are not set up yet. Please try again later.');
  return sheet;
}

// ---------------------------------------------------------------------------
// Is this a real buyer? (reads the order Sheet, never writes to it)
// ---------------------------------------------------------------------------

// ORDER_SHEET_ID can be the Sheet's ID, or simply its whole address copied from the browser.
function orderSheetId_() {
  const raw = str_(PropertiesService.getScriptProperties().getProperty('ORDER_SHEET_ID'));
  const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(raw);
  return m ? m[1] : raw;
}

// { checked: true, invoice: 'SJ-0012' } for the newest paid or delivered order with this email,
// { checked: true, invoice: '' } when there is none, { checked: false } when the order Sheet
// cannot be read (the review is still saved).
function findPurchase_(email) {
  const id = orderSheetId_();
  if (!id) return { checked: false, invoice: '' };
  let sheet;
  try {
    sheet = SpreadsheetApp.openById(id).getSheetByName('Orders');
  } catch (err) {
    return { checked: false, invoice: '' };
  }
  if (!sheet) return { checked: false, invoice: '' };
  const last = sheet.getLastRow();
  const width = sheet.getLastColumn();
  if (last < 2 || width < 1) return { checked: true, invoice: '' };
  const head = sheet.getRange(1, 1, 1, width).getValues()[0].map(str_);
  const c = { invoice: head.indexOf('Invoice'), email: head.indexOf('Email'), status: head.indexOf('Status') };
  if (c.invoice < 0 || c.email < 0 || c.status < 0) return { checked: false, invoice: '' };
  const rows = sheet.getRange(2, 1, last - 1, width).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (str_(r[c.email]).toLowerCase() === email && BOUGHT.indexOf(str_(r[c.status])) !== -1) {
      return { checked: true, invoice: str_(r[c.invoice]) };
    }
  }
  return { checked: true, invoice: '' };
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function str_(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

// One line of plain text: no line breaks or control characters, limited length.
function clean_(v, max) {
  let s = v === null || v === undefined ? '' : String(v);
  s = s.replace(/\s*[\r\n]+\s*/g, ', ');
  s = s.replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.slice(0, max);
}

// Longer text that keeps its line breaks.
function cleanText_(v, max) {
  let s = v === null || v === undefined ? '' : String(v);
  s = s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F\u2028\u2029]+/g, ' ');
  s = s.split('\n').map(function (line) { return line.replace(/\s+/g, ' ').trim(); }).join('\n');
  return s.replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

// Text that starts with = + - or @ could be read as a formula. A leading space prevents that.
function safe_(s) {
  return /^[=+\-@]/.test(s) ? ' ' + s : s;
}

function nowString_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}

// ---------------------------------------------------------------------------
// One-off functions, run from the Apps Script editor
// ---------------------------------------------------------------------------

/** Run once. Creates the Reviews and Suggestions tabs. Safe to run again: nothing is overwritten. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open this script from a Google Sheet (Extensions > Apps Script), then run setup again.');
  [[REVIEWS_TAB, REVIEW_HEADERS, REVIEW_WIDTHS], [SUGGESTIONS_TAB, SUGGESTION_HEADERS, SUGGESTION_WIDTHS]].forEach(function (t) {
    const sheet = ss.getSheetByName(t[0]) || ss.insertSheet(t[0]);
    sheet.getRange(1, 1, 1, t[1].length).setValues([t[1]]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    if (sheet.getMaxRows() < 2) sheet.insertRowsAfter(1, 998);
    // Plain text everywhere except the stars, so Sheets never turns words into dates or formulas.
    t[1].forEach(function (h, i) {
      sheet.getRange(2, i + 1, sheet.getMaxRows() - 1, 1).setNumberFormat(h === 'Stars' ? '0' : '@');
    });
    t[2].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  });
  const spare = ss.getSheetByName('Sheet1');
  if (spare && spare.getLastRow() === 0 && spare.getLastColumn() === 0 && ss.getSheets().length > 2) ss.deleteSheet(spare);
  Logger.log('Setup done. Reviews and Suggestions tabs are ready.');
  Logger.log(orderSheetId_() ? 'Buyer check: connected to the order Sheet.' : 'Buyer check: add ORDER_SHEET_ID in Script properties (see SETUP-GUIDE.md).');
}

/** Checks that the order Sheet can be read. */
function checkOrders() {
  const id = orderSheetId_();
  if (!id) {
    Logger.log('No ORDER_SHEET_ID yet. See SETUP-GUIDE.md.');
    return;
  }
  try {
    const sheet = SpreadsheetApp.openById(id).getSheetByName('Orders');
    Logger.log(sheet ? 'Connected. The Orders tab has ' + Math.max(0, sheet.getLastRow() - 1) + ' rows.' : 'The order Sheet has no Orders tab.');
  } catch (err) {
    Logger.log('Could not open the order Sheet. Check ORDER_SHEET_ID.');
  }
}
