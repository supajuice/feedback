'use strict';
/*
  A local stand-in for the real setup, for trying the reviews page in a browser.

    node tests/dev-server.js [--mode=seeded|unconnected] [--latency=300] [--site-port=5193] [--api-port=5194]

  docs/ is served on one port, with config.js pointing at a fake feedback service on another
  port. The fake service runs the real apps-script/Code.gs against in-memory copies of Google's
  services, next to a pretend order Sheet with a few orders, and answers the way Apps Script does:
    - a POST to /exec is answered with a 302 to an "echo" address that returns the JSON,
    - a preflight (OPTIONS) request is refused, because Apps Script cannot answer one.
  /sheet on the site shows the pretend Feedback Sheet, so you can see what a review saved.
  Nothing is saved: stop the server and the data is gone.
*/
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createGas, MockSpreadsheet } = require('./gas-mock');

const DOCS = path.join(__dirname, '..', 'docs');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8'
};

// The order Sheet's columns, as the order site's Code.gs makes them.
const ORDER_HEADERS = ['Invoice', 'Created', 'Source', 'Name', 'Contact', 'Address', 'Notes', 'Qty', 'Unit price',
  'Delivery fee', 'Total', 'Status', 'Paid on', 'Delivered on', 'Request ID', 'Email'];

// A pretend order Sheet: Thandi's order was delivered and Liam's is paid, so both count as buyers.
// Naledi cancelled and Pieter hasn't paid, so they don't.
function orderSheet() {
  const ss = new MockSpreadsheet();
  const rows = [ORDER_HEADERS].concat([
    ['SJ-0001', '2026-10-01 09:00', 'kiosk', 'Thandi', '', '', '', 6, 40, 69, 309, 'Delivered', '2026-10-01 10:00', '2026-10-03 12:00', 'a', 'thandi@example.com'],
    ['SJ-0002', '2026-10-05 09:00', 'kiosk', 'Naledi', '', '', '', 5, 40, 0, 200, 'Cancelled', '', '', 'b', 'naledi@example.com'],
    ['SJ-0003', '2026-10-12 09:00', 'kiosk', 'Liam', '', '', '', 10, 40, 0, 400, 'Paid', '2026-10-12 11:00', '', 'c', 'liam@example.com'],
    ['SJ-0004', '2026-10-20 09:00', 'kiosk', 'Pieter', '', '', '', 5, 40, 99, 299, 'Awaiting payment', '', '', 'd', 'pieter@example.com']
  ]);
  ss.insertSheet('Orders').getRange(1, 1, rows.length, ORDER_HEADERS.length).setValues(rows);
  return ss;
}

// 'seeded': connected to the pretend order Sheet. 'unconnected': no ORDER_SHEET_ID yet.
function build(mode) {
  const orders = orderSheet();
  const gas = createGas({ sheets: { 'order-sheet-id': orders } });
  gas.run('setup()');
  if (mode !== 'unconnected') gas.store.set('ORDER_SHEET_ID', 'order-sheet-id');
  return { gas, orders };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The pretend Feedback Sheet's tabs as a plain page.
function sheetPage(gas) {
  const table = (tab) => {
    const sheet = gas.sheet(tab);
    const all = sheet.getLastRow() ? sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues() : [];
    const head = all[0] || [];
    const body = all.slice(1);
    return '<h2>' + esc(tab) + ' (' + body.length + ')</h2><table><tr>' + head.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr>' +
      (body.length ? body.map((r) => '<tr>' + r.map((v) => '<td>' + esc(v) + '</td>').join('') + '</tr>').join('')
        : '<tr><td colspan="' + head.length + '">Nothing yet</td></tr>') + '</table>';
  };
  return '<!doctype html><meta charset="utf-8"><title>Feedback Sheet (local)</title>' +
    '<style>body{font:14px system-ui,sans-serif;margin:16px;background:#fff;color:#111}table{border-collapse:collapse;margin-bottom:24px}' +
    'th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top;max-width:320px}th{background:#f2f2f2}</style>' +
    '<p>The pretend Feedback Sheet on this laptop. Reload to see new rows. It is wiped when the local server stops.</p>' +
    table('Reviews') + table('Suggestions');
}

async function startDevServer(opts) {
  opts = opts || {};
  let current = build(opts.mode || 'seeded');
  const settings = { latency: opts.latency || 0, endpoint: null };
  const calls = []; // what the page sent: { method, action, contentType }
  const echo = new Map();
  let apiPort = 0;

  const api = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const cors = { 'Access-Control-Allow-Origin': '*' };

    // Apps Script cannot answer a preflight. A page that triggers one would fail for real.
    if (req.method === 'OPTIONS') {
      res.writeHead(405);
      res.end();
      return;
    }

    if (url.pathname === '/exec') {
      const body = req.method === 'POST' ? await readBody(req) : '';
      await new Promise((r) => setTimeout(r, settings.latency));
      let content;
      if (req.method === 'POST') {
        let action = null;
        try { action = JSON.parse(body).action; } catch (err) { /* not JSON */ }
        calls.push({ method: 'POST', action, contentType: String(req.headers['content-type'] || '') });
        content = current.gas.ctx.doPost({ postData: { contents: body, type: req.headers['content-type'] || '' } }).getContent();
      } else {
        calls.push({ method: 'GET', action: null, contentType: '' });
        content = current.gas.ctx.doGet({ parameter: Object.fromEntries(url.searchParams) }).getContent();
      }
      const id = crypto.randomUUID();
      echo.set(id, content);
      res.writeHead(302, Object.assign({ Location: 'http://127.0.0.1:' + apiPort + '/echo/' + id }, cors));
      res.end();
      return;
    }

    if (url.pathname.indexOf('/echo/') === 0) {
      const id = url.pathname.slice('/echo/'.length);
      const content = echo.get(id);
      echo.delete(id);
      if (content === undefined) {
        res.writeHead(404, cors);
        res.end();
        return;
      }
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors));
      res.end(content);
      return;
    }

    res.writeHead(404, cors);
    res.end();
  });
  apiPort = await listen(api, opts.apiPort || 0);

  const site = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let p;
    try { p = decodeURIComponent(url.pathname); } catch (err) { p = '/'; }
    const headers = { 'Cache-Control': 'no-store' };

    // config.js points at the fake feedback service ('' is demo mode).
    if (p === '/config.js') {
      const endpoint = settings.endpoint === null ? 'http://127.0.0.1:' + apiPort + '/exec' : settings.endpoint;
      res.writeHead(200, Object.assign({ 'Content-Type': TYPES['.js'] }, headers));
      res.end('window.SJ_FEEDBACK = ' + JSON.stringify({ endpoint: endpoint }) + ';\n');
      return;
    }

    if (p === '/sheet') {
      res.writeHead(200, Object.assign({ 'Content-Type': TYPES['.html'] }, headers));
      res.end(sheetPage(current.gas));
      return;
    }

    if (p.slice(-1) === '/') p += 'index.html';
    const file = path.normalize(path.join(DOCS, p));
    if (file.indexOf(DOCS + path.sep) !== 0) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain' }, headers));
        res.end('Not found');
        return;
      }
      res.writeHead(200, Object.assign({ 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }, headers));
      res.end(data);
    });
  });
  const sitePort = await listen(site, opts.sitePort || 0);

  const siteUrl = 'http://127.0.0.1:' + sitePort;
  return {
    siteUrl: siteUrl,
    apiUrl: 'http://127.0.0.1:' + apiPort + '/exec',
    calls: calls,
    get gas() { return current.gas; }, // the fake feedback service and its Sheet
    get orders() { return current.orders; }, // the pretend order Sheet
    // Start again: 'seeded' (connected to the pretend order Sheet) or 'unconnected'.
    reset: function (mode) {
      current = build(mode || 'seeded');
      calls.length = 0;
    },
    setLatency: function (ms) { settings.latency = ms; },
    setEndpoint: function (url) { settings.endpoint = url; }, // '' is demo mode, null the fake service
    close: function () {
      return Promise.all([
        new Promise((r) => { api.close(r); api.closeAllConnections && api.closeAllConnections(); }),
        new Promise((r) => { site.close(r); site.closeAllConnections && site.closeAllConnections(); })
      ]);
    }
  };
}

module.exports = { startDevServer };

if (require.main === module) {
  const args = {};
  process.argv.slice(2).forEach((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) args[m[1]] = m[2] === undefined ? true : m[2];
  });
  startDevServer({
    mode: args.mode || 'seeded',
    latency: Number(args.latency || 0),
    sitePort: Number(args['site-port'] || 5193),
    apiPort: Number(args['api-port'] || 5194)
  }).then((dev) => {
    console.log('Reviews         ' + dev.siteUrl + '/');
    console.log('Feedback Sheet  ' + dev.siteUrl + '/sheet');
    console.log('Fake feedback service on ' + dev.apiUrl + ' (data lives in memory and is gone when this stops)');
    console.log('Buyers in the pretend order Sheet: thandi@example.com (SJ-0001), liam@example.com (SJ-0003)');
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
