#!/usr/bin/env node
/**
 * ПАКЕТ ДЛЯ КЛИЕНТА (все файлы одной командой).
 *
 *   node tools/package.mjs                        # LAYOUT=layout/foodera-2026.json
 *   node tools/package.mjs --layout layout/hall-A.json --out exports/drugoe
 *
 * Что получается (в exports/<имя>/):
 *   01-план-зала-весь.svg/.pdf     — весь зал: разделы, брони и продажи
 *   02-план-свободные-места.svg/.pdf — только свободные места (для продавца/каталога)
 *   03-раздел-<ID>-<название>.svg  — каждый раздел отдельным листом
 *   04-компании.csv                — занятые места (для Excel)
 *   05-свободные-места.csv         — свободные места с ценой
 *   00-ПОЯСНЕНИЕ.txt               — версия, дата, правила, как читать план
 *
 * Правила: layout обязан пройти валидатор; ЧЕРНОВИК пакет не собирается.
 * Все тексты и заголовки — на русском языке.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expandLayout, validateLayout } from '../lib/layout.mjs';
import { groupBookings, mergedAsStands } from '../lib/groups.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  if (i === -1) return def;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const layoutPath = path.resolve(ROOT, String(opt('layout', process.env.LAYOUT || 'layout/foodera-2026.json')));
const raw = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
const check = validateLayout(raw);
if (!check.ok) {
  console.error('✗ Ошибка в layout — пакет не собран:\n' + check.errors.map((e) => '   ✗ ' + e).join('\n'));
  process.exit(1);
}
if ((raw.meta?.status || 'draft') !== 'approved') {
  console.error('✗ План в статусе ЧЕРНОВИК (meta.status != "approved") — клиентский пакет собирать нельзя.');
  process.exit(1);
}
const exp = expandLayout(raw);
const slug = (s) => String(s).toLowerCase().replace(/[^a-zа-я0-9ё]+/gi, '-').replace(/^-|-$/g, '').slice(0, 28);
const baseName = path.basename(layoutPath).replace(/\.json$/, '');
const outDir = path.resolve(ROOT, String(opt('out', `exports/${baseName}`)));
fs.mkdirSync(outDir, { recursive: true });
// убираем старые листы разделов (если название раздела изменилось)
for (const f of fs.readdirSync(outDir)) {
  if (/^03-раздел-.*\.svg$/.test(f) || /^03-bolim-.*\.svg$/.test(f)) fs.rmSync(path.join(outDir, f));
}

const stateFile = path.join(ROOT, 'data/state.json');
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { items: {} };
const items = state.items || {};
const statusOf = (id) => items[id]?.status || 'free';
const fmtNum = (n) => Number(n || 0).toLocaleString('ru-RU');

const run = (argsList) => {
  try {
    const out = execFileSync('node', [path.join(ROOT, 'tools/export-svg.mjs'), '--layout', layoutPath, ...argsList], { cwd: ROOT, encoding: 'utf8' });
    return out.trim().split('\n').pop();
  } catch (e) {
    console.error('✗ ошибка экспорта:', e.message);
    return null;
  }
};

console.log(`\n📦 Пакет: ${raw.meta.project} · ${raw.meta.hall} — v${raw.meta.version}\n`);
const made = [];

// 1) весь зал  ·  2) только свободные места
const f1 = path.join(outDir, '01-план-зала-весь.svg');
const f2 = path.join(outDir, '02-план-свободные-места.svg');
if (run(['--out', f1])) made.push(f1);
if (run(['--no-state', '--out', f2])) made.push(f2);

// 1б) PDF — ТОЛЬКО ОСНОВНОЙ ПЛАН, один лист A4 landscape (формат из layout.meta.format).
// «Печать → Сохранить как PDF» в браузере режет на несколько листов; этот файл можно
// отправлять клиенту напрямую.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-pdf-'));
for (const item of [
  { svg: f1, name: '01-план-зала-весь.pdf', extra: [] },
  { svg: f2, name: '02-план-свободные-места.pdf', extra: ['--no-state'] },
]) {
  const mapSvg = path.join(tmpDir, item.name.replace(/\.pdf$/, '.svg'));
  const pdfOut = path.join(outDir, item.name);
  if (!run(['--map', ...item.extra, '--out', mapSvg])) continue;
  try {
    const line = execFileSync('python3',
      [path.join(ROOT, 'tools/export-pdf.py'), mapSvg, pdfOut, '--margin', '0',
        '--page', String(raw.meta.format || 'A4'), '--title', `${raw.meta.project} — ${raw.meta.hall}`],
      { cwd: ROOT, encoding: 'utf8' });
    console.log('  ' + line.trim());
    made.push(pdfOut);
    // превью (PNG) делаем из того же листа, что ушёл в PDF — картинка всегда актуальна
    if (item.name.startsWith('01')) {
      const png = path.join(outDir, '00-превью-плана.png');
      const pngLine = execFileSync('node', [path.join(ROOT, 'tools/svg2png.mjs'), mapSvg, png, '2860'],
        { cwd: ROOT, encoding: 'utf8' });
      console.log('  ' + pngLine.trim());
      made.push(png);
    }
  } catch (e) {
    console.error('⚠ PDF не собран (нужны python3 + reportlab + svglib):', String(e.message).split('\n')[0]);
  }
}
fs.rmSync(tmpDir, { recursive: true, force: true });

// 3) каждый раздел — отдельным листом
for (const sec of exp.sections || []) {
  const mine = exp.stands.filter((s) => s.section === sec.id);
  if (!mine.length) continue;
  const f = path.join(outDir, `03-раздел-${sec.id}-${slug(sec.short || sec.label)}.svg`);
  if (run(['--section', sec.id, '--out', f])) made.push(f);
}

// 4) компании — ОДНА компания = ОДНА строка (сколько бы стендов она ни заняла)
const rows = [['Раздел', 'Компания', 'Клиент', 'Телефон', 'Статус', 'Стендов', 'м2', 'Сумма', 'ID стендов', 'Продавец', 'Обновлено']];
const extra = mergedAsStands(exp.blocks);
const units = groupBookings([...exp.stands, ...extra.stands], Object.assign({}, items, extra.items))
  .sort((a, b) => (a.section || '').localeCompare(b.section || '') || b.areaM2 - a.areaM2);
for (const u of units) {
  const sec = (exp.sections || []).find((x) => x.id === u.section);
  const first = items[u.ids[0]] || {};
  const sum = u.ids.reduce((a, id) => a + (Number(items[id]?.amount) || 0), 0);
  rows.push([sec ? sec.label : '', u.company || u.buyer || '', u.buyer || '', u.phone || '',
    { sold: 'Продано', reserved: 'Бронь', blocked: 'Блокировано' }[u.status] || u.status,
    String(u.stands.length), String(u.areaM2), String(sum || ''), u.ids.join(', '), first.sellerName || '', first.updatedAt || '']);
}
const csv = '\uFEFF' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
const f4 = path.join(outDir, '04-компании.csv');
fs.writeFileSync(f4, csv);
made.push(f4);

// 4б) свободные места (для продавца)
const price = Number(raw.meta.pricePerM2 || 0);
const freeRows = [price ? ['Раздел', 'Блок', 'Стенд', 'м2', 'Цена, сум'] : ['Раздел', 'Блок', 'Стенд', 'м2']];
for (const s of exp.stands) {
  if (statusOf(s.id) !== 'free') continue;
  const sec = (exp.sections || []).find((x) => x.id === s.section);
  const row = [sec ? sec.label : '', s.blockId, s.id, String(s.areaM2)];
  if (price) row.push(String(Math.round(s.areaM2 * price)));
  freeRows.push(row);
}
const f4b = path.join(outDir, '05-свободные-места.csv');
fs.writeFileSync(f4b, '\uFEFF' + freeRows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n'));
made.push(f4b);

// 5) пояснение
const secTable = (exp.sections || []).map((sec) => {
  const st = exp.stands.filter((s) => s.section === sec.id);
  if (!st.length) return null;
  const free = st.filter((s) => statusOf(s.id) === 'free');
  const area = st.reduce((a, x) => a + x.areaM2, 0);
  const freeArea = free.reduce((a, x) => a + x.areaM2, 0);
  return `  ${sec.label.padEnd(34)} ${String(st.length).padStart(3)} стендов · ${String(area.toFixed(0)).padStart(7)} м² · свободно: ${String(free.length).padStart(3)} (${freeArea.toFixed(2)} м²)`;
}).filter(Boolean).join('\n');
const totalStands = exp.stands.length;
const totalArea = exp.stands.reduce((a, s) => a + s.areaM2, 0);
const freeStands = exp.stands.filter((s) => statusOf(s.id) === 'free');
const freeArea = freeStands.reduce((a, s) => a + s.areaM2, 0);
const izoh = `${raw.meta.project} — ${raw.meta.hall}
План залов · версия ${raw.meta.version} · ${new Date().toLocaleDateString('ru-RU')}
Источник: ${path.relative(ROOT, layoutPath)} (при изменении пакет пересобирается)

ПРАВИЛА
  1 стенд = 3×3 м = 9 м²
  1 блок  = 8 стендов = 72 м²
  У каждого стенда свой ID (например A-01, K-07, EQ-H-03). И в договоре, и на плане
  используется один и тот же ID — никаких «место посередине».

ОБЩЕЕ
  Всего: ${totalStands} стендов · ${totalArea.toFixed(2)} м²
  Свободно: ${freeStands.length} стендов · ${freeArea.toFixed(2)} м²
  Цена: ${raw.meta.pricePerM2 ? raw.meta.pricePerM2.toLocaleString('ru-RU') + ' сум/м²' : 'пока не указана (суммы в документах не считаются)'}

РАЗДЕЛЫ
${secTable}

ФАЙЛЫ
  01-план-зала-весь.svg/.pdf   весь зал: разделы, брони и продажи (клиенту и руководству)
  02-план-свободные-места.*    только свободные места (продавцу, для каталога)
  03-раздел-*.svg              каждый раздел отдельным листом (клиенту — только его раздел)
  04-компании.csv              занятые места: компания, ID стендов, сумма, продавец
  05-свободные-места.csv       свободные места (с ценой, если цена задана)
  00-ПОЯСНЕНИЕ.txt             этот файл

ЦВЕТА (в плане)
  Белый   — свободно (готово к продаже)
  Жёлтый  — забронировано (по истечении срока снимается автоматически)
  Красный — продано
  Серый   — блокировано (техническое или для владельца)

ВАЖНО: PDF-файлы — это ОДИН лист A4 landscape (печатать «Сохранить как PDF» из браузера
не нужно — он может разрезать план на несколько листов). SVG открывается в браузере и
остаётся редактируемым векторным файлом. План строится из layout-файла автоматически,
поэтому план и данные никогда не расходятся.
`;
const f5 = path.join(outDir, '00-ПОЯСНЕНИЕ.txt');
fs.writeFileSync(f5, izoh);
made.push(f5);
// старый файл с узбекским названием — убираем, чтобы не путал
for (const old of ['00-IZOH.txt', '04-kompaniyalar.csv', '05-bosh-joylar.csv', '01-xarita-butun-zal.svg', '02-xarita-bosh-joylar.svg',
  '01-xarita-butun-zal.pdf', '02-xarita-bosh-joylar.pdf']) {
  const p = path.join(outDir, old);
  if (fs.existsSync(p)) fs.rmSync(p);
}

// ---- проверка чистоты: ни одна подпись не должна наезжать на другую
{
  const { spawnSync } = await import('node:child_process');
  const checker = path.join(ROOT, 'tools/check-overlaps.mjs');
  let bad = 0;
  for (const f of made.filter((x) => x.endsWith('.svg'))) {
    const r = spawnSync('node', [checker, f], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) { bad++; process.stdout.write(r.stdout || ''); }
  }
  console.log(bad ? `\n⚠ Наложения подписей: ${bad} файл(ов) — см. выше` : '\n✓ Проверка чистоты: наложений подписей нет');

  // ---- вторая проверка: каждая подпись помещается в свою ячейку (не «упирается» в рамку)
  const fit = path.join(ROOT, 'tools/check-fit.mjs');
  let tight = 0;
  for (const f of made.filter((x) => x.endsWith('.svg'))) {
    const r = spawnSync('node', [fit, f], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) { tight++; process.stdout.write(r.stdout || ''); }
  }
  console.log(tight ? `\n⚠ Подписи не помещаются в ячейки: ${tight} файл(ов)` : '✓ Проверка чистоты: все подписи помещаются в ячейки');
}

console.log('\nФайлы:');
for (const f of made) console.log(`  ${path.relative(ROOT, f)}`);
console.log(`\n✓ Пакет готов: ${path.relative(ROOT, outDir)} (${made.length} файлов)\n`);
