#!/usr/bin/env node
/**
 * ПОЛНАЯ РАБОТА С РАЗМЕРАМИ ПЛАНА (аудит).
 *
 *   node tools/audit-layout.mjs [layout.json] [--md]
 *
 * Печатает (или выводит как markdown, --md) ВСЕ размеры плана:
 * зал, зоны, служебные помещения, блоки (позиция, размер, стенды, площадь,
 * проходы между рядами), нестандартные стенды, итоговые суммы и проверки:
 * площадь = ширина × высота, наложения, минимальные проходы, выход за зал.
 *
 * Зачем: чтобы сверить план с чертежом заказчика строчка за строчкой —
 * «все размеры должны быть точными». Любое расхождение видно сразу.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandLayout } from '../lib/layout.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const MD = args.includes('--md');
const layoutPath = path.resolve(ROOT, args.find((a) => !a.startsWith('--')) || process.env.LAYOUT || 'layout/foodera-2026.json');
const raw = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
const exp = expandLayout(raw);

const fmt = (n) => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replace(/\u00A0/g, ' ');
const L = [];
const row = (...cells) => L.push(MD ? '| ' + cells.join(' | ') + ' |' : cells.join('\t'));
const head = (...cells) => { row(...cells); if (MD) L.push('|' + cells.map(() => '---').join('|') + '|'); };
const h = (t) => L.push('', MD ? '## ' + t : '=== ' + t + ' ' + '='.repeat(Math.max(0, 50 - t.length)), '');
const p = (t) => L.push(t);

const items = raw.meta?.pricePerM2 ? `${fmt(raw.meta.pricePerM2)} сум/м²` : 'цена не указана';

p(`${raw.meta.project} — ${raw.meta.hall}`);
p(`Версия плана v${raw.meta.version} · статус ${raw.meta.status} · обновлён ${raw.meta.updatedAt} · ${items}`);

h('1. Зал');
head(MD ? 'Параметр' : 'param', MD ? 'Значение' : 'value');
row('Размер зала', `${fmt(exp.hall.width)} × ${fmt(exp.hall.height)} м`);
row('Площадь зала', `${fmt(exp.hall.width * exp.hall.height)} м²`);
row('Стенд (правило)', `${raw.meta.stand.w}×${raw.meta.stand.h} м = ${raw.meta.stand.areaM2} м²`);
row('Блок (правило)', `${raw.meta.block.stands} стендов = ${raw.meta.block.areaM2} м² (${raw.meta.block.cols}×${raw.meta.block.rows})`);
row('Мин. проход', `${raw.meta.minAisleM} м`);

h('2. Зоны');
head('Зона', 'X', 'Y', 'Ширина', 'Высота', 'Площадь');
for (const z of exp.zones) {
  row(`${z.label} (${z.id})`, fmt(z.x), fmt(z.y), fmt(z.w), fmt(z.h), fmt(z.w * z.h));
}

h('3. Служебные помещения и объекты');
head('Объект', 'Тип', 'X', 'Y', 'Ширина', 'Высота', 'Площадь', 'Примечание');
for (const f of raw.features || []) {
  row(f.label, f.type, fmt(f.x), fmt(f.y), fmt(f.w ?? 2), fmt(f.h ?? 2), fmt((f.w ?? 2) * (f.h ?? 2)), f.note || '');
}
for (const s of exp.service || []) {
  row(s.label, 'service', fmt(s.x), fmt(s.y), fmt(s.w), fmt(s.h), fmt(s.w * s.h), s.note || '');
}

h('4. Блоки стендов');
head('Блок', 'Раздел', 'X', 'Y', 'Шир.', 'Выс.', 'Стендов', 'Площадь', 'Объед. ячейки');
let gridStands = 0, gridArea = 0;
for (const b of exp.blocks.filter((x) => x.kind === 'grid')) {
  gridStands += b.stands.length; gridArea += b.areaM2;
  row(`${b.label} (${b.id})`, b.section || '—', fmt(b.x), fmt(b.y), fmt(b.w), fmt(b.h),
    String(b.stands.length), `${fmt(b.areaM2)}${b.merged.length ? ` + ${fmt(b.mergedAreaM2)}` : ''}`,
    b.merged.length ? b.merged.map((m) => `${fmt(m.w)}×${fmt(m.h)}=${fmt(m.w * m.h)} м²${m.label ? ` «${m.label}»` : ''}`).join('; ') : '—');
}
p('');
p(`Итого по блокам: ${gridStands} стендов · ${fmt(gridArea)} м² (+ объединённые ячейки: ${fmt(exp.blocks.reduce((a, b) => a + (b.mergedAreaM2 || 0), 0))} м²)`);

h('5. Нестандартные стенды (левое крыло)');
head('ID', 'X', 'Y', 'Ширина', 'Высота', 'Площадь (заявленная)', 'Площадь (X×Y)', 'Расхождение');
for (const s of exp.customStands) {
  const geom = s.w * s.h;
  row(`${s.id}`, fmt(s.x), fmt(s.y), fmt(s.w), fmt(s.h), fmt(s.areaM2), fmt(geom), (Math.abs(geom - s.areaM2) > 0.01 ? '⚠ ' + fmt(geom - s.areaM2) : 'ок'));
}
p('');
p(`Итого крыло: ${exp.customStands.length} стендов · ${fmt(exp.customStands.reduce((a, s) => a + s.areaM2, 0))} м²`);

h('6. Проходы между рядами блоков (сверху вниз, по горизонтальной оси)');
{
  const rows = [];
  for (const b of exp.blocks.filter((x) => x.kind === 'grid')) {
    const found = rows.find((r) => Math.abs(r.y - b.y) < 1.5);
    if (found) { found.maxX2 = Math.max(found.maxX2, b.x + b.w); found.minX = Math.min(found.minX, b.x); }
    else rows.push({ y: b.y, h: b.h, minX: b.x, maxX2: b.x + b.w });
  }
  rows.sort((a, b) => a.y - b.y);
  head('Ряд (Y)', 'Высота ряда', 'Промежуток до следующего ряда');
  for (let i = 0; i < rows.length; i++) {
    const gap = i + 1 < rows.length ? fmt(rows[i + 1].y - (rows[i].y + rows[i].h)) : '—';
    row(`${fmt(rows[i].y)}..${fmt(rows[i].y + rows[i].h)}`, fmt(rows[i].h), gap);
  }
  const minAisle = raw.meta.minAisleM;
  for (let i = 0; i + 1 < rows.length; i++) {
    const gap = rows[i + 1].y - (rows[i].y + rows[i].h);
    if (gap < minAisle) p(`⚠ Проход ${fmt(gap)} м меньше минимального (${minAisle} м) между рядами ${fmt(rows[i].y)} и ${fmt(rows[i + 1].y)}`);
  }
}

h('7. Итоги и проверки');
{
  const total = exp.stands.length;
  const area = exp.stands.reduce((a, s) => a + s.areaM2, 0);
  const merged = exp.blocks.reduce((a, b) => a + (b.mergedAreaM2 || 0), 0);
  head('Параметр', 'Значение');
  row('Всего стендов', `${total} (${exp.blocks.filter((b) => b.kind === 'grid').reduce((a, b) => a + b.stands.length, 0)} в блоках + ${exp.customStands.length} нестандартных)`);
  row('Всего площадь по стендам', `${fmt(area)} м²`);
  row('Объединённые ячейки', `${fmt(merged)} м²`);
  row('Занятость зала', `${fmt((area + merged) / (exp.hall.width * exp.hall.height) * 100)} % площади зала`);

  // вне границы зала / наложения фич
  let out = 0;
  for (const s of exp.stands) {
    if (s.x < -0.01 || s.y < -0.01 || s.x + s.w > exp.hall.width + 0.01 || s.y + s.h > exp.hall.height + 0.01) out++;
  }
  row('Стенды вне зала', out ? `⚠ ${out}` : '0');
  const feats = [...(raw.features || []), ...(raw.service || [])];
  let overlap = 0;
  for (let i = 0; i < feats.length; i++) for (let j = i + 1; j < feats.length; j++) {
    const a = feats[i], b = feats[j];
    const aw = a.w ?? 2, ah = a.h ?? 2, bw = b.w ?? 2, bh = b.h ?? 2;
    if (Math.min(a.x + aw, b.x + bw) - Math.max(a.x, b.x) > 0.05 && Math.min(a.y + ah, b.y + bh) - Math.max(a.y, b.y) > 0.05) {
      overlap++; p(`⚠ Объекты «${a.label}» и «${b.label}» пересекаются`);
    }
  }
  row('Пересечения служебных объектов', overlap ? `⚠ ${overlap}` : '0');
}

const out = L.join('\n') + '\n';
if (MD) fs.writeFileSync(path.join(ROOT, 'docs/RAZMERLAR-FOODERA.md'), '# FOODERA 2026 — все размеры плана (аудит)\n\n' + out);
else process.stdout.write(out);
