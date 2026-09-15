#!/usr/bin/env node
/**
 * Сервер экспо-карты — без внешних зависимостей (только стандартная библиотека Node).
 *
 * Задачи:
 *   - загружает схему и ПРОВЕРЯЕТ её (без проверки сервер не поднимается);
 *   - хранит ЕДИНОЕ состояние (state) для всех продавцов;
 *   - атомарно выполняет бронь / продажу / освобождение и пишет их в журнал.
 *
 * Запуск:  node server.mjs        (PORT=4173, LAYOUT=layout/foodera-2026.json)
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expandLayout, validateLayout } from './lib/layout.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const LAYOUT_PATH = path.resolve(ROOT, process.env.LAYOUT || 'layout/foodera-2026.json');
const DATA_DIR = path.join(ROOT, 'data');
// отдельный файл состояния для тестов: STATE=data/state-test.json
const STATE_FILE = process.env.STATE ? path.resolve(ROOT, process.env.STATE) : path.join(DATA_DIR, 'state.json');
const AUDIT_FILE = process.env.STATE ? STATE_FILE + '.audit.log' : path.join(DATA_DIR, 'audit.log');
const SELLERS_FILE = path.join(DATA_DIR, 'sellers.json');
const SELLERS_EXAMPLE = path.join(DATA_DIR, 'sellers.example.json');
const APP_DIR = path.join(ROOT, 'app');

/** Есть ли на машине python3 + reportlab/svglib — тогда кнопка «Скачать PDF» работает. */
const PDF_EXPORT = (() => {
  try {
    const r = spawnSync('python3', ['-c', 'import reportlab, svglib'], { stdio: 'ignore', timeout: 8000 });
    return r.status === 0;
  } catch { return false; }
})();

/** Есть ли pypdfium2 + Pillow — тогда PDF можно показать картинкой прямо в панели
    (нужно там, где браузер запрещает встроенный просмотрщик PDF: песочница предпросмотра). */
const PDF_PNG = PDF_EXPORT && (() => {
  try {
    const r = spawnSync('python3', ['-c', 'import pypdfium2, PIL'], { stdio: 'ignore', timeout: 8000 });
    return r.status === 0;
  } catch { return false; }
})();

/** Разметка готового листа A4 landscape (тот же файл, что уходит клиенту) — с коротким кешем. */
let svgCache = { key: '', svg: '' };
async function buildPlanSvg() {
  const key = `${state.revision}|${rawLayout.meta?.version || ''}`;
  if (svgCache.key === key && svgCache.svg) return svgCache.svg;
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'expo-svg-'));
  const svgPath = path.join(tmp, 'plan.svg');
  const run = spawnSync('node', [path.join(ROOT, 'tools/export-svg.mjs'), '--map', '--out', svgPath], { cwd: ROOT, encoding: 'utf8' });
  if (run.status !== 0) throw Object.assign(new Error((run.stderr || '').split('\n')[0] || 'сборка SVG не удалась'), { code: 'svg_failed' });
  const svg = await fsp.readFile(svgPath, 'utf8');
  svgCache = { key, svg };
  return svg;
}

/** Собрать PDF плана (один лист) — общий код для скачивания и для предпросмотра. */
async function buildPlanPdf(page) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'expo-pdf-'));
  const svgPath = path.join(tmp, 'plan.svg');
  const pdfPath = path.join(tmp, 'plan.pdf');
  const svgRun = spawnSync('node', [path.join(ROOT, 'tools/export-svg.mjs'), '--map', '--out', svgPath], { cwd: ROOT, encoding: 'utf8' });
  if (svgRun.status !== 0) throw Object.assign(new Error((svgRun.stderr || '').split('\n')[0] || 'сборка SVG не удалась'), { code: 'svg_failed' });
  const pyRun = spawnSync('python3', [path.join(ROOT, 'tools/export-pdf.py'), svgPath, pdfPath, '--margin', '0', '--page', page], { cwd: ROOT, encoding: 'utf8' });
  if (pyRun.status !== 0) throw Object.assign(new Error((pyRun.stderr || '').split('\n')[0] || 'сборка PDF не удалась'), { code: 'pdf_failed' });
  return { tmp, svgPath, pdfPath };
}

// ---------------------------------------------------------------- layout
const rawLayout = JSON.parse(fs.readFileSync(LAYOUT_PATH, 'utf8'));
const check = validateLayout(rawLayout);
if (!check.ok) {
  console.error(`\n✗ ОШИБКА LAYOUT (${path.relative(ROOT, LAYOUT_PATH)}) — сервер не запущен:\n`);
  for (const e of check.errors) console.error('   ✗ ' + e);
  console.error('\n  Исправьте и проверьте: node tools/validate-layout.mjs ' + path.relative(ROOT, LAYOUT_PATH) + '\n');
  process.exit(1);
}
for (const w of check.warnings) console.warn('   ⚠ ' + w);
const exp = expandLayout(rawLayout);
const standsById = new Map(exp.stands.map((s) => [s.id, s]));
const blocksById = new Map(exp.blocks.map((b) => [b.id, b]));
const totalArea = exp.stands.reduce((a, s) => a + s.areaM2, 0);
console.log(`✓ План загружен: ${exp.meta.project} · ${exp.meta.hall} · ${exp.gridBlocks.length} блоков + ${exp.customStands.length} нестандартных стендов · ${exp.stands.length} стендов (${totalArea.toLocaleString('ru-RU')} м²)`);
if ((exp.meta.status || 'draft') !== 'approved') {
  console.warn('⚠ ВНИМАНИЕ: план в статусе ЧЕРНОВИК (meta.status != "approved"). Ссылка для клиента и экспорт заблокированы.');
}

// ---------------------------------------------------------------- data
fs.mkdirSync(DATA_DIR, { recursive: true });
let sellers = [];
if (process.env.SELLERS_JSON) {
  const parsed = JSON.parse(process.env.SELLERS_JSON);
  sellers = Array.isArray(parsed) ? parsed : (parsed.sellers || []);
  console.log('✓ Список продавцов: SELLERS_JSON');
} else {
  const sellersSrc = fs.existsSync(SELLERS_FILE) ? SELLERS_FILE : SELLERS_EXAMPLE;
  sellers = JSON.parse(fs.readFileSync(sellersSrc, 'utf8')).sellers || [];
  if (sellersSrc === SELLERS_EXAMPLE) {
    console.warn('⚠ data/sellers.json не найден — используются демо-логины (data/sellers.example.json). Перед работой замените PIN-коды.');
  } else {
    console.log('✓ Список продавцов: data/sellers.json');
  }
}

let state = { revision: 0, updatedAt: new Date().toISOString(), items: {} };
if (fs.existsSync(STATE_FILE)) {
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    console.log(`✓ Состояние загружено: revision ${state.revision}, записей ${Object.keys(state.items || {}).length}`);
  } catch (e) {
    console.error('✗ data/state.json повреждён:', e.message);
    process.exit(1);
  }
}

// Записи, оставшиеся от другой схемы (например, при смене зала), не учитываются
{
  const stale = Object.keys(state.items || {}).filter((id) => !standsById.has(id));
  if (stale.length) {
    for (const id of stale) delete state.items[id];
    state.revision++;
    state.updatedAt = new Date().toISOString();
    persist();
    console.log(`⚠ Удалено ${stale.length} старых записей (стендов нет в текущем плане)`);
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

/** Снимает истёкшие брони. */
function expire() {
  const now = Date.now();
  let changed = 0;
  for (const [id, it] of Object.entries(state.items)) {
    if (it.status === 'reserved' && it.reservedUntil && Date.parse(it.reservedUntil) < now) {
      delete state.items[id];
      changed++;
      audit({ ts: new Date().toISOString(), action: 'expire', standIds: [id], sellerId: 'system', sellerName: 'система', reason: 'срок брони истёк' });
    }
  }
  if (changed) {
    state.revision++;
    state.updatedAt = new Date().toISOString();
    persist();
    console.log(`⏰ Снято просроченных броней: ${changed}`);
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
      if (data.length > 1_000_000) reject(new Error('запрос слишком большой'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('некорректный JSON'));
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
  if (!ids.length) return { code: 400, body: { error: 'empty_stand_ids', message: 'Не переданы стенды' } };
  for (const id of ids) if (!standsById.has(id)) return { code: 400, body: { error: 'unknown_stand', standId: id } };

  if (body.expectedRevision != null && Number(body.expectedRevision) !== state.revision) {
    return { code: 409, body: { error: 'revision_mismatch', message: 'План обновлён другим продавцом. Обновите страницу и повторите.', revision: state.revision } };
  }

  const now = new Date().toISOString();
  const buyer = (body.buyer || '').toString().trim();
  const phone = (body.phone || '').toString().trim();
  const company = (body.company || '').toString().trim();

  if (action === 'reserve' || action === 'sell') {
    if (!buyer) return { code: 400, body: { error: 'buyer_required', message: 'Нужно указать имя клиента' } };
    const conflicts = ids
      .filter((id) => state.items[id])
      .map((id) => ({ standId: id, status: state.items[id].status, buyer: state.items[id].buyer || null, sellerName: state.items[id].sellerName || null }));
    if (conflicts.length) return { code: 409, body: { error: 'conflict', message: 'Часть выбранных мест уже занята.', conflicts, revision: state.revision } };
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
      return { code: 403, body: { error: 'not_allowed', message: 'Проданное место или бронь другого продавца может менять только менеджер.', standIds: locked } };
    }
  }

  const ttlHours = Number(body.ttlHours || ttlDefault);
  // Сколько бы мест ни заняла одна компания — это одна группа (одна рамка и на плане, и в списке).
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
  const ACT = { sell: 'продажа', reserve: 'бронь', release: 'освобождение', block: 'блокировка' };
  console.log(`→ ${sess.name}: ${ACT[action] || action} ${ids.join(', ')}${buyer ? ' · ' + buyer : ''}`);
  return { code: 200, body: { ok: true, revision: state.revision, items: result } };
}

// ---------------------------------------------------------------- router
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  try {
    if (p === '/api/healthz') return send(res, 200, { ok: true, revision: state.revision, pdf: PDF_EXPORT, png: PDF_PNG, layout: rawLayout.meta?.version || null });

    if (p === '/api/login' && req.method === 'POST') {
      const b = await readBody(req);
      const key = String(b.name || b.id || '').trim().toLowerCase();
      const s = sellers.find((x) => x.id.toLowerCase() === key || x.name.toLowerCase() === key);
      if (!s) return send(res, 401, { error: 'not_found', message: 'Продавец не найден' });
      if (String(b.pin) !== String(s.pin)) return send(res, 401, { error: 'bad_pin', message: 'Неверный PIN-код' });
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
        service: exp.service,
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
      if (!sess) return send(res, 401, { error: 'unauthorized', message: 'Сначала войдите в систему' });
      const b = await readBody(req);
      const r = applyAction(sess, b);
      return send(res, r.code, r.body);
    }

    if (p === '/api/audit' && req.method === 'GET') {
      const sess = auth(req);
      if (!sess) return send(res, 401, { error: 'unauthorized' });
      if (sess.role !== 'admin') return send(res, 403, { error: 'forbidden', message: 'Журнал операций видит только менеджер' });
      const limit = Math.min(Number(url.searchParams.get('limit') || 100), 1000);
      if (!fs.existsSync(AUDIT_FILE)) return send(res, 200, { entries: [] });
      const lines = fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n').slice(-limit).reverse();
      return send(res, 200, { entries: lines.map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } }) });
    }

    if (p === '/api/export.csv' && req.method === 'GET') {
      const sess = auth(req);
      if (!sess) return send(res, 401, { error: 'unauthorized' });
      const ST = { free: 'свободно', reserved: 'бронь', sold: 'продано', blocked: 'блокировано' };
      const rows = [['Блок', 'Стенд', 'Статус', 'Площадь, м2', 'Сумма', 'Клиент', 'Телефон', 'Компания', 'Продавец', 'Обновлено']];
      for (const s of exp.stands) {
        const it = state.items[s.id];
        const amount = it ? (it.amount || 0) : pricePerM2 * s.areaM2;
        rows.push([s.blockId, s.id, ST[it ? it.status : 'free'] || 'свободно', String(s.areaM2), amount ? String(amount) : '', it?.buyer || '', it?.phone || '', it?.company || '', it?.sellerName || '', it?.updatedAt || '']);
      }
      const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
      return send(res, 200, '\uFEFF' + csv, 'text/csv; charset=utf-8');
    }

    if (p === '/api/export/pdf' && req.method === 'GET') {
      const page = String(url.searchParams.get('page') || rawLayout.meta?.format || 'A4').toUpperCase();
      // disp=inline — отдать PDF для просмотра в браузере (в новой вкладке), иначе — на скачивание
      const disp = url.searchParams.get('disp') === 'inline' ? 'inline' : 'attachment';
      if (!PDF_EXPORT) return send(res, 503, { error: 'no_pdf', message: 'На сервере нет python3 + reportlab — используйте «Печать плана» (Сохранить как PDF).' });
      let built;
      try {
        built = await buildPlanPdf(page);
      } catch (e) {
        console.error(e.message);
        return send(res, 500, { error: e.code || 'pdf_failed', message: e.message });
      }
      const buf = await fsp.readFile(built.pdfPath);
      const fname = `FOODERA-EXPO-2026-plan-${page}.pdf`;
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disp}; filename="${fname}"`,
        'Content-Length': buf.length,
        'Cache-Control': 'no-store',
      });
      return res.end(buf);
    }

    // Разметка готового листа A4 landscape — для печати «ровно одна страница» прямо из панели.
    if (p === '/api/export/svg' && req.method === 'GET') {
      try {
        const svg = await buildPlanSvg();
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Content-Length': Buffer.byteLength(svg), 'Cache-Control': 'no-store' });
        return res.end(svg);
      } catch (e) {
        console.error(e.message);
        return send(res, 500, { error: e.code || 'svg_failed', message: e.message });
      }
    }

    // Картинка первой страницы PDF — предпросмотр плана прямо в панели (без просмотрщика PDF).
    if (p === '/api/export/png' && req.method === 'GET') {
      const page = String(url.searchParams.get('page') || rawLayout.meta?.format || 'A4').toUpperCase();
      const scale = Math.min(3, Math.max(1, Number(url.searchParams.get('scale') || 1.6)));
      if (!PDF_EXPORT) return send(res, 503, { error: 'no_pdf', message: 'На сервере нет python3 + reportlab — используйте «Печать плана» (Сохранить как PDF).' });
      if (!PDF_PNG) return send(res, 503, { error: 'no_png', message: 'На сервере нет pypdfium2/Pillow — предпросмотр недоступен, скачайте PDF-файл.' });
      let built;
      try {
        built = await buildPlanPdf(page);
      } catch (e) {
        console.error(e.message);
        return send(res, 500, { error: e.code || 'png_failed', message: e.message });
      }
      const pngPath = path.join(built.tmp, 'plan.png');
      const run = spawnSync('python3', [path.join(ROOT, 'tools/pdf-to-png.py'), built.pdfPath, pngPath, String(scale)], { cwd: ROOT, encoding: 'utf8' });
      if (run.status !== 0) {
        console.error(run.stderr);
        return send(res, 500, { error: 'png_failed', message: (run.stderr || '').split('\n')[0] });
      }
      const buf = await fsp.readFile(pngPath);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': buf.length,
        'Cache-Control': 'no-store',
      });
      return res.end(buf);
    }

    if (p.startsWith('/api/')) return send(res, 404, { error: 'not_found', path: p });
    return serveStatic(res, p);
  } catch (e) {
    console.error('✗', e);
    return send(res, 500, { error: 'internal', message: e.message });
  }
}

export default handleRequest;

if (!process.env.VERCEL) {
  const server = http.createServer(handleRequest);
  server.listen(PORT, HOST, () => {
    console.log(`\n🚀 Панель продаж: http://localhost:${PORT}  (0.0.0.0:${PORT})`);
    console.log(`   1 стенд = 9 м² · 1 блок = 8 стендов = 72 м² · ${pricePerM2 ? 'цена ' + pricePerM2.toLocaleString('ru-RU') + ' сум/м²' : 'цена не указана (суммы не считаются)'}`);
    console.log(PDF_EXPORT ? '   PDF-экспорт: /api/export/pdf (кнопка «Скачать PDF» в панели)' + (PDF_PNG ? ' · предпросмотр: /api/export/png\n' : '\n') : '   PDF-экспорт недоступен (нет python3 + reportlab) — работает «Печать плана»\n');
  });
}
