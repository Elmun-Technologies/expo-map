#!/usr/bin/env node
/**
 * Xaritani SVG qilib chiqarish — mijozga yuborish / chop etish uchun.
 * SVG har qanday brauzerda ochiladi, undan PNG/PDF ham oson olinadi.
 *
 *   node tools/export-svg.mjs                        -> exports/hall-A.svg (butun zal)
 *   node tools/export-svg.mjs --block A-01           -> exports/hall-A-A-01.svg (72 m² blok kartasi)
 *   node tools/export-svg.mjs --no-state             -> bron/sotuvlarni hisobga olmaslik
 *   node tools/export-svg.mjs --scale 40 --out katta.svg
 *
 * Barcha o'lchamlar layout/hall-A.json dan olinadi — qo'lda chizish yo'q.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandLayout, validateLayout } from '../lib/layout.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  if (i === -1) return def;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

const layoutPath = path.resolve(ROOT, String(opt('layout', 'layout/hall-A.json')));
const raw = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
const check = validateLayout(raw);
if (!check.ok) {
  console.error('✗ Layout xato — eksport qilinmadi:\n' + check.errors.map((e) => '   ✗ ' + e).join('\n'));
  process.exit(1);
}
const exp = expandLayout(raw);

let stateOpt = opt('state', null);
if (stateOpt === null && !args.includes('--no-state') && fs.existsSync(path.join(ROOT, 'data/state.json'))) stateOpt = 'data/state.json';
const stateFile = stateOpt === true ? 'data/state.json' : stateOpt;
let items = {};
if (stateFile !== null) {
  const p = path.resolve(ROOT, String(stateFile));
  if (fs.existsSync(p)) {
    items = JSON.parse(fs.readFileSync(p, 'utf8')).items || {};
    console.log(`ℹ holat: ${path.relative(ROOT, p)} (${Object.keys(items).length} yozuv)`);
  }
}

const SCALE = Number(opt('scale', 22));            // 1 metr = necha piksel
const blockFilter = typeof opt('block') === 'string' ? opt('block') : null;
const S = (v) => v * SCALE;                        // metr -> px
const R = (v) => Number(v).toFixed(2);

// tipografiya (pikselda — masshtabdan qat'i nazar o'qiladi)
const F = { title: 20, sub: 13, chip: 13, num: 15, sid: 10, legend: 13, feat: 12, foot: 12 };
const PAD = 46;                                     // tashqi hoshiya, px
const STATUS = {
  free: { fill: '#eaf6ec', stroke: '#2e7d32', ink: '#1b5e20', label: "Bo'sh" },
  reserved: { fill: '#fff3d6', stroke: '#f59e0b', ink: '#8a5a00', label: 'Bron' },
  sold: { fill: '#c62828', stroke: '#8e1b1b', ink: '#ffffff', label: 'Sotilgan' },
  blocked: { fill: '#eceff1', stroke: '#607d8b', ink: '#37474f', label: 'Bloklangan' },
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const statusOf = (id) => items[id]?.status || 'free';
const fmtNum = (n) => Number(n || 0).toLocaleString('ru-RU').replace(/\u00A0/g, ' ');
const txtW = (s, px) => String(s).length * px * 0.62;   // DejaVu Sans uchun yetarli aniqlik

// ---------------------------------------------------------------- nima chizamiz
let blocks = exp.blocks;
let content;   // metrda: { x, y, w, h }
if (blockFilter) {
  const b = exp.blocks.find((x) => x.id === blockFilter);
  if (!b) { console.error(`✗ ${blockFilter} topilmadi. Mavjud bloklar: ${exp.blocks.map((x) => x.id).join(', ')}`); process.exit(1); }
  blocks = [b];
  content = { x: b.x, y: b.y, w: b.w, h: b.h };
} else {
  content = { x: 0, y: 0, w: exp.hall.width, h: exp.hall.height };
}

const title = blockFilter
  ? `${blockFilter} bloki · ${fmtNum(content.w)} × ${fmtNum(content.h)} m · 8 stend × 9 m² = 72 m²`
  : `${exp.meta.project} — ${exp.meta.hall} · joylashuv xaritasi`;
const sub = `${exp.meta.pricePerM2 && !blockFilter ? fmtNum(exp.meta.pricePerM2) + " so'm/m² · " : ''}1 stend = 3×3 m = 9 m² · 1 blok = 8 stend = 72 m² · layout v${exp.meta.version || '?'} · ${new Date().toLocaleDateString('ru-RU')}`;

// ---------------------------------------------------------------- legenda qatorlari
const counts = { free: 0, reserved: 0, sold: 0, blocked: 0 };
for (const b of blocks) for (const s of b.stands) counts[statusOf(s.id)]++;
const legendItems = ['free', 'reserved', 'sold', 'blocked'].filter((k) => k !== 'blocked' || counts.blocked);
const innerW = Math.max(S(content.w), Math.max(txtW(title, F.title), txtW(sub, F.sub)));
const legend = [];
{
  let x = 0;
  for (const k of legendItems) {
    const text = `${STATUS[k].label}: ${counts[k]} stend · ${fmtNum(counts[k] * 9)} m²`;
    const w = 20 + txtW(text, F.legend) + 18;
    if (x > 0 && x + w > innerW) { x = 0; }
    legend.push({ k, text, x, row: legend.length ? legend[legend.length - 1].row + (x === 0 ? 1 : 0) : 0 });
    x += w;
  }
  // qatorlar soni
  let row = 0, cx = 0;
  legend.length = 0;
  for (const k of legendItems) {
    const text = `${STATUS[k].label}: ${counts[k]} stend · ${fmtNum(counts[k] * 9)} m²`;
    const w = 20 + txtW(text, F.legend) + 18;
    if (cx > 0 && cx + w > innerW) { row++; cx = 0; }
    legend.push({ k, text, x: cx, row });
    cx += w;
  }
}
const legendRows = legend.length ? legend[legend.length - 1].row + 1 : 0;
const legendH = legendRows ? legendRows * (F.legend + 12) + 10 : 0;
// blok kartasida sarlavha ostida blok yorlig'i uchun ham joy kerak
const headerH = F.title + F.sub + 22 + (blockFilter ? F.chip + 24 : 0);

// ---------------------------------------------------------------- sahifa o'lchami
const headerW = Math.max(txtW(title, F.title), txtW(sub, F.sub)) + PAD * 2;
const pageW = Math.max(S(content.w) + PAD * 2, headerW);
const pageH = S(content.h) + PAD * 2 + headerH + legendH + (blockFilter ? 0 : 30);
const contentTop = PAD + headerH;
const contentBottom = contentTop + S(content.h);
const ox = PAD - S(content.x);
const oy = contentTop - S(content.y);
const X = (m) => ox + S(m);      // metr -> px (sahifa koordinatasi), raqam qaytaradi
const Y = (m) => oy + S(m);      // chiqarishda R() bilan yaxlitlanadi

const out = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${pageW.toFixed(0)}" height="${pageH.toFixed(0)}" viewBox="0 0 ${pageW.toFixed(0)} ${pageH.toFixed(0)}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif">`);
out.push(`<rect width="${pageW.toFixed(0)}" height="${pageH.toFixed(0)}" fill="#ffffff"/>`);

// sarlavha (title/sub yuqorida hisoblangan)
out.push(`<text x="${PAD}" y="${PAD + F.title}" font-size="${F.title}" font-weight="bold" fill="#0f2233">${esc(title)}</text>`);
out.push(`<text x="${PAD}" y="${PAD + F.title + F.sub + 8}" font-size="${F.sub}" fill="#5b6b7a">${esc(sub)}</text>`);

// zal konturi va obyektlar
if (!blockFilter) {
  const outline = exp.hall.outline?.length >= 3
    ? exp.hall.outline.map((p) => `${X(p[0])},${Y(p[1])}`).join(' ')
    : `${X(0)},${Y(0)} ${X(exp.hall.width)},${Y(0)} ${X(exp.hall.width)},${Y(exp.hall.height)} ${X(0)},${Y(exp.hall.height)}`;
  out.push(`<polygon points="${outline}" fill="#fbfcfd" stroke="#0f2233" stroke-width="2"/>`);
  for (const f of exp.features || []) {
    out.push(`<rect x="${R(X(f.x))}" y="${R(Y(f.y))}" width="${R(S(f.w))}" height="${R(S(f.h))}" rx="3" fill="#e8edf2" stroke="#b9c4ce" stroke-width="1.2"/>`);
    if (f.label) {
      const cx = X(f.x + f.w / 2), cy = Y(f.y + f.h / 2);
      const fs = Math.max(10, Math.min(F.feat + 3, S(f.w) / (f.label.length * 0.62) * 0.75));
      out.push(`<text x="${R(cx)}" y="${R(cy + fs * 0.35)}" font-size="${R(fs)}" fill="#5b6b7a" text-anchor="middle">${esc(f.label)}</text>`);
    }
  }
}

// bloklar va stendlar
for (const b of blocks) {
  out.push(`<rect x="${R(X(b.x))}" y="${R(Y(b.y))}" width="${R(S(b.w))}" height="${R(S(b.h))}" fill="none" stroke="#90a4b5" stroke-width="1.4" stroke-dasharray="7 5" rx="4"/>`);

  // blok yorlig'i
  const chipText = `${b.label} · 72 m²`;
  const chipW = Math.min(S(b.w) + 60, txtW(chipText, F.chip) + 22);
  const chipH = F.chip + 12;
  const chipX = X(b.x), chipY = Y(b.y) - chipH - 7;
  out.push(`<rect x="${R(chipX)}" y="${R(chipY)}" width="${R(chipW)}" height="${chipH}" rx="5" fill="#0f2233"/>`);
  out.push(`<text x="${R(chipX + chipW / 2)}" y="${R(chipY + chipH / 2 + F.chip * 0.35)}" font-size="${F.chip}" font-weight="bold" fill="#ffffff" text-anchor="middle">${esc(chipText)}</text>`);

  for (const s of b.stands) {
    const st = STATUS[statusOf(s.id)];
    out.push(`<rect x="${R(X(s.x))}" y="${R(Y(s.y))}" width="${R(S(s.w))}" height="${R(S(s.h))}" rx="3" fill="${st.fill}" stroke="${st.stroke}" stroke-width="1.1"/>`);
    const cx = X(s.x + s.w / 2), cy = Y(s.y + s.h / 2);
    out.push(`<text x="${R(cx)}" y="${R(cy - 2)}" font-size="${F.num}" font-weight="bold" fill="${st.ink}" text-anchor="middle">${esc(s.noLabel)}</text>`);
    out.push(`<text x="${R(cx)}" y="${R(cy + F.sid + 6)}" font-size="${F.sid}" fill="${st.ink}" text-anchor="middle" opacity="0.85">${esc(s.id.replace(/^.*?-(?=\d+$)/, ''))}</text>`);
  }
}

// legenda
const ly = contentBottom + F.legend + 16;
for (const L of legend) {
  const x = PAD + L.x;
  const y = ly + L.row * (F.legend + 12);
  out.push(`<rect x="${R(x)}" y="${R(y - F.legend)}" width="${F.legend + 2}" height="${F.legend + 2}" rx="3" fill="${STATUS[L.k].fill}" stroke="${STATUS[L.k].stroke}" stroke-width="1.4"/>`);
  out.push(`<text x="${R(x + F.legend + 10)}" y="${R(y)}" font-size="${F.legend}" fill="#33454f">${esc(L.text)}</text>`);
}
const totalStands = blocks.reduce((a, b) => a + b.stands.length, 0);
out.push(`<text x="${pageW - PAD}" y="${pageH - PAD + F.foot}" font-size="${F.foot}" fill="#33454f" text-anchor="end">Jami: ${totalStands} stend · ${fmtNum(totalStands * 9)} m²</text>`);
out.push('</svg>');

// yozish
const baseName = path.basename(layoutPath).replace(/\.json$/, '');
const outPath = path.resolve(ROOT, String(opt('out', `exports/${baseName}${blockFilter ? '-' + blockFilter : ''}.svg`)));
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out.join('\n'));
const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
console.log(`✓ ${path.relative(ROOT, outPath)} — ${pageW.toFixed(0)}×${pageH.toFixed(0)} px (${kb} KB), ${totalStands} stend · ${fmtNum(totalStands * 9)} m²`);
