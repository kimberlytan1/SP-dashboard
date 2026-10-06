// Structured Product Dashboard server (for Railway).
//  - Everyone with access can VIEW the latest published data.
//  - Only someone with ADMIN_PASSWORD can publish a new upload (via /admin).
//
// Environment variables:
//   ADMIN_PASSWORD   (required) password needed to publish an upload
//   VIEWER_PASSWORD  (recommended) if set, every visitor must sign in with it (or the admin password)
//   DATA_DIR         where the latest upload is stored. On Railway, mount a Volume at /data and set DATA_DIR=/data
//   PORT             set automatically by Railway

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'latest.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const VIEWER_PASSWORD = process.env.VIEWER_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD environment variable is required.');
  process.exit(1);
}
if (!VIEWER_PASSWORD) {
  console.warn('WARNING: VIEWER_PASSWORD is not set, so anyone with the link can VIEW the data.');
}
fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.set('trust proxy', 1); // Railway sits behind a proxy
app.disable('x-powered-by');

const sha = v => crypto.createHash('sha256').update(String(v)).digest();
const safeEq = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

// Very small in-memory limiter for wrong passwords: 10 failures / 15 min / IP.
const fails = new Map();
const WINDOW = 15 * 60 * 1000, MAX_FAILS = 10;
function tooManyFails(ip) {
  const now = Date.now();
  const list = (fails.get(ip) || []).filter(t => now - t < WINDOW);
  fails.set(ip, list);
  return list.length >= MAX_FAILS;
}
function recordFail(ip) { (fails.get(ip) || fails.set(ip, []).get(ip)).push(Date.now()); }

function basicPassword(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return null;
  const dec = Buffer.from(h.slice(6), 'base64').toString('utf8');
  const i = dec.indexOf(':');
  return i < 0 ? dec : dec.slice(i + 1);
}

// Everyone must sign in when VIEWER_PASSWORD is set (the admin password also works).
function viewerAuth(req, res, next) {
  if (!VIEWER_PASSWORD) return next();
  if (tooManyFails(req.ip)) return res.status(429).send('Too many attempts. Try again later.');
  const pw = basicPassword(req);
  if (pw !== null && (safeEq(pw, VIEWER_PASSWORD) || safeEq(pw, ADMIN_PASSWORD))) return next();
  if (pw !== null) recordFail(req.ip);
  res.set('WWW-Authenticate', 'Basic realm="Structured Product Dashboard", charset="UTF-8"');
  res.status(401).send('Authentication required');
}

app.use((req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});
app.use(viewerAuth);

// Accepts index.html either in a public/ folder or next to server.js
const pagePath = [path.join(__dirname, 'public', 'index.html'), path.join(__dirname, 'index.html')].find(p => fs.existsSync(p));
if (!pagePath) { console.error('index.html not found (expected public/index.html or ./index.html).'); process.exit(1); }
const pageHtml = fs.readFileSync(pagePath, 'utf8');
const render = admin => pageHtml.replace('<head>', `<head>\n<script>window.__SERVER_MODE=true;window.__IS_ADMIN=${admin};</script>`);

app.get('/', (req, res) => { res.set('Cache-Control', 'no-store'); res.type('html').send(render(false)); });
app.get('/admin', (req, res) => { res.set('Cache-Control', 'no-store'); res.type('html').send(render(true)); });

app.get('/api/data', (req, res) => {
  if (!fs.existsSync(DATA_FILE)) return res.status(404).json({ error: 'No data published yet' });
  res.set('Cache-Control', 'no-store');
  res.type('json');
  fs.createReadStream(DATA_FILE).pipe(res);
});

// Admin check happens BEFORE the (large) body is parsed.
function adminAuth(req, res, next) {
  if (tooManyFails(req.ip)) return res.status(429).json({ error: 'Too many attempts' });
  const pw = req.headers['x-admin-password'];
  if (pw && safeEq(pw, ADMIN_PASSWORD)) return next();
  recordFail(req.ip);
  res.status(401).json({ error: 'Wrong admin password' });
}

app.post('/api/upload', adminAuth, express.json({ limit: '100mb' }), (req, res) => {
  const b = req.body;
  if (!b || !Array.isArray(b.headers) || !Array.isArray(b.dataRows)) {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  const payload = {
    fileName: String(b.fileName || ''),
    sheetName: String(b.sheetName || ''),
    headers: b.headers,
    dataRows: b.dataRows,
    extra: b.extra || {},
    publishedAt: new Date().toISOString()
  };
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, DATA_FILE); // atomic swap: viewers never see a half-written file
  res.json({ ok: true, rows: payload.dataRows.length, publishedAt: payload.publishedAt });
});

app.listen(PORT, () => console.log(`Dashboard running on port ${PORT} (data dir: ${DATA_DIR})`));
