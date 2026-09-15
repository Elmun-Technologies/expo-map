#!/usr/bin/env node
/**
 * Преобразует существующий список (Excel/CSV) в JSON-схему.
 * Координаты вручную писать не нужно — достаточно точки привязки блока + числа колонок/строк.
 *
 * 1) Таблица блоков (рекомендуется):
 *    blok,x,y,колонок,строк,группа,примечание
 *    A,12,6.4,2,4,Ряд 1,
 *    B,20,6.4,2,4,Ряд 1,рядом со сценой
 *
 *    node tools/import-csv.mjs blocks.csv --hall "Крытый павильон" --width 96 --height 50 --out layout/foodera-2026.json
 *
 * 2) Отдельные стенды (нестандартная форма):
 *    stend,blok,x,y
 *    A-01,A,12,6.4
 *    node tools/import-csv.mjs stands.csv --mode stands --out layout/foodera-2026.json
 *
 * Названия колонок могут быть на русском или английском. Разделитель , или ; определяется автоматически.
 * Файл сохранять из Excel как «CSV UTF-8».
 */
import fs from 'node:fs';
import path from 'node:path';
import { validateLayout } from '../lib/layout.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  if (i === -1) return def;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const file = args.find((a) => !a.startsWith('--') && !['blocks', 'stands', 'hall', 'width', 'height', 'out', 'mode', 'project', 'version', 'stand', 'price', 'min-aisle', 'ttl'].includes(a));
if (!file) {
  console.error('Использование: node tools/import-csv.mjs <файл.csv> [--mode blocks|stands] [--out layout/hall-A.json]');
  process.exit(2);
}

// ---------------------------------------------------------------- CSV o'qish
const raw = fs.readFileSync(path.resolve(file), 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
const splitRow = (line) => {
  const cells = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === delim && !inQ) { cells.push(cur); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
};
const [header, ...rows] = lines.map(splitRow);
const ALIAS = {
  id: ['blok', 'block', 'id', 'blok_id', 'block_id'],
  standId: ['stend', 'стенд', 'stand', 'stend_id', 'stand_id', 'kod', 'код'],
  x: ['x', 'chap', 'left', 'слева'],
  y: ['y', 'tepa', 'top', 'сверху'],
  cols: ['ustunlar', 'ustun', 'cols', 'columns', 'kolonkalar', 'колонок', 'столбцов'],
  rows: ['qatorlar', 'qator', 'rows', 'строк', 'рядов'],
  group: ['guruh', 'group', 'zona', 'zone', 'группа', 'зона'],
  note: ['izoh', 'note', 'eslatma', 'comment', 'примечание'],
  label: ['nom', 'label', 'nomi', 'название'],
};
const col = {};
header.forEach((h, i) => {
  const key = h.toLowerCase().replace(/\s+/g, '');
  for (const [field, names] of Object.entries(ALIAS)) if (names.includes(key)) col[field] = i;
});
const need = (f) => {
  if (col[f] == null) { console.error(`✗ в CSV нет колонки «${f}». Заголовок: ${header.join(' | ')}`); process.exit(1); }
};
const get = (r, f) => (col[f] == null ? '' : r[col[f]] ?? '');
const N = (v, f, row) => {
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) { console.error(`✗ ${f} — не число: "${v}" (строка: ${row.join(' | ')})`); process.exit(1); }
  return n;
};

const mode = opt('mode', 'blocks') === 'stands' ? 'stands' : 'blocks';
const stand = String(opt('stand', '3x3')).split('x').map(Number);
const [sw, sh] = [stand[0] || 3, stand[1] || 3];

const blocks = [];
if (mode === 'blocks') {
  need('id'); need('x'); need('y'); need('cols'); need('rows');
  const byId = new Map();
  rows.forEach((r) => {
    const id = get(r, 'id');
    if (!id) return;
    const b = {
      id,
      label: get(r, 'label') || id,
      x: N(get(r, 'x'), 'x', r),
      y: N(get(r, 'y'), 'y', r),
      cols: N(get(r, 'cols'), 'колонок', r),
      rows: N(get(r, 'rows'), 'строк', r),
    };
    if (get(r, 'group')) b.group = get(r, 'group');
    if (get(r, 'note')) b.note = get(r, 'note');
    if (byId.has(id)) { console.error(`✗ блок ${id} встречается в CSV дважды`); process.exit(1); }
    byId.set(id, b);
    blocks.push(b);
  });
} else {
  need('standId'); need('x'); need('y');
  const byBlock = new Map();
  rows.forEach((r) => {
    const sid = get(r, 'standId');
    if (!sid) return;
    const blok = get(r, 'id') || sid.replace(/-\d+$/, '');
    if (!byBlock.has(blok)) { byBlock.set(blok, { id: blok, label: blok, x: Infinity, y: Infinity, stands: [] }); blocks.push(byBlock.get(blok)); }
    const b = byBlock.get(blok);
    const x = N(get(r, 'x'), 'x', r), y = N(get(r, 'y'), 'y', r);
    b.x = Math.min(b.x, x); b.y = Math.min(b.y, y);
    b.stands.push({ col: null, row: null, x, y, no: b.stands.length + 1, rawId: sid });
    if (get(r, 'note')) b.note = get(r, 'note');
  });
  // koordinatalarni blok ichida ustun/qatorga aylantiramiz
  for (const b of blocks) {
    if (b.x === Infinity) { b.x = 0; b.y = 0; }
    for (const s of b.stands) {
      s.col = Math.round((s.x - b.x) / sw);
      s.row = Math.round((s.y - b.y) / sh);
    }
  }
}

const layout = {
  schemaVersion: 1,
  meta: {
    project: String(opt('project', 'Ekspo Markazi')),
    hall: String(opt('hall', 'Крытый павильон')),
    version: String(opt('version', '1.0.0')),
    updatedAt: new Date().toISOString().slice(0, 10),
    units: 'meters',
    stand: { w: sw, h: sh, areaM2: sw * sh },
    block: { stands: 8, areaM2: 72 },
    minAisleM: Number(opt('min-aisle', 2)),
    pricePerM2: Number(opt('price', 0)) || 0,
    reserveTtlHours: Number(opt('ttl', 72)),
    source: path.basename(file),
  },
  hall: { width: Number(opt('width', 40)), height: Number(opt('height', 30)) },
  features: [],
  blocks,
};

const outPath = path.resolve(String(opt('out', 'layout/imported.json')));
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(layout, null, 2));

const check = validateLayout(layout);
console.log(`✓ записан ${path.relative(process.cwd(), outPath)}: блоков ${blocks.length}`);
console.log(check.stats ? `  ${check.stats.stands} стендов · ${check.stats.totalAreaM2} м²` : '');
for (const w of check.warnings) console.log('  ⚠ ' + w);
for (const e of check.errors) console.log('  ✗ ' + e);
if (!check.ok) {
  console.log('\n✗ Схема не прошла проверку — исправьте ошибки (координаты, число колонок/строк) и повторите.');
  process.exit(1);
}
console.log('\n✓ Схема проверена. Дальше: node tools/validate-layout.mjs ' + path.relative(process.cwd(), outPath));
