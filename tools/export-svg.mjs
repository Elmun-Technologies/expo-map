#!/usr/bin/env node
/**
 * Экспорт плана зала в SVG — для клиента, печати и PDF.
 *
 *   node tools/export-svg.mjs                       → весь зал (лист A4 landscape + таблица разделов)
 *   node tools/export-svg.mjs --map                 → ТОЛЬКО план (без таблицы) — для PDF
 *   node tools/export-svg.mjs --section A           → один раздел
 *   node tools/export-svg.mjs --block A             → один блок (8 стендов)
 *   node tools/export-svg.mjs --no-state            → без броней/продаж (пустой зал, каталог)
 *   node tools/export-svg.mjs --style=status        → старая цветная палитра статусов
 *   node tools/export-svg.mjs --out katta.svg --scale 22
 *
 * Все размеры берутся из layout JSON — вручную ничего не рисуется.
 * Черновик (meta.status != "approved") клиенту не отдаётся (можно --force).
 * Весь текст — на русском языке.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandLayout, validateLayout, ruleNote } from '../lib/layout.mjs';
import { groupBookings, unionPath, fitText, largestRect, mergedAsStands, textWidth } from '../lib/groups.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  if (i === -1) return def;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

// ---------------------------------------------------------------- загрузка
const layoutPath = path.resolve(ROOT, String(opt('layout', process.env.LAYOUT || 'layout/foodera-2026.json')));
const raw = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
const check = validateLayout(raw);
if (!check.ok) {
  console.error('✗ Ошибка в layout — экспорт отменён:\n' + check.errors.map((e) => '   ✗ ' + e).join('\n'));
  process.exit(1);
}
if ((raw.meta?.status || 'draft') !== 'approved' && !args.includes('--force')) {
  console.error(`✗ План в статусе "${raw.meta?.status || 'draft'}" (черновик) — клиенту отдавать нельзя.\n  Подтвердите в layout JSON: meta.status = "approved". Принудительно: --force`);
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
    console.log(`ℹ загрузка: ${path.relative(ROOT, p)} (${Object.keys(items).length} записей)`);
  }
}
const neutral = stateFile === null;   // --no-state: пустой зал

// ---------------------------------------------------------------- параметры
const blockFilter = typeof opt('block') === 'string' ? opt('block') : null;
const sectionFilter = typeof opt('section') === 'string' ? opt('section') : null;
const detail = !!sectionFilter || !!blockFilter;
const mapOnly = args.includes('--map') || detail;              // без таблицы разделов
const STATUS_STYLE = args.includes('--style=status') || process.env.STYLE === 'status';

const F = {
  title: 20, sub: 12, legend: 11.5, chipNum: 12.5, chipSec: 9.5, num: 14, area: 10,
  zone: 13.5, zoneNote: 11, feat: 13, featNote: 11, service: 13, serviceNote: 11,
  unitName: 18, unitMeta: 11.5, secName: 12, foot: 11.5,
};
const PAD = 24;
// Лист PDF — A4 landscape без полей: план масштабируется так, чтобы занять ширину листа
const SHEET = { w: 297, h: 210 };
const SHEET_RATIO = SHEET.w / SHEET.h;

const INK = '#243b4a';
const SUB = '#7b8b99';
const LINE = '#cbd6de';
const LINE_SOFT = '#e4eaf0';
const ZONE_FILL = '#f8fafc';
const ZONE_BORDER = '#dbe4ea';
const FEAT_FILL = '#eef2f6';
const FEAT_BORDER = '#c3ced8';

/** Чистый (как в плане-образце) стиль: белые ячейки, тонкие цветные рамки. */
const CLEAN = {
  free:     { fill: '#ffffff', bar: null,      ink: INK,       sub: SUB,       label: 'Свободно' },
  reserved: { fill: '#fff6e0', bar: '#e0a300', ink: '#8a5b00', sub: '#a08243', label: 'Забронировано' },
  sold:     { fill: '#fdecea', bar: '#c62828', ink: '#8e1b1b', sub: '#a86666', label: 'Продано' },
  blocked:  { fill: '#f1f4f6', bar: '#607d8b', ink: '#37474f', sub: '#7a8a94', label: 'Блокировано' },
};
/** Старая палитра (--style=status). */
const STATUS = {
  free:     { fill: '#eaf6ec', bar: '#2e7d32', ink: '#1b5e20', sub: '#4b7a51', label: 'Свободно' },
  reserved: { fill: '#fff3d6', bar: '#f59e0b', ink: '#8a5a00', sub: '#a08243', label: 'Забронировано' },
  sold:     { fill: '#c62828', bar: '#8e1b1b', ink: '#ffffff', sub: '#f2c9c9', label: 'Продано' },
  blocked:  { fill: '#eceff1', bar: '#607d8b', ink: '#37474f', sub: '#7a8a94', label: 'Блокировано' },
};
const tint = (k) => (STATUS_STYLE ? STATUS : CLEAN)[k] || (STATUS_STYLE ? STATUS : CLEAN).free;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const statusOf = (id) => items[id]?.status || 'free';
const fmtNum = (n) => Number(n || 0).toLocaleString('ru-RU').replace(/\u00A0/g, ' ');
const r2 = (v) => Number(v).toFixed(2);

/**
 * Подпись внутри рамки: подбираем размер шрифта так, чтобы САМОЕ ДЛИННОЕ слово
 * влезало по ширине, а число строк — по высоте. Многоточия не ставим никогда:
 * имя компании клиент должен прочитать полностью.
 */
function fitLabel(text, maxW, maxH, o = {}) {
  const maxFs = o.maxFs || 11;
  const minFs = o.minFs || 5.2;
  // делить слово на части будем только если оно не влезает даже мелким шрифтом
  const words = splitWords(text, o.chunk || 12, maxW, Math.min(minFs, 4.4), true);
  const wrapAt = (fs) => {
    const lines = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w;
      if (cur && textWidth(next, fs, true) > maxW) { lines.push(cur); cur = w; } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  for (let fs = maxFs; fs >= minFs; fs -= 0.2) {
    const widest = Math.max(...words.map((w) => textWidth(w, fs, true)), 1);
    if (widest > maxW) continue;
    const lines = wrapAt(fs);
    if (lines.length * fs * 1.18 <= maxH) return { lines, fs: Number(fs.toFixed(2)) };
  }
  const fs = Math.max(o.floor ?? 4.6, Math.min(minFs, maxW / Math.max(...words.map((w) => textWidth(w, 1, true)), 1)));
  return { lines: wrapAt(fs), fs: Number(fs.toFixed(2)) };
}

/**
 * Разбивает подпись на слова. Длинное слово («Derevenskoye», «Javohirlar») режем
 * на части ТОЛЬКО если оно не влезает в ячейку даже самым мелким шрифтом,
 * и переносим с дефисом — иначе получалось «Javohirl / ar» и клиент путался.
 */
function splitWords(text, chunk = 10, maxW = 0, minFs = 5.2, bold = true) {
  const out = [];
  for (const w of String(text).trim().split(/\s+/).filter(Boolean)) {
    if (!maxW || textWidth(w, minFs, bold) <= maxW || w.length <= chunk) { out.push(w); continue; }
    // делим слово на равные части, стараясь ставить дефис после гласной —
    // так читается как слог: «Dereven-skoye», а не «Derevensko-ye»
    const n = Math.ceil(w.length / chunk);
    const VOWEL = /[aeiouyаеёиоуыэюя]/i;
    const parts = [];
    let start = 0;
    for (let k = 0; k < n - 1; k++) {
      const target = Math.round(((k + 1) * w.length) / n);
      // оцениваем варианты переноса: «Dereven-skoye» лучше, чем «Dereve-nskoye»
      let best = null;
      for (let c = target - 3; c <= target + 3; c++) {
        if (c - start < 3 || w.length - c < 3) continue;
        const rest = w.slice(c);
        const onset = (rest.match(/^[^aeiouyаеёиоуыэюя]{2}/i) ? 2 : 0);   // стечение согласных в начале части
        const odd = (rest.match(/^[^aeiouyаеёиоуыэюя]{3,}/i) ? 1 : 0);    // три и больше — читается хуже
        const prevVowel = VOWEL.test(w[c - 1]) ? 1 : 0;
        const dist = Math.abs(c - target);
        const score = onset * 2 + prevVowel - odd * 2 - dist * 0.4;
        if (best == null || score > best.score) best = { c, score };
      }
      const cut = best ? best.c : target;
      parts.push(w.slice(start, cut));
      start = cut;
    }
    parts.push(w.slice(start));
    parts.forEach((part, i) => out.push(i < parts.length - 1 ? part + '-' : part));
  }
  return out;
}

/** Перенос строки по ширине (в пикселях). */
function wrapText(text, maxW, maxLines, fs, bold) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (cur && textWidth(next, fs, bold) > maxW) { lines.push(cur); cur = w; } else cur = next;
    if (lines.length >= maxLines && cur !== w) break;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines).map((l, i) => {
    if (i === lines.length - 1 && lines.slice(0, i + 1).join(' ').length < String(text).trim().length && textWidth(l + '…', fs, bold) > maxW) {
      let s = l; while (s.length > 1 && textWidth(s + '…', fs, bold) > maxW) s = s.slice(0, -1);
      return s + '…';
    }
    return l;
  });
}

// ---------------------------------------------------------------- область вывода
let blocks = exp.blocks;
let content;
if (sectionFilter) {
  const sec = sectionById(sectionFilter);
  if (!sec) { console.error(`✗ Раздел "${sectionFilter}" не найден. Есть: ${(exp.sections || []).map((s) => s.id).join(', ')}`); process.exit(1); }
  blocks = exp.blocks.filter((b) => b.section === sec.id);
  if (!blocks.length) { console.error(`✗ В разделе "${sectionFilter}" нет стендов`); process.exit(1); }
  const m = 3.5;
  const rects = blocks.map((b) => [b.x, b.y, b.x + b.w, b.y + b.h]);
  const x1 = Math.min(...rects.map((r) => r[0])), y1 = Math.min(...rects.map((r) => r[1]));
  const x2 = Math.max(...rects.map((r) => r[2])), y2 = Math.max(...rects.map((r) => r[3]));
  content = { x: x1 - m, y: y1 - m, w: x2 - x1 + m * 2, h: y2 - y1 + m * 2 };
} else if (blockFilter) {
  const b = exp.blocks.find((x) => x.id === blockFilter);
  if (!b) { console.error(`✗ Блок ${blockFilter} не найден. Есть: ${exp.blocks.map((x) => x.id).join(', ')}`); process.exit(1); }
  blocks = [b];
  const m = 2.5;
  content = { x: b.x - m, y: b.y - m, w: b.w + m * 2, h: b.h + m * 2 };
} else {
  // рамка с учётом выступов (чипы блоков уходят выше зала) — как раньше: chipTop
  const chipTop = Math.min(...blocks.filter((b) => b.kind !== 'custom').map((b) => b.y - 2.15), 0);
  // зона с вертикальной подписью слева (левое крыло A1–A6) — оставляем под неё поле
  const leftLabel = (exp.zones || []).some((z) => z.labelPos === 'left' && z.w && z.h && z.x < 2);
  const leftM = leftLabel ? 3 : 0;
  content = { x: -leftM, y: Math.min(0, chipTop - 0.3), w: exp.hall.width + leftM, h: exp.hall.height - Math.min(0, chipTop - 0.3) };
}

// ---------------------------------------------------------------- содержимое
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
const legendKeys = ['free', 'reserved', 'sold', 'blocked'].filter((k) => k !== 'blocked' || counts.blocked);

const extraUnits = neutral ? { stands: [], items: {} } : mergedAsStands(blocks);
const units = groupBookings([...allStands, ...extraUnits.stands], Object.assign({}, items, extraUnits.items));
const bookedIds = new Set(units.flatMap((u) => u.ids.filter((id) => !id.includes('~m'))));
const mergedDrawn = new Set(units.flatMap((u) => u.ids.filter((id) => id.includes('~m'))));

const title = sectionFilter ? (() => { const s = sectionById(sectionFilter); return `${s.label} · раздел ${s.id}`; })()
  : blockFilter ? `Блок ${blockFilter} · ${fmtNum(content.w - 5)} × ${fmtNum(content.h - 5)} м`
  : `${exp.meta.project} — ${exp.meta.hall} · план залов`;
const sub = `${exp.meta.pricePerM2 && !detail ? fmtNum(exp.meta.pricePerM2) + ' сум/м² · ' : ''}${ruleNote(exp)} · версия плана v${exp.meta.version || '?'} · ${new Date().toLocaleDateString('ru-RU')}`;

// ---------------------------------------------------------------- легенда (нужна для расчёта ширины листа)
const legendParts = legendKeys.map((k) => ({ k, text: `${tint(k).label}: ${counts[k]}` + (counts[k] ? ` · ${fmtNum(areas[k])} м²` : '') }));
const LEG_SW = 13, LEG_GAP = 22;
const legendTotal = legendParts.reduce((a, p) => a + LEG_SW + 6 + textWidth(p.text, F.legend) + LEG_GAP, 0) - LEG_GAP;

// ---------------------------------------------------------------- размер листа
const S0 = detail ? Number(opt('scale', 22)) : Number(opt('scale', 0)) || 0;
let SCALE = S0 || 14.5;
let S = (v) => v * SCALE;
let headerH = F.title + F.sub + 22;
let footerH = F.foot + 16;

let pageW, pageH, contentTop;
const sheetMode = mapOnly && !detail;   // лист под формат A4 landscape — только для плана всего зала
if (sheetMode) {
  // лист под соотношение A4 landscape: план занимает всю ширину, поля уходят в шапку/подвал
  for (let i = 0; i < 4; i++) {
    const availW = pageW ? pageW - PAD * 2 : 0;
    if (!availW) {                       // первая итерация: стартуем от ширины листа в «полезных» px
      SCALE = (1400 - PAD * 2) / content.w;
    } else {
      SCALE = Math.min((pageW - PAD * 2) / content.w, (pageH - headerH - footerH - PAD * 2) / content.h);
    }
    pageW = content.w * SCALE + PAD * 2;
    pageH = pageW / SHEET_RATIO;
  }
  const usedH = content.h * SCALE;
  contentTop = Math.max(headerH + PAD, (pageH - usedH) / 2 + 6);
} else if (detail) {
  // лист раздела/блока — обычный масштаб (22 px на метр), лист по содержимому
  // ширина листа учитывает заголовок и легенду, иначе текст уходил за край
  const needW = Math.max(content.w * SCALE, textWidth(title, F.title, true), textWidth(sub, F.sub), legendTotal);
  pageW = needW + PAD * 2;
  pageH = headerH + PAD * 2 + content.h * SCALE + footerH;
  contentTop = PAD + headerH;
} else {
  pageW = content.w * SCALE + PAD * 2;
  const secLineH = F.legend + 9;
  const sectionRows = (exp.sections || []).map((sec) => {
    const st = allStands.filter((x) => x.section === sec.id && !x.mergedCell);
    const mg = allStands.filter((x) => x.section === sec.id && x.mergedCell);
    if (!st.length && !mg.length) return null;
    const free = st.filter((x) => statusOf(x.id) === 'free');
    return { sec, n: st.length, merged: mg.length, area: [...st, ...mg].reduce((a, x) => a + x.areaM2, 0), free: free.length, freeArea: free.reduce((a, x) => a + x.areaM2, 0) };
  }).filter(Boolean);
  const legendRows = legendKeys.length ? 1 : 0;
  const tableH = sectionRows.length ? F.legend + 14 + sectionRows.length * secLineH : 0;
  pageH = headerH + PAD + content.h * SCALE + legendRows * (F.legend + 12) + tableH + footerH + PAD;
  contentTop = headerH + PAD - content.y * SCALE;
}
const pageWpx = Math.round(pageW);
const pageHpx = Math.round(pageH);
const ox = PAD - content.x * SCALE;
const oy = contentTop - content.y * SCALE;
const X = (m) => ox + m * SCALE;
const Y = (m) => oy + m * SCALE;
S = (v) => v * SCALE;

// ---------------------------------------------------------------- занятые области (для зон-подписей)
const occ = [];
const addOcc = (x, y, w, h) => occ.push({ x, y, w, h });
const freeAt = (x, y, w, h) => !occ.some((r) => Math.min(r.x + r.w, x + w) - Math.max(r.x, x) > 1 && Math.min(r.y + r.h, y + h) - Math.max(r.y, y) > 1);

const t = (x, y, size, fill, text, o = '') => `<text x="${r2(x)}" y="${r2(y)}" font-size="${r2(size)}" fill="${fill}"${o}>${esc(text)}</text>`;
const rect = (x, y, w, h, fill, o = '') => `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" fill="${fill}"${o}/>`;

const L = { bg: [], zones: [], hall: [], feat: [], blocks: [], stands: [], units: [], labels: [], header: [], footer: [] };

// ---------------------------------------------------------------- шапка
L.header.push(t(PAD, PAD + F.title - 4, F.title, '#0f2233', title, ' font-weight="bold"'));
L.header.push(t(PAD, PAD + F.title + F.sub + 4, F.sub, SUB, sub));

// легенда (справа, в одну строку; при нехватке места — во вторую)
{
  const titleW = textWidth(title, F.title, true);
  const rightRoom = pageWpx - PAD * 2 - titleW - 30;
  // строка, ниже которой НЕЛЬЗЯ опускаться: там подзаголовок
  const subBottom = PAD + F.title + F.sub + 12;
  let x = PAD, y = PAD + 2;
  if (legendTotal <= rightRoom) x = pageWpx - PAD - legendTotal;                       // справа, в строке заголовка
  else y = subBottom;                                                                  // отдельной строкой ниже подзаголовка
  for (const p of legendParts) {
    const w = LEG_SW + 6 + textWidth(p.text, F.legend);
    // переносим на следующую строку — но никогда на строку подзаголовка
    if (x > PAD && x + w > pageWpx - PAD) { y = Math.max(y + F.legend + 12, subBottom); x = PAD; }
    const cl = tint(p.k);
    L.header.push(rect(x, y, LEG_SW, LEG_SW, cl.fill, ` stroke="${cl.bar || LINE}" stroke-width="1.3" rx="3"`));
    L.header.push(t(x + LEG_SW + 6, y + LEG_SW - 2.5, F.legend, '#44586a', p.text));
    x += w + LEG_GAP;
  }
  // если легенда заняла строку подзаголовка — сам подзаголовок уходит ниже
  if (y >= subBottom) {
    L.header = L.header.filter((n) => !n.includes('>' + esc(sub) + '</text>'));
    L.header.splice(2, 0, t(PAD, y + F.legend + F.sub + 6, F.sub, SUB, sub));
  }
  if (y > PAD + 2) headerH = Math.max(headerH, y - PAD + F.legend + 12);
}

// ---------------------------------------------------------------- зоны
const zoneLabels = [];
if (!detail) {
  for (const z of exp.zones || []) {
    if (!z.w || !z.h) continue;
    L.zones.push(rect(X(z.x), Y(z.y), S(z.w), S(z.h), z.color || ZONE_FILL, ` fill-opacity="0.85" stroke="${ZONE_BORDER}" stroke-width="1" stroke-dasharray="8 6" rx="6"`));
    const pos = z.labelPos || 'none';
    if (pos !== 'none') zoneLabels.push({ z, pos, fs: Math.max(9, Math.min(F.zone, (S(z.w) - 20) / Math.max(4, textWidth(z.label, 1)))) });
  }
}

// ---------------------------------------------------------------- контур зала
{
  const outline = exp.hall.outline?.length >= 3
    ? exp.hall.outline.map((p) => `${r2(X(p[0]))},${r2(Y(p[1]))}`).join(' ')
    : `${r2(X(0))},${r2(Y(0))} ${r2(X(exp.hall.width))},${r2(Y(0))} ${r2(X(exp.hall.width))},${r2(Y(exp.hall.height))} ${r2(X(0))},${r2(Y(exp.hall.height))}`;
  L.hall.push(`<polygon points="${outline}" fill="#ffffff" fill-opacity="0.55" stroke="#0f2233" stroke-width="2.2"/>`);
}

// ---------------------------------------------------------------- объекты зала (сцена, двери, WC…)
if (!detail) {
  for (const f of exp.features || []) {
    const w = f.w ?? 2, h = f.h ?? 2;
    const px = X(f.x), py = Y(f.y), pw = S(w), ph = S(h);
    L.feat.push(rect(px, py, pw, ph, FEAT_FILL, ` stroke="${FEAT_BORDER}" stroke-width="1.1" rx="4"`));
    if (f.label) {
      // подпись внутрь прямоугольника: 1–2 строки, при нехватке — рядом (справа/снизу)
      const innerW = pw - 10, innerH = ph - 8;
      const maxLines = Math.max(1, Math.min(3, Math.floor(innerH / (9 * 1.2))));
      const noteTxt = String(f.note || '').trim();
      const noteFs = Math.max(9, Math.min(F.featNote, S(1) * 0.8));
      const noteH = noteTxt ? noteFs * 1.3 : 0;
      const fit = fitText(f.label, Math.max(innerW, 60), Math.max(10, innerH - noteH), { maxLines, minFs: 8.5, maxFs: F.feat + 2, bold: false });
      const lines = fit.lines.length ? fit.lines : [f.label];
      const noteW = noteTxt ? textWidth(noteTxt, noteFs) : 0;
      const inside = fit.lines.length && textWidth(lines[0], fit.fs) <= innerW
        && lines.length * fit.fs * 1.2 + noteH <= innerH
        && (!noteTxt || noteW <= innerW || ph > noteFs * 3.4);
      if (inside) {
        const lh = fit.fs * 1.18;
        const total = (lines.length - 1) * lh + noteH;
        const cy = py + ph / 2 - total / 2 + fit.fs * 0.35;
        lines.forEach((ln, i) => L.feat.push(t(px + pw / 2, cy + i * lh, fit.fs, '#5b6b7a', ln, ' text-anchor="middle"')));
        if (noteTxt) {
          const nl = wrapText(noteTxt, innerW, 2, noteFs, false);
          const fitsNote = nl.length && textWidth(nl[0], noteFs) <= innerW;
          if (fitsNote) {
            nl.forEach((ln, i) => L.feat.push(t(px + pw / 2, cy + (lines.length - 1) * lh + noteFs * (1.15 + i * 1.25), noteFs, '#93a4b2', ln, ' text-anchor="middle"')));
          }
        }
      } else {
        // не влезает — подпись под рамкой (короткая строка), рамка остаётся чистой
        const fs = Math.max(8, Math.min(F.feat, (pw + 90) / Math.max(4, textWidth(f.label, 1))));
        L.feat.push(t(px + pw / 2, py + ph + fs + 3, fs, '#5b6b7a', f.label, ' text-anchor="middle"'));
      }
      addOcc(px - 2, py - 2, pw + 4, ph + 4);
    }
  }
}

// ---------------------------------------------------------------- служебные зоны (регистрация, входы, залы…)
// Названия у этих зон длинные и в ячейку не влезают — поэтому подпись ставится РЯДОМ
// с рамкой (снизу или сверху), а внутри рамки — только короткая строка-измерение.
if (!detail) {
  const boxes = [];
  for (const sv of exp.service || []) {
    const w = sv.w ?? 2, h = sv.h ?? 2;
    boxes.push({ sv, px: X(sv.x), py: Y(sv.y), pw: S(w), ph: S(h) });
  }
  for (const b of boxes) {
    const { sv, px, py, pw, ph } = b;
    L.feat.push(rect(px, py, pw, ph, FEAT_FILL, ` stroke="${FEAT_BORDER}" stroke-width="1.1" rx="4"`));

    const note = String(sv.note || '').trim();
    const fsNote = Math.max(9, Math.min(F.serviceNote, S(1) * 0.78));
    // заголовок: мелкие буквы, но с запасом по ширине; при нехватке — переносим на 2 строки
    const innerW = pw - 8;
    const noteRoom = note ? fsNote * 1.6 : 0;
    const fit = fitText(sv.label, Math.max(innerW, 40), Math.max(12, ph - noteRoom), { maxLines: 2, minFs: 7.5, maxFs: F.service, bold: false });
    const fits = fit.lines.length > 0 && fit.lines.length <= 2
      && fit.lines.every((ln) => textWidth(ln, fit.fs) <= innerW)
      && fit.lines.length * fit.fs * 1.22 <= ph - noteRoom;

    if (fits) {
      // заголовок внутри рамки (до двух строк), измерение — под ним, если влезает
      const lh = fit.fs * 1.22;
      const blockH = (fit.lines.length - 1) * lh + noteRoom;
      const cy = py + ph / 2 - blockH / 2 + fit.fs * 0.36;
      fit.lines.forEach((ln, i) => L.feat.push(t(px + pw / 2, cy + i * lh, fit.fs, '#5b6b7a', ln, ' text-anchor="middle"')));
      const nl = note ? wrapText(note, innerW, 2, fsNote, false) : [];
      const fitsNote = nl.length && nl.every((ln) => textWidth(ln, fsNote) <= innerW)
        && ph - fit.fs * 1.2 >= fsNote * 1.35 * nl.length;
      if (fitsNote) {
        // измерение ставится под ПОСЛЕДНЕЙ строкой заголовка, а не под первой
        const baseY = cy + (fit.lines.length - 1) * lh;
        nl.forEach((ln, i) => L.feat.push(t(px + pw / 2, baseY + fsNote * (1.25 + i * 1.25), fsNote, '#9fb0bf', ln, ' text-anchor="middle"')));
      }
    } else {
      // подпись под рамкой, измерение — ниже (или над рамкой, если снизу нет места)
      const above = py + ph + F.service * 3 > pageHpx - PAD;
      const yLabel = above ? py - F.service * (note ? 2.2 : 1.5) : py + ph + F.service;
      L.feat.push(t(px + pw / 2, yLabel, F.service, '#5b6b7a', sv.label, ' text-anchor="middle"'));
      if (note) {
        const roomW = Math.max(pw + 40, 60);
        const nl2 = wrapText(note, roomW, 1, fsNote, false);
        if (nl2.length && textWidth(nl2[0], fsNote) <= roomW) {
          L.feat.push(t(px + pw / 2, yLabel + fsNote * 1.5, fsNote, '#9fb0bf', nl2[0], ' text-anchor="middle"'));
        }
      }
    }
    addOcc(px - 2, py - 2, pw + 4, ph + 4);
  }
}
// ---------------------------------------------------------------- стенды и блоки
/** Подпись стенда: A-01 → «A1», EQ-H-03 → «H3» (как на чертеже заказчика);
 *  чертёжные стенды (manual) подписаны как на самом чертеже — без префикса блока. */
const idText = (b, s) => {
  if (s.manual) return String(s.noLabel || s.no);
  const eq = /^EQ-([A-Z])$/.exec(b.id);
  if (eq) return `${eq[1]}${s.no}`;
  return b.label.includes('-') ? `${b.label.replace(/^(\w+)-(\d+)$/, '$1$2')}-${s.no}` : `${b.label}${s.no}`;
};

function drawStand(s, b, custom) {
  const key = statusOf(s.id);
  const cl = tint(key);
  const edge = custom ? (s.color || '#E8A33D') : LINE;
  const edgeW = custom ? 1.6 : 1.05;
  const parts = [rect(X(s.x), Y(s.y), S(s.w), S(s.h), cl.fill, ` stroke="${edge}" stroke-width="${edgeW}" rx="3"`)];
  const cx = X(s.x + s.w / 2);
  const buyer = neutral ? '' : String(items[s.id]?.buyer || '');
  if (custom) {
    const name = String(s.label || s.id);
    const fsN = Math.max(8.5, Math.min(15, (S(s.w) - 14) / Math.max(2, textWidth(name, 1, true)), S(s.h) / 3.4));
    const fsA = Math.max(8, fsN * 0.72);
    const cy = Y(s.y + s.h / 2);
    parts.push(t(cx, cy - fsN * 0.35, fsN, INK, name, ' font-weight="bold" text-anchor="middle"'));
    parts.push(t(cx, cy + fsN * 0.75, fsA, SUB, `${fmtNum(s.areaM2)} м²`, ' text-anchor="middle"'));
    if (buyer) {
      const fsB = Math.max(8, Math.min(fsA, (S(s.w) - 12) / Math.max(4, textWidth(buyer, 1, true))));
      parts.push(t(cx, cy + fsN * 0.75 + fsB + 3, fsB, cl.ink || INK, buyer, ' font-weight="bold" text-anchor="middle"'));
    }
  } else {
    const num = idText(b, s);
    const fsN = Math.max(8, Math.min(F.num, (S(s.w) - 8) / Math.max(2, textWidth(num, 1, true))));
    const cy = Y(s.y + s.h / 2);
    if (buyer) {
      const fitB = fitLabel(buyer, S(s.w) - 6, S(s.h) - 6, { maxFs: Math.min(10.5, S(s.h) / 2.4), minFs: 5.2 });
      const lh = fitB.fs * 1.16;
      const y0 = cy - (fitB.lines.length - 1) * lh / 2 + fitB.fs * 0.35;
      fitB.lines.forEach((ln, i) => parts.push(t(cx, y0 + i * lh, fitB.fs, cl.ink || INK, ln, ' font-weight="bold" text-anchor="middle"')));
    } else {
      parts.push(t(cx, cy - 1, fsN, edge === LINE ? (b.color || INK) : edge, num, ' font-weight="bold" text-anchor="middle"'));
      if (Math.abs(s.areaM2 - 9) > 0.01) parts.push(t(cx, cy + fsN * 0.95, F.area, SUB, `${fmtNum(s.areaM2)} м²`, ' text-anchor="middle"'));
    }
  }
  L.stands.push(parts.join(''));
  addOcc(X(s.x) - 1, Y(s.y) - 1, S(s.w) + 2, S(s.h) + 2);
}

for (const b of blocks) {
  if (b.kind !== 'custom') {
    const color = b.color || '#90a4b5';
    const sec = sectionById(b.section);
    const effArea = b.areaM2 + (b.merged || []).reduce((a, m) => a + m.w * m.h, 0);
    // рамка блока
    L.blocks.push(rect(X(b.x), Y(b.y), S(b.w), S(b.h), 'none', ` stroke="${color}" stroke-width="1.6" rx="5"`));
    addOcc(X(b.x) - 1, Y(b.y) - 1, S(b.w) + 2, S(b.h) + 2);
    // чип блока: 2 строки — «A · 72 м²» + название раздела
    {
      const line1 = `${b.label} · ${fmtNum(effArea)} м²`;
      const line2 = sec ? (sec.short || sec.label) : '';
      const chipW = Math.min(
        Math.max(S(b.w) + 6, textWidth(line1, F.chipNum, true) + 18, textWidth(line2, F.chipSec) + 18),
        Math.max(74, (mapOnly ? 8 : 9) * SCALE - 6),
      );
      const chipH = line2 ? F.chipNum + F.chipSec + 6 : F.chipNum + 7;
      const chipX = Math.min(Math.max(X(b.x + b.w / 2) - chipW / 2, 2), pageWpx - chipW - 2);
      const chipY = Y(b.y) - chipH - 2.5;
      L.blocks.push(rect(chipX, chipY, chipW, chipH, '#ffffff', ` stroke="${color}" stroke-width="1.5" rx="5"`));
      L.blocks.push(t(chipX + chipW / 2, chipY + F.chipNum + 0.5, F.chipNum, color, line1, ' font-weight="bold" text-anchor="middle"'));
      if (line2) L.blocks.push(t(chipX + chipW / 2, chipY + chipH - 5, F.chipSec, SUB, line2, ' text-anchor="middle"'));
      addOcc(chipX - 2, chipY - 2, chipW + 4, chipH + 4);
    }
    for (const s of b.stands) if (!bookedIds.has(s.id)) drawStand(s, b, false);
    for (const m of b.merged || []) {
      const idx = (b.merged || []).indexOf(m);
      if (mergedDrawn.has(`${b.id}~m${idx}`)) continue;
      const cl = tint(neutral ? 'free' : (m.status || 'free'));
      L.stands.push(rect(X(m.x), Y(m.y), S(m.w), S(m.h), cl.fill, ` stroke="${color}" stroke-width="1.3" rx="3"`));
      if (!neutral && m.label) {
        const fs = Math.max(8, Math.min(13, (S(m.w) - 12) / Math.max(3, textWidth(m.label, 1, true))));
        L.stands.push(t(X(m.x + m.w / 2), Y(m.y + m.h / 2) + fs * 0.35, fs, INK, m.label, ' font-weight="bold" text-anchor="middle"'));
      }
      addOcc(X(m.x) - 1, Y(m.y) - 1, S(m.w) + 2, S(m.h) + 2);
    }
  }
}
// нестандартные стенды (левое крыло A1–A6) — только своя рамка, без блока
for (const b of blocks) {
  if (b.kind !== 'custom') continue;
  for (const s of b.stands) if (!bookedIds.has(s.id)) drawStand(s, b, true);
}

// ---------------------------------------------------------------- брони: одна компания = одна рамка
for (const u of units) {
  const cl = tint(u.status || 'sold');
  const d = unionPath(u.stands.map((s) => ({ x: X(s.x), y: Y(s.y), w: S(s.w), h: S(s.h) })));
  L.units.push(`<path d="${d}" fill="${cl.fill}" fill-opacity="${STATUS_STYLE && u.status === 'sold' ? 1 : 0.92}" stroke="${cl.bar || '#c62828'}" stroke-width="1.8" stroke-linejoin="round"/>`);
  const boxes = largestRect(u.stands.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h })), 0.25);
  const boxX = X(boxes.x), boxY = Y(boxes.y), boxW = S(boxes.w), boxH = S(boxes.h);
  const onlyMerged = u.stands.every((st) => st.mergedCell);
  const metaTxt = onlyMerged
    ? `${fmtNum(u.areaM2)} м²`
    : u.stands.length > 1
      ? `${u.stands.length} стендов · ${fmtNum(u.areaM2)} м²`
      : (Math.abs(u.areaM2 - 9) > 0.01 ? `${fmtNum(u.areaM2)} м²` : '');
  const withMeta = !!metaTxt && boxH > 46 && boxW >= 62;
  const fitU = fitLabel(u.label || tint(u.status).label, boxW - 6, boxH - (withMeta ? 22 : 6), {
    maxFs: Math.min(F.unitName, boxH / 2.2), minFs: 5.4, chunk: boxW > 90 ? 12 : 10,
  });
  const lines = fitU.lines.length ? fitU.lines : [u.label || ''];
  const fs = fitU.fs;
  const cx = boxX + boxW / 2, cy = boxY + boxH / 2;
  if (cl.bar) L.units.push(rect(boxX + 1.5, boxY + 1.5, Math.max(0, boxW - 3), 3.5, cl.bar, ' rx="1.5"'));
  const lh = fs * 1.2;
  const shift = (lines.length * lh) / 2 + (withMeta ? 5 : 0);
  lines.forEach((ln, i) => L.units.push(t(cx, cy - shift + lh * (i + 0.82), fs, cl.ink, ln, ' font-weight="bold" text-anchor="middle"')));
  if (withMeta) {
    // подпись «2 стенда · 18 м²»: шрифт подбираем так, чтобы она влезала в рамку
    const mfs = Math.min(Math.max(8, fs * 0.58), (boxW - 8) / Math.max(1e-3, textWidth(metaTxt, 1)));
    if (mfs >= 6) L.units.push(t(cx, cy + shift + 2, mfs, cl.sub, metaTxt, ' text-anchor="middle"'));
  }
  addOcc(boxX - 1, boxY - 1, boxW + 2, boxH + 2);
}

// ---------------------------------------------------------------- подписи зон (последними, с проверкой пересечений)
for (const { z, pos, fs } of zoneLabels) {
  // вертикальная подпись вдоль левой стены (например «Левое крыло A1–A6»):
  // места сверху/внутри нет — пишем снаружи зала, текст читается снизу вверх
  if (pos === 'left') {
    if (X(z.x) < PAD || X(z.x) > pageWpx - PAD) continue;        // зона вне этого листа
    const lfs = Math.max(9, Math.min(F.zone, (S(z.h) - 20) / Math.max(4, textWidth(z.label, 1))));
    const lx = X(z.x) - S(1.2), ly = Y(z.y + z.h / 2);
    L.labels.push(`<text x="${r2(lx)}" y="${r2(ly)}" font-size="${r2(lfs)}" fill="#93a4b2" font-weight="bold" text-anchor="middle" letter-spacing="0.3" transform="rotate(-90 ${r2(lx)} ${r2(ly)})">${esc(z.label)}</text>`);
    addOcc(lx - lfs, ly - textWidth(z.label, lfs) / 2 - 2, lfs * 2, textWidth(z.label, lfs) + 4);
    continue;
  }
  const w = textWidth(z.label, fs);
  const h = fs * 1.25;
  const cx = X(z.x + z.w / 2);
  const ys = [];
  if (pos === 'above') for (let dy = 6; dy <= 46; dy += 8) ys.push(Y(z.y) - dy);
  else if (pos === 'bottom') { for (let y = Y(z.y + z.h) - h - 8; y > Y(z.y) + 4; y -= h + 2) ys.push(y); }
  else if (pos === 'inside-top') ys.push(Y(z.y) + 5);
  else { for (let y = Y(z.y) + 5; y < Y(z.y + z.h) - h; y += h + 2) ys.push(y); }
  ys.push(Y(z.y) - 6, Y(z.y + z.h) + h + 2);
  // по X тоже есть варианты: центр, справа, слева — лишь бы не пересекаться с чипами/рамками
  const xs = [cx, Math.min(X(z.x + z.w) - w / 2 - 4, pageWpx - PAD - w / 2), Math.max(X(z.x) + w / 2 + 4, PAD + w / 2)];
  const uniq = (a) => [...new Set(a.map((v) => Math.round(v * 10) / 10))];
  let place = null;
  for (const x of uniq(xs)) for (const y of ys) if (freeAt(x - w / 2, y, w, h)) { place = { x, y }; break; }
  if (!place) for (const x of uniq(xs)) for (const y of ys) if (freeAt(x - w / 2, y, w, h * 1.6)) { place = { x, y }; break; }
  place = place || { x: cx, y: ys[0] };
  L.labels.push(t(place.x, place.y + fs, fs, '#93a4b2', z.label, ' font-weight="bold" text-anchor="middle" letter-spacing="0.3"'));
  const znote = String(z.note || '').trim();
  if (znote) {
    const nfs = Math.max(9, Math.min(F.zoneNote, fs - 2.5));
    L.labels.push(t(place.x, place.y + fs + nfs * 1.9, nfs, '#bcc9d4', znote, ' text-anchor="middle"'));
  }
}

// ---------------------------------------------------------------- подвал
const totalStands = allStands.filter((s) => !s.mergedCell).length;
const totalMerged = allStands.length - totalStands;
const totalArea = allStands.reduce((a, s) => a + s.areaM2, 0);
const freeArea = allStands.filter((s) => (s.mergedCell ? s.status || 'free' : statusOf(s.id)) === 'free').reduce((a, s) => a + s.areaM2, 0);
const footerY = pageHpx - F.foot - 4;
const footText = `Итого: ${totalStands} стендов${totalMerged ? ` + ${totalMerged} объединённых` : ''} · ${fmtNum(totalArea)} м² · свободно: ${counts.free} (${fmtNum(freeArea)} м²)`;
if (sheetMode) {
  L.footer.push(t(pageWpx - PAD, footerY, F.foot, '#5b6b7a', footText, ' text-anchor="end"'));
  L.footer.push(t(PAD, footerY, F.foot, '#5b6b7a', `${exp.meta.project} · ${exp.meta.hall} · ${new Date().toLocaleDateString('ru-RU')}`));
} else {
  if (detail) {
    // на листе раздела (или блока) легенда уже в шапке — внизу три коротких строки,
    // все по левому краю: так они не могут наехать друг на друга
    L.footer.push(t(PAD, pageHpx - F.foot * 3 - 16, F.foot, '#5b6b7a', `${exp.meta.project} · ${exp.meta.hall}`));
    L.footer.push(t(PAD, pageHpx - F.foot * 2 - 10, F.foot, '#5b6b7a', footText));
    L.footer.push(t(PAD, pageHpx - F.foot - 4, F.foot, '#93a4b2', `${ruleNote(exp)} · версия плана v${exp.meta.version || '?'}`));
  } else {
  let ly = contentTop + content.h * SCALE + F.legend + 14;
  for (const k of legendKeys) {
    const cl = tint(k);
    L.footer.push(rect(PAD, ly - F.legend + 1, F.legend, F.legend, cl.fill, ` stroke="${cl.bar || LINE}" stroke-width="1.3" rx="3"`));
    L.footer.push(t(PAD + F.legend + 8, ly, F.legend, '#44586a', `${cl.label}: ${counts[k]} стендов · ${fmtNum(areas[k])} м²`));
    ly += F.legend + 12;
  }
  const sectionRows = (exp.sections || []).map((sec) => {
    const st = allStands.filter((x) => x.section === sec.id && !x.mergedCell);
    if (!st.length) return null;
    const free = st.filter((x) => statusOf(x.id) === 'free');
    return { sec, n: st.length, area: st.reduce((a, x) => a + x.areaM2, 0), free: free.length, freeArea: free.reduce((a, x) => a + x.areaM2, 0) };
  }).filter(Boolean);
  if (sectionRows.length) {
    ly += 6;
    L.footer.push(t(PAD, ly, F.legend + 1, '#0f2233', 'По разделам', ' font-weight="bold"'));
    ly += F.legend + 12;
    // вторая колонка начинается после самой длинной подписи раздела (иначе тексты наезжают)
    const colX = PAD + 8 + Math.max(...sectionRows.map((r) => textWidth(r.sec.label, F.legend))) + 24;
    for (const r of sectionRows) {
      L.footer.push(rect(PAD, ly - F.legend + 1, F.legend, F.legend, r.sec.color, ' rx="2"'));
      L.footer.push(t(PAD + F.legend + 8, ly, F.legend, '#44586a', r.sec.label));
      L.footer.push(t(colX, ly, F.legend, '#44586a', `${r.n} стендов · ${fmtNum(r.area)} м² · свободно: ${r.free} (${fmtNum(r.freeArea)} м²)`));
      ly += F.legend + 9;
    }
  }
  L.footer.push(t(pageWpx - PAD, pageHpx - 12, F.foot, '#5b6b7a', footText, ' text-anchor="end"'));
  }
}

// ---------------------------------------------------------------- сборка
const out = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${pageWpx}" height="${pageHpx}" viewBox="0 0 ${pageWpx} ${pageHpx}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif">`,
  rect(0, 0, pageWpx, pageHpx, '#ffffff'),
];
if ((raw.meta?.status || 'draft') !== 'approved') {
  out.push(rect(0, 0, pageWpx, 24, '#8e1b1b'));
  out.push(t(pageWpx / 2, 17, 12.5, '#ffffff', 'ЧЕРНОВИК — размеры не подтверждены, клиенту не отправлять', ' font-weight="bold" text-anchor="middle"'));
}
for (const k of ['bg', 'zones', 'hall', 'feat', 'blocks', 'stands', 'units', 'labels', 'header', 'footer']) out.push(...L[k]);
out.push('</svg>');

const baseName = path.basename(layoutPath).replace(/\.json$/, '');
const suffix = sectionFilter ? `-sec-${sectionFilter}` : blockFilter ? `-${blockFilter}` : '';
const outPath = path.resolve(ROOT, String(opt('out', `exports/${baseName}${suffix}.svg`)));
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out.join('\n'));
const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
console.log(`✓ ${path.relative(ROOT, outPath)} — ${pageWpx}×${pageHpx} px (${kb} КБ), ${totalStands} стендов${totalMerged ? ` + ${totalMerged} объединённых` : ''} · ${fmtNum(totalArea)} м²`);
