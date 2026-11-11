'use strict';
/* Card Duel server: zero dependencies (Node 18+).
   The SERVER owns every rule: free games, ad cooldown, card draws and points.
   The browser only displays what the server says. */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const DEV = process.env.DEV === '1';                       // local testing only, NEVER in production
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const RULES = {
  FREE_GAMES: 3,
  AD_COOLDOWN_MS: 60 * 60 * 1000,   // 1 ad per hour
  MIN_AD_MS: 2000,                  // an ad cannot be "completed" faster than this
  AD_TOKEN_TTL_MS: 10 * 60 * 1000,
  ROUNDS: 5, WIN_NEEDED: 3,
  PTS_ROUND_WIN: 20, PTS_ROUND_LOSS: 5, PTS_MATCH_BONUS: 50,
  INIT_DATA_MAX_AGE_S: 24 * 60 * 60,
  MAX_REQ_PER_MIN: 90
};

/* ---------- storage (JSON file, atomic writes) ---------- */
let db = { users: {} };
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); if (!db.users) db.users = {}; } catch (e) {}
let timer = null;
function persist() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const tmp = DATA_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(db), err => { if (!err) fs.rename(tmp, DATA_FILE, () => {}); });
  }, 300);
}
function flushSync() { try { fs.writeFileSync(DATA_FILE, JSON.stringify(db)); } catch (e) {} }
process.on('SIGTERM', () => { flushSync(); process.exit(0); });
process.on('SIGINT', () => { flushSync(); process.exit(0); });

function getUser(id, name) {
  let u = db.users[id];
  if (!u) u = db.users[id] = { points: 0, freeLeft: RULES.FREE_GAMES, credits: 0, lastAdAt: 0, pendingAd: null, game: null, created: Date.now() };
  if (name) u.name = name;
  return u;
}
function publicState(u) {
  const wait = Math.max(0, u.lastAdAt + RULES.AD_COOLDOWN_MS - Date.now());
  return {
    points: u.points, freeLeft: u.freeLeft, credits: u.credits, adWaitMs: wait, rounds: RULES.ROUNDS,
    game: u.game ? { round: u.game.round, wins: u.game.wins, results: u.game.results } : null
  };
}
const hasGames = u => u.freeLeft > 0 || u.credits > 0;

/* ---------- Telegram initData verification ---------- */
function verifyInitData(initData) {
  if (DEV && typeof initData === 'string' && initData.startsWith('dev:')) {
    const id = initData.slice(4).replace(/[^\w-]/g, '').slice(0, 40);
    return id ? { id: 'dev_' + id, name: 'Dev' } : null;
  }
  if (!BOT_TOKEN || typeof initData !== 'string' || initData.length > 4096) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete('hash');
  const check = [...params.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => k + '=' + v).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calc = crypto.createHmac('sha256', secret).update(check).digest();
  if (!crypto.timingSafeEqual(calc, Buffer.from(hash, 'hex'))) return null;
  const age = Date.now() / 1000 - Number(params.get('auth_date') || 0);
  if (!(age >= 0 && age <= RULES.INIT_DATA_MAX_AGE_S) && !(age < 0 && age > -60)) return null;
  try { const u = JSON.parse(params.get('user')); return u && u.id ? { id: String(u.id), name: u.first_name || '' } : null; }
  catch (e) { return null; }
}

/* ---------- tiny rate limiter ---------- */
const hits = new Map();
setInterval(() => hits.clear(), 60 * 1000).unref();
function limited(key) { const n = (hits.get(key) || 0) + 1; hits.set(key, n); return n > RULES.MAX_REQ_PER_MIN; }

/* ---------- game actions (all synchronous, so no race conditions) ---------- */
const A = {};
A.state = u => ({ ok: true, state: publicState(u) });

A.start = u => {
  if (!u.game) {
    if (u.freeLeft > 0) u.freeLeft--;
    else if (u.credits > 0) u.credits--;
    else return { ok: false, error: 'no_games', state: publicState(u) };
    u.game = { round: 0, wins: 0, results: [] };
    persist();
  }                                       // an unfinished game is resumed, never charged twice
  return { ok: true, state: publicState(u) };
};

A.round = u => {
  const g = u.game;
  if (!g) return { ok: false, error: 'no_game', state: publicState(u) };
  const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = pool.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const mine = pool.slice(0, 3);
  const cpu = crypto.randomInt(10);
  const hit = mine.indexOf(cpu);
  const roundWon = hit > -1;
  g.results.push(roundWon);
  if (roundWon) { g.wins++; u.points += RULES.PTS_ROUND_WIN; } else u.points += RULES.PTS_ROUND_LOSS;
  g.round++;
  const out = { ok: true, mine, cpu, hit, roundWon, round: g.round, wins: g.wins, results: g.results.slice(), finished: false, won: false };
  if (g.round >= RULES.ROUNDS) {
    out.finished = true;
    out.won = g.wins >= RULES.WIN_NEEDED;
    if (out.won) { u.points += RULES.PTS_MATCH_BONUS; out.bonus = RULES.PTS_MATCH_BONUS; }
    u.game = null;
  }
  out.state = publicState(u);
  persist();
  return out;
};

A['ad/begin'] = u => {
  if (hasGames(u) || u.game) return { ok: false, error: 'have_games', state: publicState(u) };
  const wait = u.lastAdAt + RULES.AD_COOLDOWN_MS - Date.now();
  if (wait > 0) return { ok: false, error: 'cooldown', state: publicState(u) };
  u.pendingAd = { token: crypto.randomBytes(16).toString('hex'), startedAt: Date.now() };
  persist();
  return { ok: true, token: u.pendingAd.token, state: publicState(u) };
};

A['ad/complete'] = (u, body) => {
  const p = u.pendingAd, now = Date.now();
  if (!p || typeof body.token !== 'string' || body.token.length !== 32 ||
      !crypto.timingSafeEqual(Buffer.from(body.token), Buffer.from(p.token)))
    return { ok: false, error: 'bad_token', state: publicState(u) };
  u.pendingAd = null;                                   // a token works once
  if (now - p.startedAt < RULES.MIN_AD_MS || now - p.startedAt > RULES.AD_TOKEN_TTL_MS)
    return { ok: false, error: 'bad_timing', state: publicState(u) };
  if (hasGames(u) || u.game || now < u.lastAdAt + RULES.AD_COOLDOWN_MS)
    return { ok: false, error: 'cooldown', state: publicState(u) };
  u.credits++; u.lastAdAt = now;
  persist();
  return { ok: true, state: publicState(u) };
};

/* ---------- HTTP ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.webp': 'image/webp',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.css': 'text/css', '.js': 'text/javascript' };

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(obj));
}

function serveStatic(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  });
}

http.createServer((req, res) => {
  if (!req.url.startsWith('/api/')) return serveStatic(req, res);
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method' });
  // Behind Railway's proxy every request shares the proxy address, so read the real client IP from X-Forwarded-For
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean);
  const ip = xff.length ? xff[xff.length - 1] : (req.socket.remoteAddress || '');
  if (limited('ip:' + ip)) return send(res, 429, { ok: false, error: 'rate_limit' });

  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 8192) req.destroy(); });
  req.on('end', () => {
    let body; try { body = JSON.parse(raw || '{}'); } catch (e) { return send(res, 400, { ok: false, error: 'bad_json' }); }
    const action = req.url.slice(5).split('?')[0];
    const fn = Object.prototype.hasOwnProperty.call(A, action) ? A[action] : null;
    if (!fn) return send(res, 404, { ok: false, error: 'unknown' });
    const tg = verifyInitData(body.initData);
    if (!tg) return send(res, 401, { ok: false, error: 'auth' });
    if (limited('u:' + tg.id)) return send(res, 429, { ok: false, error: 'rate_limit' });
    send(res, 200, fn(getUser(tg.id, tg.name), body));
  });
}).listen(PORT, () => console.log('Card Duel on :' + PORT + (DEV ? '  [DEV MODE]' : '')));
