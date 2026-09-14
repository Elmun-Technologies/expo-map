#!/usr/bin/env node
/**
 * Ekspo xarita serveri — bog'liqliksiz (faqat Node standart kutubxonasi).
 *
 * Vazifasi:
 *   - layout'ni yuklaydi va VALIDATSIYADAN o'tkazadi (o'tmasa server ko'tarilmaydi);
 *   - barcha sotuvchilar uchun YAGONA holatni (state) saqlaydi;
 *   - bron / sotuv / bo'shatish amallarini atomik bajaradi va jurnalga yozadi.
 *
 * Ishga tushirish:  node server.mjs        (PORT=4173, LAYOUT=layout/hall-A.json)
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expandLayout, validateLayout } from './lib/layout.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const LAYOUT_PATH = path.resolve(ROOT, process.env.LAYOUT || 'layout/foodera-2026.json');
const DATA_DIR = path.join(ROOT, 'data');
// test/sinov uchun alohida holat fayli: STATE=data/state-test.json
const STATE_FILE = process.env.STATE ? path.resolve(ROOT, process.env.STATE) : path.join(DATA_DIR, 'state.json');
const AUDIT_FILE = process.env.STATE ? STATE_FILE + '.audit.log' : path.join(DATA_DIR, 'audit.log');
const SELLERS_FILE = path.join(DATA_DIR, 'sellers.json');
const SELLERS_EXAMPLE = path.join(DATA_DIR, 'sellers.example.json');
const APP_DIR = path.join(ROOT, 'app');

// ---------------------------------------------------------------- layout
const rawLayout = JSON.parse(fs.readFileSync(LAYOUT_PATH, 'utf8'));
const check = validateLayout(rawLayout);
if (!check.ok) {
  console.error(`\n✗ LAYOUT XATO (${path.relative(ROOT, LAYOUT_PATH)}) — server ko'tarilmadi:\n`);
  for (const e of check.errors) console.error('   ✗ ' + e);
  console.error('\n  Tuzatib, qaytadan urinib ko\'ring: node tools/validate-layout.mjs ' + path.relative(ROOT, LAYOUT_PATH) + '\n');
  process.exit(1);
}
for (const w of check.warnings) console.warn('   ⚠ ' + w);
const exp = expandLayout(rawLayout);
const standsById = new Map(exp.stands.map((s) => [s.id, s]));
const blocksById = new Map(exp.blocks.map((b) => [b.id, b]));
const totalArea = exp.stands.reduce((a, s) => a + s.areaM2, 0);
console.log(`✓ Layout yuklandi: ${exp.meta.project} · ${exp.meta.hall} · ${exp.gridBlocks.length} blok + ${exp.customStands.length} nostandart stend · ${exp.stands.length} stend (${totalArea.toLocaleString('uz-UZ')} m²)`);
if ((exp.meta.status || 'draft') !== 'approved') {
  console.warn('⚠ DIQQAT: bu layout QORALAMA (meta.status != "approved"). Panelda mijozga havola bloklangan, eksport ham to\'xtatiladi.');
}

// ---------------------------------------------------------------- data
fs.mkdirSync(DATA_DIR, { recursive: true });
let sellers = [];
const sellersSrc = fs.existsSync(SELLERS_FILE) ? SELLERS_FILE : SELLERS_EXAMPLE;
sellers = JSON.parse(fs.readFileSync(sellersSrc, 'utf8')).sellers || [];
if (sellersSrc === SELLERS_EXAMPLE) {
  console.warn('⚠ data/sellers.json topilmadi — demo loginlar ishlatilyapti (data/sellers.example.json). Ishga tushishdan oldin PIN\'larni almashtiring.');
} else {
  console.log('✓ Sotuvchilar ro\'yxati: data/sellers.json');
}

let state = { revision: 0, updatedAt: new Date().toISOString(), items: {} };
if (fs.existsSync(STATE_FILE)) {
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    console.log(`✓ Holat yuklandi: revision ${state.revision}, ${Object.keys(state.items || {}).length} yozuv`);
  } catch (e) {
    console.error('✗ data/state.json buzuq:', e.message);
    process.exit(1);
  }
}

// Boshqa layout'dan qolgan yozuvlar (masalan zal almashganda) hisobga olinmaydi
{
  const stale = Object.keys(state.items || {}).filter((id) => !standsById.has(id));
  if (stale.length) {
    for (const id of stale) delete state.items[id];
    state.revision++;
    state.updatedAt = new Date().toISOString();
    persist();
    console.log(`⚠ ${stale.length} ta eski yozuv (bu layout'da yo'q stendlar) holatdan olib tashlandi`);
  }
}

const sessions = new Map(); // token -> {id, name, role, at}
const pricePerM2 = Number(exp.meta.pricePerM2 || 0);
const ttlDefault = Number(exp.meta.reserveTtlHours || 72);

function persist() {
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}
function audit(entry) {
  fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n');
}

/** Muddati o'tgan bronlarni bo'shatish. */
function expire() {
  const now = Date.now();
  let changed = 0;
  for (const [id, it] of Object.entries(state.items)) {
    if (it.status === 'reserved' && it.reservedUntil && Date.parse(it.reservedUntil) < now) {
      delete state.items[id];
      changed++;
      audit({ ts: new Date().toISOString(), action: 'expire', standIds: [id], sellerId: 'system', sellerName: 'tizim', reason: 'bron muddati tugadi' });
    }
  }
  if (changed) {
    state.revision++;
    state.updatedAt = new Date().toISOString();
    persist();
    console.log(`⏰ ${changed} ta bron muddati tugadi, bo'shatildi`);
  }
  return changed;
}
expire();
setInterval(expire, 60_000).unref?.();

// ---------------------------------------------------------------- http helpers
function send(res, code, body, type = 'application/json; charset=utf-8') {
  const payload = type.startsWith('application/json') ? JSON.stringify(body) : body;
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) reject(new Error('so\'rov juda katta'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('JSON buzuq'));
      }
    });
    req.on('error', reject);
  });
}
function auth(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  return sessions.get(token) || null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const file = path.join(APP_DIR, rel);
  if (!file.startsWith(APP_DIR)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'not found', path: urlPath });
    send(res, 200, buf, MIME[path.extname(file)] || 'application/octet-stream');
  });
}

// ---------------------------------------------------------------- actions
function applyAction(sess, body) {
  const action = String(body.action || '');
  const ids = [...new Set((body.standIds || []).map(String))];
  if (!ids.length) return { code: 400, body: { error: 'standIds bo\'sh' } };
  for (const id of ids) if (!standsById.has(id)) return { code: 400, body: { error: 'unknown_stand', standId: id } };

  if (body.expectedRevision != null && Number(body.expectedRevision) !== state.revision) {
    return { code: 409, body: { error: 'revision_mismatch', message: 'Xarita boshqa sotuvchi tomonidan yangilandi. Sahifani yangilab, qaytadan urinib ko\'ring.', revision: state.revision } };
  }

  const now = new Date().toISOString();
  const buyer = (body.buyer || '').toString().trim();
  const phone = (body.phone || '').toString().trim();
  const company = (body.company || '').toString().trim();

  if (action === 'reserve' || action === 'sell') {
    if (!buyer) return { code: 400, body: { error: 'buyer_required', message: 'Mijoz ismi kiritilishi shart' } };
    const conflicts = ids
      .filter((id) => state.items[id])
      .map((id) => ({ standId: id, status: state.items[id].status, buyer: state.items[id].buyer || null, sellerName: state.items[id].sellerName || null }));
    if (conflicts.length) return { code: 409, body: { error: 'conflict', message: 'Tanlangan joylardan ba\'zilari allaqachon band.', conflicts, revision: state.revision } };
  }

  if (action === 'release' || action === 'block') {
    const locked = ids.filter((id) => {
      const it = state.items[id];
      if (!it) return false;
      if (sess.role === 'admin') return false;
      if (action === 'block') return true;
      return it.status === 'sold' || it.sellerId !== sess.id;
    });
    if (locked.length) {
      return { code: 403, body: { error: 'not_allowed', message: 'Sotilgan joyni yoki boshqa sotuvchining bronini faqat menejer o\'zgartira oladi.', standIds: locked } };
    }
  }

  const ttlHours = Number(body.ttlHours || ttlDefault);
  // Bitta kompaniya nechta joy olsa — bitta guruh (xaritada ham, boshqaruvda ham bitta quti).
  // Yonma-yon tushgan joylar avtomatik shu guruhga qo'shiladi.
  const buyerKey = (company || buyer).trim().toLowerCase();
  const adj = (a, b) => {
    const vx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const hy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return (Math.abs(a.x + a.w - b.x) < 0.02 || Math.abs(b.x + b.w - a.x) < 0.02) ? vx > 0.02
      : (Math.abs(a.y + a.h - b.y) < 0.02 || Math.abs(b.y + b.h - a.y) < 0.02) ? hy > 0.02 : false;
  };
  let groupId = null;
  if (action === 'sell' || action === 'reserve') {
    const mine = ids.map((id) => standsById.get(id));
    for (const [sid, it] of Object.entries(state.items)) {
      if (!it.groupId) continue;
      if (String(it.company || it.buyer || '').trim().toLowerCase() !== buyerKey) continue;
      if (it.status !== (action === 'sell' ? 'sold' : 'reserved')) continue;
      const other = standsById.get(sid);
      if (other && mine.some((m) => adj(m, other))) { groupId = it.groupId; break; }
    }
    if (!groupId) groupId = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }
  const result = {};
  for (const id of ids) {
    const stand = standsById.get(id);
    if (action === 'release') {
      delete state.items[id];
      result[id] = { status: 'free' };
      continue;
    }
    const prev = state.items[id] || {};
    const item = {
      standId: id,
      blockId: stand.blockId,
      areaM2: stand.areaM2,
      status: action === 'sell' ? 'sold' : action === 'block' ? 'blocked' : 'reserved',
      buyer: action === 'block' ? prev.buyer || null : buyer,
      phone: action === 'block' ? prev.phone || null : phone,
      company: action === 'block' ? prev.company || null : company,
      pricePerM2,
      amount: Number(body.amount && ids.length === 1 ? body.amount : pricePerM2 * stand.areaM2),
      sellerId: sess.id,
      sellerName: sess.name,
      updatedAt: now,
      reservedUntil: action === 'reserve' ? new Date(Date.now() + ttlHours * 3600_000).toISOString() : null,
      note: (body.note || '').toString().trim() || null,
      groupId: action === 'block' ? prev.groupId || null : groupId,
    };
    state.items[id] = item;
    result[id] = item;
  }

  state.revision++;
  state.updatedAt = now;
  persist();
  audit({ ts: now, action, standIds: ids, buyer: buyer || null, phone: phone || null, company: company || null, groupId: action === 'release' ? null : groupId, sellerId: sess.id, sellerName: sess.name, revision: state.revision, ttlHours: action === 'reserve' ? ttlHours : null });
  console.log(`→ ${sess.name}: ${action} ${ids.join(', ')}${buyer ? ' · ' + buyer : ''}`);
  return { code: 200, body: { ok: true, revision: state.revision, items: result } };
}

// ---------------------------------------------------------------- router
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  try {
    if (p === '/api/healthz') return send(res, 200, { ok: true, revision: state.revision });

    if (p === '/api/login' && req.method === 'POST') {
      const b = await readBody(req);
      const key = String(b.name || b.id || '').trim().toLowerCase();
      const s = sellers.find((x) => x.id.toLowerCase() === key || x.name.toLowerCase() === key);
      if (!s) return send(res, 401, { error: 'not_found', message: 'Bunday sotuvchi topilmadi' });
      if (String(b.pin) !== String(s.pin)) return send(res, 401, { error: 'bad_pin', message: 'PIN kod xato' });
      const token = crypto.randomBytes(24).toString('hex');
      const sess = { id: s.id, name: s.name, role: s.role || 'seller', at: new Date().toISOString() };
      sessions.set(token, sess);
      audit({ ts: sess.at, action: 'login', sellerId: s.id, sellerName: s.name });
      return send(res, 200, { token, seller: sess });
    }

    if (p === '/api/logout' && req.method === 'POST') {
      const h = req.headers.authorization || '';
      if (h.startsWith('Bearer ')) sessions.delete(h.slice(7));
      return send(res, 200, { ok: true });
    }

    if (p === '/api/layout' && req.method === 'GET') {
      return send(res, 200, {
        meta: exp.meta,
        hall: exp.hall,
        zones: exp.zones,
        sections: exp.sections,
        features: exp.features,
        blocks: exp.blocks,
        customStands: exp.customStands,
        stands: exp.stands,
        layoutVersion: rawLayout.meta?.version || null,
      });
    }

    if (p === '/api/state' && req.method === 'GET') {
      expire();
      return send(res, 200, { revision: state.revision, updatedAt: state.updatedAt, serverTime: new Date().toISOString(), items: state.items });
    }

    if (p === '/api/action' && req.method === 'POST') {
      const sess = auth(req);
      if (!sess) return send(res, 401, { error: 'unauthorized', message: 'Avval tizimga kiring' });
      const b = await readBody(req);
      const r = applyAction(sess, b);
      return send(res, r.code, r.body);
    }

    if (p === '/api/audit' && req.method === 'GET') {
      const sess = auth(req);
      if (!sess) return send(res, 401, { error: 'unauthorized' });
      if (sess.role !== 'admin') return send(res, 403, { error: 'forbidden', message: 'Jurnal faqat menejerga ko\'rinadi' });
      const limit = Math.min(Number(url.searchParams.get('limit') || 100), 1000);
      if (!fs.existsSync(AUDIT_FILE)) return send(res, 200, { entries: [] });
      const lines = fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n').slice(-limit).reverse();
      return send(res, 200, { entries: lines.map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } }) });
    }

    if (p === '/api/export.csv' && req.method === 'GET') {
      const sess = auth(req);
      if (!sess) return send(res, 401, { error: 'unauthorized' });
      const rows = [['blok', 'stend', 'holat', 'm2', 'narx', 'mijoz', 'telefon', 'kompaniya', 'sotuvchi', 'yangilangan']];
      for (const s of exp.stands) {
        const it = state.items[s.id];
        rows.push([s.blockId, s.id, it ? it.status : 'free', String(s.areaM2), it ? String(it.amount) : String(pricePerM2 * s.areaM2), it?.buyer || '', it?.phone || '', it?.company || '', it?.sellerName || '', it?.updatedAt || '']);
      }
      const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
      return send(res, 200, '\uFEFF' + csv, 'text/csv; charset=utf-8');
    }

    if (p.startsWith('/api/')) return send(res, 404, { error: 'not_found', path: p });
    return serveStatic(res, p);
  } catch (e) {
    console.error('✗', e);
    return send(res, 500, { error: 'internal', message: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n🚀 Sotuv paneli: http://localhost:${PORT}  (0.0.0.0:${PORT})`);
  console.log(`   1 stend = 9 m² · 1 blok = 8 stend = 72 m² · narx ${pricePerM2.toLocaleString('uz-UZ')} so'm/m²\n`);
});
