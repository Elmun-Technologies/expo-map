#!/usr/bin/env node
/**
 * Xaritani SVG qilib chiqarish — mijozga yuborish / chop etish uchun.
 * SVG har qanday brauzerda ochiladi, undan PNG/PDF ham oson olinadi.
 *
 *   node tools/export-svg.mjs                          -> butun zal (bo'limlar jadvali bilan)
 *   node tools/export-svg.mjs --section A              -> bitta bo'lim (72 m²)
 *   node tools/export-svg.mjs --block A                 -> bitta blok
 *   node tools/export-svg.mjs --no-state               -> bron/sotuvlarni hisobga olmaslik (bo'sh holat)
 *   node tools/export-svg.mjs --scale 40 --out katta.svg
 *
 * Barcha o'lchamlar layout JSON'dan olinadi — qo'lda chizish yo'q.
 * QORALAMA (meta.status != "approved") xarita mijozga chiqmaydi (--force bilan majburan).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandLayout, validateLayout } from '../lib/layout.mjs';
import { groupBookings, unionPath, fitText, largestRect, mergedAsStands } from '../lib/groups.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  if (i === -1) return def;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

// ---------------------------------------------------------------- yuklash
const layoutPath = path.resolve(ROOT, String(opt('layout', process.env.LAYOUT || 'layout/foodera-2026.json')));
const raw = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
const check = validateLayout(raw);
if (!check.ok) {
  console.error('✗ Layout xato — eksport qilinmadi:\n' + check.errors.map((e) => '   ✗ ' + e).join('\n'));
  process.exit(1);
}
const isDraft = (raw.meta?.status || 'draft') !== 'approved';
if (isDraft && !args.includes('--force')) {
  console.error(`✗ Bu xarita QORALAMA (meta.status = "${raw.meta?.status || 'draft'}") — mijozga yuborish uchun avval raqamlarni tasdiqlang,\n  keyin layout JSON'da meta.status = "approved" qiling. Majburan chiqarish kerak bo'lsa: --force`);
  process.exit(1);
}
const exp = expandLayout(raw);
const sectionById = (id) => (exp.sections || []).find((s) => s.id === id) || null;

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

const SCALE = Number(opt('scale', 22));                       // 1 metr = necha piksel
const blockFilter = typeof opt('block') === 'string' ? opt('block') : null;
const sectionFilter = typeof opt('section') === 'string' ? opt('section') : null;

// ---------------------------------------------------------------- tipografiya va yordamchilar
const F = { title: 20, sub: 13, chip: 13, num: 15, sid: 10, legend: 13, feat: 12, foot: 12, secbar: 15 };
const PAD = 46;
const STATUS = {
  free: { fill: '#eaf6ec', stroke: '#2e7d32', ink: '#1b5e20', label: "Bo'sh" },
  reserved: { fill: '#fff3d6', stroke: '#f59e0b', ink: '#8a5a00', label: 'Bron' },
  sold: { fill: '#c62828', stroke: '#8e1b1b', ink: '#ffffff', label: 'Sotilgan' },
  blocked: { fill: '#eceff1', stroke: '#607d8b', ink: '#37474f', label: 'Bloklangan' },
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const statusOf = (id) => items[id]?.status || 'free';
const fmtNum = (n) => Number(n || 0).toLocaleString('ru-RU').replace(/\u00A0/g, ' ');
const txtW = (s, px) => String(s).length * px * 0.62;

/** Matnni berilgan kenglik/balandlikka sig'adigan qatorlarga bo'lish (kerak bo'lsa ellipsis). */
function wrapText(text, maxW, maxH, maxLines, maxFs) {
  const words = String(text).split(/\s+/);
  const lines = [];
  const FScap = maxFs || 15;
  let cur = '';
  const fits = (s, fs) => txtW(s, fs) <= maxW;
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (!fits(next, FScap) && cur) { lines.push(cur); cur = w; } else { cur = next; }
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  const used = lines.join(' ');
  if (used.length < String(text).length) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && txtW(last + '…', 11) > maxW) last = last.slice(0, -1);
    lines[lines.length - 1] = last + '…';
  }
  return lines.slice(0, maxLines);
}

// ---------------------------------------------------------------- eksport maydoni
let blocks = exp.blocks;
let secCustom = [];
let content;
if (sectionFilter) {
  const sec = sectionById(sectionFilter);
  if (!sec) { console.error(`✗ "${sectionFilter}" bo'limi topilmadi. Mavjud: ${(exp.sections || []).map((s) => s.id).join(', ')}`); process.exit(1); }
  blocks = exp.blocks.filter((b) => b.section === sec.id);
  secCustom = [];
  if (!blocks.length) { console.error(`✗ "${sectionFilter}" bo'limida stend yo'q`); process.exit(1); }
  const m = 3.5;
  const rects = blocks.map((b) => [b.x, b.y, b.x + b.w, b.y + b.h]);
  const x1 = Math.min(...rects.map((r) => r[0])), y1 = Math.min(...rects.map((r) => r[1]));
  const x2 = Math.max(...rects.map((r) => r[2])), y2 = Math.max(...rects.map((r) => r[3]));
  content = { x: x1 - m, y: y1 - m, w: x2 - x1 + m * 2, h: y2 - y1 + m * 2 };
} else if (blockFilter) {
  const b = exp.blocks.find((x) => x.id === blockFilter);
  if (!b) { console.error(`✗ ${blockFilter} topilmadi. Mavjud bloklar: ${exp.blocks.map((x) => x.id).join(', ')}`); process.exit(1); }
  blocks = [b];
  const m = 2.5;
  content = { x: b.x - m, y: b.y - m, w: b.w + m * 2, h: b.h + m * 2 };
} else {
  content = { x: 0, y: 0, w: exp.hall.width, h: exp.hall.height };
}
const detail = !!sectionFilter || !!blockFilter;

const sectionTitle = sectionFilter ? sectionById(sectionFilter) : null;
const title = sectionTitle
  ? `${sectionTitle.label}${sectionTitle.labelRu ? ' — ' + sectionTitle.labelRu : ''}`
  : blockFilter
  ? `${blockFilter} bloki · ${fmtNum(content.w - 5)} × ${fmtNum(content.h - 5)} m`
  : `${exp.meta.project} — ${exp.meta.hall} · joylashuv xaritasi`;
const sub = `${exp.meta.pricePerM2 && !detail ? fmtNum(exp.meta.pricePerM2) + " so'm/m² · " : ''}1 stend = 3×3 m = 9 m² · 1 blok = 8 stend = 72 m² · layout v${exp.meta.version || '?'} · ${new Date().toLocaleDateString('ru-RU')}`;

// ---------------------------------------------------------------- stendlar va legenda
// nostandart stendlar ham exp.blocks ichida (kind: 'custom') — qo'shib hisoblash takror bo'lardi
const mergedAll = blocks.flatMap((b) => (b.merged || []).map((m, i) => ({
  id: `${b.id}~m${i}`, x: m.x, y: m.y, w: m.w, h: m.h, areaM2: m.w * m.h,
  blockId: b.id, section: b.section || null, mergedCell: true, status: m.status || null, buyer: m.buyer || m.label || '',
})));
const allStands = [...blocks.flatMap((b) => b.stands), ...mergedAll];
const counts = { free: 0, reserved: 0, sold: 0, blocked: 0 };
const areas = { free: 0, reserved: 0, sold: 0, blocked: 0 };
for (const s of allStands) {
  const st = s.mergedCell ? (s.status && items[s.id] ? items[s.id].status : s.status || 'free') : statusOf(s.id);
  counts[st] = (counts[st] || 0) + 1;
  areas[st] = (areas[st] || 0) + s.areaM2;
}
const legendItems = ['free', 'reserved', 'sold', 'blocked'].filter((k) => k !== 'blocked' || counts.blocked);

// ---------------------------------------------------------------- sahifa o'lchami
const S = (v) => v * SCALE;
const R = (v) => Number(v).toFixed(2);
const innerW = Math.max(S(content.w), txtW(title, F.title), txtW(sub, F.sub));
const legend = [];
{
  let row = 0, cx = 0;
  for (const k of legendItems) {
    const text = `${STATUS[k].label}: ${counts[k]} stend · ${fmtNum(areas[k])} m²`;
    const w = 20 + txtW(text, F.legend) + 18;
    if (cx > 0 && cx + w > innerW) { row++; cx = 0; }
    legend.push({ k, text, x: cx, row });
    cx += w;
  }
}
const legendRows = legend.length ? legend[legend.length - 1].row + 1 : 0;
const legendH = legendRows ? legendRows * (F.legend + 12) + 10 : 0;
const headerH = F.title + F.sub + 22 + (isDraft ? 34 : 0);

// bo'limlar jadvali (faqat butun zal eksportida)
const sectionRows = (!detail && (exp.sections || []).length)
  ? exp.sections.map((sec) => {
      const st = allStands.filter((x) => x.section === sec.id && !x.mergedCell);
      const mg = allStands.filter((x) => x.section === sec.id && x.mergedCell);
      if (!st.length && !mg.length) return null;
      const free = st.filter((x) => statusOf(x.id) === 'free');
      return {
        sec,
        n: st.length,
        merged: mg.length,
        area: [...st, ...mg].reduce((a, x) => a + x.areaM2, 0),
        free: free.length,
        freeArea: free.reduce((a, x) => a + x.areaM2, 0),
      };
    }).filter(Boolean)
  : [];
// BAND joylar: bitta kompaniya nechta stend olgan bo'lsa — BITTA quti, nomi ichida.
// (kompaniyalar ro'yxati jadvali olib tashlandi — nom xaritada o'z joyida ko'rinadi)
const neutral = stateFile === null;                 // --no-state: bo'sh xarita (katalog/bozor uchun)
const extraUnits = neutral ? { stands: [], items: {} } : mergedAsStands(blocks);
const units = groupBookings([...allStands, ...extraUnits.stands], Object.assign({}, items, extraUnits.items));
const bookedIds = new Set(units.flatMap((u) => u.ids.filter((id) => !id.includes('~m'))));
const mergedDrawn = new Set(units.flatMap((u) => u.ids.filter((id) => id.includes('~m'))));
const secLineH = F.legend + 9;
const secTableH = sectionRows.length ? (F.legend + 12) + sectionRows.length * secLineH + 16 : 0;
const buyerTableH = 0;

const pageW = Math.max(S(content.w) + PAD * 2, innerW + PAD * 2);
const pageH = S(content.h) + PAD * 2 + headerH + legendH + secTableH + buyerTableH + 34;
const contentTop = PAD + headerH;
const contentBottom = contentTop + S(content.h);
const ox = PAD - S(content.x);
const oy = contentTop - S(content.y);
const X = (m) => ox + S(m);
const Y = (m) => oy + S(m);

// ---------------------------------------------------------------- chizish
const out = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${pageW.toFixed(0)}" height="${pageH.toFixed(0)}" viewBox="0 0 ${pageW.toFixed(0)} ${pageH.toFixed(0)}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif">`);
out.push(`<rect width="${pageW.toFixed(0)}" height="${pageH.toFixed(0)}" fill="#ffffff"/>`);
if (isDraft) {
  out.push(`<rect x="0" y="0" width="${pageW.toFixed(0)}" height="26" fill="#8e1b1b"/>`);
  out.push(`<text x="${(pageW / 2).toFixed(0)}" y="18" font-size="13" font-weight="bold" fill="#ffffff" text-anchor="middle">QORALAMA - raqamlar tasdiqlanmagan, mijozga yuborilmaydi</text>`);
}
out.push(`<text x="${PAD}" y="${PAD + F.title}" font-size="${F.title}" font-weight="bold" fill="#0f2233">${esc(title)}</text>`);
out.push(`<text x="${PAD}" y="${PAD + F.title + F.sub + 8}" font-size="${F.sub}" fill="#5b6b7a">${esc(sub)}</text>`);

// zonalar
if (!detail) {
  var zoneLabels = [];
  for (const z of exp.zones || []) {
    if (!z.w || !z.h) continue;
    out.push(`<rect x="${R(X(z.x))}" y="${R(Y(z.y))}" width="${R(S(z.w))}" height="${R(S(z.h))}" rx="4" fill="${z.color || '#f2f5f8'}" fill-opacity="0.9" stroke="#c9d6e2" stroke-width="1" stroke-dasharray="9 6"/>`);
    const pos = z.labelPos || 'none';
    if (pos === 'none') continue;
    const y = pos === 'above' ? Y(z.y) - 8 : pos === 'bottom' ? Y(z.y + z.h) - 10 : Y(z.y) + 26;
    zoneLabels.push({ z, y });
  }
  // zal konturi
  const outline = exp.hall.outline?.length >= 3
    ? exp.hall.outline.map((p) => `${R(X(p[0]))},${R(Y(p[1]))}`).join(' ')
    : `${R(X(0))},${R(Y(0))} ${R(X(exp.hall.width))},${R(Y(0))} ${R(X(exp.hall.width))},${R(Y(exp.hall.height))} ${R(X(0))},${R(Y(exp.hall.height))}`;
  out.push(`<polygon points="${outline}" fill="none" stroke="#0f2233" stroke-width="2.4"/>`);
  // obyektlar
  for (const f of exp.features || []) {
    out.push(`<rect x="${R(X(f.x))}" y="${R(Y(f.y))}" width="${R(S(f.w))}" height="${R(S(f.h))}" rx="3" fill="#e8edf2" stroke="#b9c4ce" stroke-width="1.2"/>`);
    if (f.label) {
      const boxes = S(f.w) - 10;
      const fit1 = boxes / Math.max(6, f.label.length) * 1.45;
      let lines = [f.label];
      let fs = Math.max(9, Math.min(F.feat + 3, fit1));
      if (fit1 < 11.5) {
        // 2 qatorga bo'lish: eng uzun so'zga sig'adigan variant
        const words = f.label.split(' ');
        if (words.length > 1) {
          let best = null;
          for (let i = 1; i < words.length; i++) {
            const a = words.slice(0, i).join(' ');
            const b2 = words.slice(i).join(' ');
            const worst = Math.max(a.length, b2.length);
            const f2 = boxes / Math.max(6, worst) * 1.45;
            if (!best || worst < best.worst) best = { a, b: b2, worst, fs: f2 };
          }
          if (best) { lines = [best.a, best.b]; fs = Math.max(9, Math.min(F.feat + 3, best.fs)); }
        }
      }
      const cy = Y(f.y + f.h / 2) + (lines.length > 1 ? fs * 0.05 : fs * 0.36);
      lines.forEach((ln, i) => {
        const dy = lines.length > 1 ? cy + (i - 0.5) * (fs + 2) + fs * 0.36 : cy;
        out.push(`<text x="${R(X(f.x + f.w / 2))}" y="${R(dy)}" font-size="${R(fs)}" fill="#5b6b7a" text-anchor="middle">${esc(ln)}</text>`);
      });
    }
  }
}

// bloklar, stendlar, bo'lim yorliqlari
for (const b of blocks) {
  if (b.kind !== 'custom') {
    out.push(`<rect x="${R(X(b.x))}" y="${R(Y(b.y))}" width="${R(S(b.w))}" height="${R(S(b.h))}" fill="none" stroke="#90a4b5" stroke-width="1.4" stroke-dasharray="7 5" rx="4"/>`);
    const effArea = b.areaM2 + (b.merged || []).reduce((a, m) => a + m.w * m.h, 0);
    const chipText = `${b.label} · ${fmtNum(effArea)} m²`;
    const chipW = Math.min(S(b.w) + 70, txtW(chipText, F.chip) + 22);
    const chipH = F.chip + 12;
    const chipX = X(b.x), chipY = Y(b.y) - chipH - 7;
    out.push(`<rect x="${R(chipX)}" y="${R(chipY)}" width="${R(chipW)}" height="${chipH}" rx="5" fill="${b.color || '#0f2233'}"/>`);
    out.push(`<text x="${R(chipX + chipW / 2)}" y="${R(chipY + chipH / 2 + F.chip * 0.35)}" font-size="${F.chip}" font-weight="bold" fill="#ffffff" text-anchor="middle">${esc(chipText)}</text>`);
    for (const s of b.stands) if (!bookedIds.has(s.id)) drawStand(s, false, b);
    const sec = sectionById(b.section);
    if (sec) {
      const cx = X(b.x + b.w / 2);
      const room = roomBelowBlock(b);
      out.push(`<rect x="${R(cx - 34)}" y="${R(Y(b.y + b.h) + 10)}" width="68" height="7" rx="3.5" fill="${sec.color}"/>`);
      if (room > 4.6) {
        const fitFs = (txt) => Math.max(7, Math.min(F.secbar, (S(b.w) - 14) / Math.max(4, txt.length) / 0.6));
        out.push(`<text x="${R(cx)}" y="${R(Y(b.y + b.h) + 36)}" font-size="${R(fitFs(`${b.label} bloki`))}" font-weight="bold" fill="#0f2233" text-anchor="middle">${esc(b.label)} bloki</text>`);
        out.push(`<text x="${R(cx)}" y="${R(Y(b.y + b.h) + 54)}" font-size="${R(fitFs(sec.short || sec.label))}" fill="#5b6b7a" text-anchor="middle">${esc(sec.short || sec.label)}</text>`);
      }
    }
    // birlashtirilgan (stendlar olib tashlangan) kataklar
    for (const m of b.merged || []) {
      if (mergedDrawn.has(`${b.id}~m${(b.merged || []).indexOf(m)}`)) continue;
      const st = !neutral && m.status ? STATUS[m.status] : null;
      out.push(`<rect x="${R(X(m.x))}" y="${R(Y(m.y))}" width="${R(S(m.w))}" height="${R(S(m.h))}" rx="3" fill="${st ? st.fill : (b.color || '#0f2233')}" fill-opacity="${st ? 1 : 0.85}" stroke="${st ? st.stroke : '#0f2233'}" stroke-width="1.3"/>`);
      const cx = X(m.x + m.w / 2), cy = Y(m.y + m.h / 2);
      const label = neutral ? '' : String(m.label || '');
      const maxLines = S(m.h) > 55 ? 3 : 2;
      const lines = wrapText(label, S(m.w) - 12, S(m.h) - 10, maxLines, 15);
      const lh = Math.min(S(m.h) / (lines.length + 1.1), 20);
      // shrift balandlikka ham, eng uzun qatorning kengligiga ham sig'sin
      const widestPerPx = Math.max(...lines.map((l) => txtW(l, 1)), 1);
      const fsByWidth = (S(m.w) - 12) / widestPerPx;
      const fs = Math.max(6.5, Math.min(14, lh * 0.8, fsByWidth));
      const ink = st ? st.ink : '#ffffff';
      lines.forEach((ln, idx) => {
        out.push(`<text x="${R(cx)}" y="${R(cy - (lines.length - 1) * lh / 2 + idx * lh + fs * 0.36)}" font-size="${R(fs)}" font-weight="bold" fill="${ink}" text-anchor="middle">${esc(ln)}</text>`);
      });
      if (!neutral && m.buyer && m.buyer !== label) {
        const bl = wrapText(m.buyer, S(m.w) - 10, 14, 1);
        out.push(`<text x="${R(cx)}" y="${R(cy + S(m.h) / 2 - 6)}" font-size="${R(Math.max(6.5, fs * 0.72))}" fill="${ink}" text-anchor="middle" opacity="0.95">${esc(bl[0])}</text>`);
      }
    }
  }
}
// nostandart (custom) bloklar: ramka va chip yo'q, faqat stendning o'zi
for (const b of blocks) {
  if (b.kind !== 'custom') continue;
  for (const s of b.stands) if (!bookedIds.has(s.id)) drawStand(s, true, b);
}

/** Kompaniyaning band joyi — bitta quti + nomi ichida. */
function drawUnit(u) {
  const st = STATUS[u.status] || STATUS.sold;
  const d = unionPath(u.stands.map((s) => ({ x: X(s.x), y: Y(s.y), w: S(s.w), h: S(s.h) })));
  out.push(`<path d="${d}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="2"/>`);
  const boxes = largestRect(u.stands.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h })), 0.25);
  const boxW = S(boxes.w), boxH = S(boxes.h);
  const onlyMerged = u.stands.every((st) => st.mergedCell);
  const metaTxt = onlyMerged
    ? `${fmtNum(u.areaM2)} m²`
    : u.stands.length > 1
      ? `${u.stands.length} stend · ${fmtNum(u.areaM2)} m²`
      : (Math.abs(u.areaM2 - 9) > 0.01 ? `${fmtNum(u.areaM2)} m²` : '');
  const withMeta = !!metaTxt && boxH > 52;
  const label = u.label || st.label;
  const fit = fitText(label, boxW - 14, boxH - (withMeta ? 26 : 8), { maxLines: boxH > 120 ? 3 : boxH > 58 ? 2 : 1, minFs: 7, maxFs: Math.min(26, boxH / (withMeta ? 3.4 : 2.6)), cw: 0.62, lh: 1.2 });
  const cx = X(boxes.x + boxes.w / 2), cy = Y(boxes.y + boxes.h / 2);
  const lh = fit.fs * 1.2;
  const shift = (fit.lines.length * lh) / 2;
  fit.lines.forEach((ln, i) => {
    const yy = cy - shift + lh * (i + 0.84) + (withMeta ? -6 : 1);
    out.push(`<text x="${R(cx)}" y="${R(yy)}" font-size="${R(fit.fs)}" font-weight="bold" fill="${st.ink}" text-anchor="middle">${esc(ln)}</text>`);
  });
  if (withMeta) {
    out.push(`<text x="${R(cx)}" y="${R(cy + shift + (fit.lines.length ? 12 : 5))}" font-size="${R(Math.max(8, fit.fs * 0.55))}" fill="${st.ink}" text-anchor="middle" opacity="0.92">${esc(metaTxt)}</text>`);
  }
}

for (const u of units) drawUnit(u);

// blok ostida qancha bo'sh joy bor (chip yoki boshqa blok bosib qolmasligi uchun)
function roomBelowBlock(b) {
  let gap = 99;
  for (const o of [...exp.blocks, ...(exp.features || [])]) {
    if (o.id === b.id) continue;
    const ow = o.w ?? 2;
    const xOverlap = Math.min(o.x + ow, b.x + b.w) - Math.max(o.x, b.x);
    if (xOverlap <= 0.1) continue;
    const dy = o.y - (b.y + b.h);
    if (dy >= 0) gap = Math.min(gap, dy);
  }
  return gap;
}

function drawStand(s, custom, b0) {
  const st = STATUS[statusOf(s.id)];
  out.push(`<rect x="${R(X(s.x))}" y="${R(Y(s.y))}" width="${R(S(s.w))}" height="${R(S(s.h))}" rx="3" fill="${st.fill}" stroke="${s.color || st.stroke}" stroke-width="1.1"${custom ? ' stroke-dasharray="6 4"' : ''}/>`);
  const cx = X(s.x + s.w / 2), cy = Y(s.y + s.h / 2);
  const fs = Math.max(9, Math.min(F.num, S(s.w) / 4.2));
  if (custom) {
    // nostandart stend: nomi + maydoni + mijoz — barchasi karta ichida, ustma-ust tushmaydi
    const h = S(s.h);
    const name = String(s.label || s.id);
    const buyer = items[s.id]?.buyer ? String(items[s.id].buyer) : '';
    const lines = buyer ? 3 : 2;
    const fsName = Math.max(8, Math.min(F.num + 3, (S(s.w) - 12) / Math.max(2, name.length) / 0.66, h / (lines + 1.6) * 1.05));
    const fsSmall = Math.max(7, Math.min(F.sid, fsName * 0.72));
    const step = (fsName + fsSmall * 2.1) / lines;
    const y0 = cy - (lines - 1) * step / 2 + fsName * 0.34;
    out.push(`<text x="${R(cx)}" y="${R(y0)}" font-size="${R(fsName)}" font-weight="bold" fill="${st.ink}" text-anchor="middle">${esc(name)}</text>`);
    out.push(`<text x="${R(cx)}" y="${R(y0 + step)}" font-size="${R(fsSmall)}" fill="${st.ink}" text-anchor="middle" opacity="0.9">${esc(fmtNum(s.areaM2))} m²</text>`);
    if (buyer) {
      const avail = S(s.w) - 12;
      const bfs = Math.min(fsSmall, avail / Math.max(6, buyer.length) / 0.62);
      if (bfs > 6.5) out.push(`<text x="${R(cx)}" y="${R(y0 + step * 2)}" font-size="${R(bfs)}" font-weight="bold" fill="${st.ink}" text-anchor="middle" opacity="0.95">${esc(buyer)}</text>`);
    }
  } else {
    out.push(`<text x="${R(cx)}" y="${R(cy - 2)}" font-size="${R(fs)}" font-weight="bold" fill="${st.ink}" text-anchor="middle">${esc(s.noLabel)}</text>`);
    const idText = s.id.replace(/^.*?-(?=\d+$)/, '');
    out.push(`<text x="${R(cx)}" y="${R(cy + F.sid + 6)}" font-size="${F.sid}" fill="${st.ink}" text-anchor="middle" opacity="0.85">${esc(idText)}</text>`);
    if (items[s.id]?.buyer) {
      // kenglikka mos shrift: nom stend chegarasidan chiqmasin
      const avail = S(s.w) - 8;
      let buyer = String(items[s.id].buyer);
      let bfs = Math.min(F.sid - 1, avail / Math.max(4, buyer.length) / 0.6);
      if (bfs >= 8) {
        out.push(`<text x="${R(cx)}" y="${R(cy + F.sid + 18)}" font-size="${R(bfs)}" fill="${st.ink}" text-anchor="middle" opacity="0.95">${esc(buyer)}</text>`);
      }
    }
  }
}

// legenda
let ly = contentBottom + F.legend + 16;
for (const L of legend) {
  const x = PAD + L.x;
  const y = ly + L.row * (F.legend + 12);
  out.push(`<rect x="${R(x)}" y="${R(y - F.legend)}" width="${F.legend + 2}" height="${F.legend + 2}" rx="3" fill="${STATUS[L.k].fill}" stroke="${STATUS[L.k].stroke}" stroke-width="1.4"/>`);
  out.push(`<text x="${R(x + F.legend + 10)}" y="${R(y)}" font-size="${F.legend}" fill="#33454f">${esc(L.text)}</text>`);
}
ly += legendRows * (F.legend + 12);

// bo'limlar jadvali
if (sectionRows.length) {
  ly += F.legend + 12;
  out.push(`<text x="${PAD}" y="${R(ly)}" font-size="${F.legend + 1}" font-weight="bold" fill="#0f2233">Bo'limlar bo'yicha</text>`);
  ly += secLineH;
  for (const r of sectionRows) {
    out.push(`<rect x="${PAD}" y="${R(ly - F.legend + 1)}" width="${F.legend}" height="${F.legend}" rx="2" fill="${r.sec.color}"/>`);
    out.push(`<text x="${PAD + F.legend + 8}" y="${R(ly)}" font-size="${F.legend}" fill="#33454f">${esc(r.sec.label)}${r.sec.labelRu ? ' · ' + esc(r.sec.labelRu) : ''}</text>`);
    const mix = `${r.n} stend${r.merged ? ` + ${r.merged} katak` : ''}`;
    out.push(`<text x="${R(PAD + 700)}" y="${R(ly)}" font-size="${F.legend}" fill="#33454f">${mix} · ${fmtNum(r.area)} m² · bo'sh: ${r.free} (${fmtNum(r.freeArea)} m²)</text>`);
    ly += secLineH;
  }
}

// zona yorliqlari eng oxirida (hech narsa ularni bosmasin)
for (const { z, y } of (typeof zoneLabels !== 'undefined' ? zoneLabels : [])) {
  out.push(`<text x="${R(X(z.x + z.w / 2))}" y="${R(y)}" font-size="${F.feat + 3}" font-weight="bold" fill="#8fa0af" text-anchor="middle" letter-spacing="0.4">${esc(z.label)}</text>`);
}

const totalStands = allStands.filter((s) => !s.mergedCell).length;
const totalMerged = allStands.length - totalStands;
const totalArea = allStands.reduce((a, s) => a + s.areaM2, 0);
out.push(`<text x="${pageW - PAD}" y="${pageH - 18}" font-size="${F.foot}" fill="#33454f" text-anchor="end">Jami: ${totalStands} stend${totalMerged ? ` + ${totalMerged} katak` : ''} · ${fmtNum(totalArea)} m² · bo'sh: ${counts.free} (${fmtNum(areas.free)} m²)</text>`);
out.push('</svg>');

// ---------------------------------------------------------------- yozish
const baseName = path.basename(layoutPath).replace(/\.json$/, '');
const suffix = sectionFilter ? `-sec-${sectionFilter}` : blockFilter ? `-${blockFilter}` : '';
const outPath = path.resolve(ROOT, String(opt('out', `exports/${baseName}${suffix}.svg`)));
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out.join('\n'));
const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
console.log(`✓ ${path.relative(ROOT, outPath)} — ${pageW.toFixed(0)}×${pageH.toFixed(0)} px (${kb} KB), ${totalStands} stend${totalMerged ? ` + ${totalMerged} katak` : ''} · ${fmtNum(totalArea)} m²`);
