#!/usr/bin/env node
/**
 * Validator o'z ishini qilyaptimi?  node tools/test-validator.mjs
 * Har bir "buzilgan" layout xato bilan ushlanishi shart — aks holda skript yiqiladi.
 * Это регрессионный набор, который не даёт отправить клиенту ошибочную карту.
 */
import { validateLayout } from '../lib/layout.mjs';

const base = () => ({
  meta: { stand: { w: 3, h: 3, areaM2: 9 }, block: { stands: 8, areaM2: 72 }, minAisleM: 2, status: 'approved' },
  hall: { width: 60, height: 40 },
  features: [],
  blocks: [
    { id: 'A-01', x: 5, y: 5, cols: 4, rows: 2 },
    { id: 'A-02', x: 20, y: 5, cols: 4, rows: 2 },
    { id: 'A-03', x: 5, y: 15, cols: 4, rows: 2 },
  ],
});

const cases = [
  { name: 'корректный план проходит проверку', layout: base(), expect: 'ok' },
  { name: 'в блоке 6 стендов вместо 8', layout: { ...base(), blocks: [{ id: 'A-01', x: 5, y: 5, cols: 3, rows: 2 }] }, expect: /должно быть 8/ },
  { name: 'в блоке 10 стендов', layout: { ...base(), blocks: [{ id: 'A-01', x: 5, y: 5, cols: 5, rows: 2 }] }, expect: /должно быть 8/ },
  { name: 'стенд 3.5×3 м (не 9 м²)', layout: { ...base(), meta: { stand: { w: 3.5, h: 3, areaM2: 9 }, minAisleM: 2 } }, expect: /должно быть 9/ },
  { name: 'ручная раскладка: между стендами 0.5 м', layout: {
      ...base(),
      blocks: [{ id: 'A-01', x: 5, y: 5, stands: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ col: i % 4, row: Math.floor(i / 4), no: i + 1 })).map((c, i) => ({ ...c, row: c.row, col: c.col })) }],
    }, expect: 'ok' },
  { name: 'стенды блока оторваны (неверная раскладка)', layout: {
      ...base(),
      blocks: [{
        id: 'A-01', x: 5, y: 5,
        stands: [
          { col: 0, row: 0, no: 1 }, { col: 1, row: 0, no: 2 }, { col: 2, row: 0, no: 3 }, { col: 3, row: 0, no: 4 },
          { col: 0, row: 1, no: 5 }, { col: 1, row: 1, no: 6 }, { col: 2, row: 1, no: 7 },
          { col: 8, row: 5, no: 8 }, // sakrab ketgan — xaritada boshqa joyda chiqadi
        ],
      }],
    }, expect: /разрыв/ },
  { name: 'два блока наложены друг на друга', layout: { ...base(), blocks: [
      { id: 'A-01', x: 5, y: 5, cols: 4, rows: 2 },
      { id: 'A-02', x: 8, y: 5, cols: 4, rows: 2 },
    ] }, expect: /слиплись|Наложение/ },
  { name: 'проход 1 м (узкий) — предупреждение', layout: { ...base(), blocks: [
      { id: 'A-01', x: 5, y: 5, cols: 4, rows: 2 },
      { id: 'A-02', x: 18, y: 5, cols: 4, rows: 2 },
    ] }, expect: 'ok', expectWarn: /1\.00 м/ },
  { name: 'стенд заходит в колонну', layout: { ...base(), blocks: [{ id: 'A-01', x: 5, y: 5, cols: 4, rows: 2 }], features: [{ type: 'column', label: 'Ustun', x: 11, y: 5, w: 1.2, h: 1.2 }] }, expect: /заходит внутрь объекта/ },
  { name: 'стенд вне границы зала', layout: { ...base(), hall: { width: 20, height: 20, outline: [[0, 0], [20, 0], [20, 20], [0, 20]] }, blocks: [{ id: 'A-01', x: 18, y: 5, cols: 4, rows: 2 }] }, expect: /выходит за границу зала/ },
  { name: 'повторяющийся ID блока', layout: { ...base(), blocks: [
      { id: 'A-01', x: 5, y: 5, cols: 4, rows: 2 },
      { id: 'A-01', x: 20, y: 5, cols: 4, rows: 2 },
    ] }, expect: /повторяющийся ID блока/ },
  { name: 'площадь не 72 (meta.block.areaM2 = 90)', layout: { ...base(), meta: { stand: { w: 3, h: 3, areaM2: 9 }, block: { stands: 8, areaM2: 90 }, minAisleM: 2, status: 'approved' } }, expect: /должно быть 72/ },

  // --- возможности, добавленные под реальный чертёж ---
  { name: "нестандартный стенд: площадь совпадает с размерами (22.67 = 6 × 3.78)", layout: {
      ...base(), customStands: [{ id: 'A4', x: 1, y: 1, w: 6, h: 3.78, areaM2: 22.67 }],
    }, expect: 'ok' },
  { name: "нестандартный стенд: площадь не совпадает с размерами", layout: {
      ...base(), customStands: [{ id: 'A4', x: 1, y: 1, w: 6, h: 3.78, areaM2: 30 }],
    }, expect: /а по размерам получается/ },
  { name: 'группа из 12 стендов (108 м²) в строгом режиме — ошибка', layout: {
      ...base(), blocks: [{ id: 'A', x: 5, y: 5, cols: 2, rows: 6 }],
    }, expect: /должно быть 8/ },
  { name: 'группа 12 стендов при enforceBlockRule:false — только предупреждение', layout: {
      ...base(), meta: { ...base().meta, enforceBlockRule: false }, blocks: [{ id: 'A', x: 5, y: 5, cols: 2, rows: 6 }],
    }, expect: 'ok', expectWarn: /12 стендов/ },
  { name: 'стенд вышел за пределы зоны', layout: {
      ...base(),
      zones: [{ id: 'main', label: 'Основной зал', x: 0, y: 0, w: 20, h: 20 }],
      blocks: [{ id: 'A-01', x: 15, y: 15, cols: 2, rows: 4, zone: 'main' }],
    }, expect: /вне зоны/ },
  { name: 'статус «черновик» даёт предупреждение', layout: { ...base(), meta: { ...base().meta, status: 'draft' } }, expect: 'ok', expectWarn: /ЧЕРНОВИК/ },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const r = validateLayout(c.layout);
  const joined = r.errors.join(' | ');
  let ok;
  if (c.expect === 'ok') ok = r.ok;
  else ok = !r.ok && c.expect.test(joined);
  if (ok && c.expectWarn) ok = c.expectWarn.test(r.warnings.join(' | '));
  if (ok) { pass++; console.log(`✓ ${c.name}`); }
  else {
    fail++;
    console.log(`✗ ${c.name}\n   ожидалось: ${c.expect}\n   получено: ${r.ok ? "ОШИБКИ НЕТ (тест пройден зря!)" : joined}`);
  }
}
console.log(`\nпройдено: ${pass}, провалено: ${fail}.`);
process.exit(fail ? 1 : 0);
