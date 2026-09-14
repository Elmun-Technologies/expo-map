#!/usr/bin/env node
/**
 * Validator o'z ishini qilyaptimi?  node tools/test-validator.mjs
 * Har bir "buzilgan" layout xato bilan ushlanishi shart — aks holda skript yiqiladi.
 * Bu — mijozga noto'g'ri xarita ketib qolishining oldini oluvchi regressiya to'plami.
 */
import { validateLayout } from '../lib/layout.mjs';

const base = () => ({
  meta: { stand: { w: 3, h: 3, areaM2: 9 }, block: { stands: 8, areaM2: 72 }, minAisleM: 2 },
  hall: { width: 60, height: 40 },
  features: [],
  blocks: [
    { id: 'A-01', x: 5, y: 5, cols: 4, rows: 2 },
    { id: 'A-02', x: 20, y: 5, cols: 4, rows: 2 },
    { id: 'A-03', x: 5, y: 15, cols: 4, rows: 2 },
  ],
});

const cases = [
  { name: 'toza layout o\'tishi kerak', layout: base(), expect: 'ok' },
  { name: 'blokda 6 ta stend (8 emas)', layout: { ...base(), blocks: [{ id: 'A-01', x: 5, y: 5, cols: 3, rows: 2 }] }, expect: /aynan 8 ta/ },
  { name: 'blokda 10 ta stend', layout: { ...base(), blocks: [{ id: 'A-01', x: 5, y: 5, cols: 5, rows: 2 }] }, expect: /aynan 8 ta/ },
  { name: 'stend 3.5×3 m (9 m² emas)', layout: { ...base(), meta: { stand: { w: 3.5, h: 3, areaM2: 9 }, minAisleM: 2 } }, expect: /9 m2 bo'lishi shart/ },
  { name: 'qo\'lda joylash: stendlar orasida 0.5 m bo\'shliq', layout: {
      ...base(),
      blocks: [{ id: 'A-01', x: 5, y: 5, stands: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ col: i % 4, row: Math.floor(i / 4), no: i + 1 })).map((c, i) => ({ ...c, row: c.row, col: c.col })) }],
    }, expect: 'ok' },
  { name: 'blokning stendlari uzilib qolgan (noto\'g\'ri map)', layout: {
      ...base(),
      blocks: [{
        id: 'A-01', x: 5, y: 5,
        stands: [
          { col: 0, row: 0, no: 1 }, { col: 1, row: 0, no: 2 }, { col: 2, row: 0, no: 3 }, { col: 3, row: 0, no: 4 },
          { col: 0, row: 1, no: 5 }, { col: 1, row: 1, no: 6 }, { col: 2, row: 1, no: 7 },
          { col: 8, row: 5, no: 8 }, // sakrab ketgan — xaritada boshqa joyda chiqadi
        ],
      }],
    }, expect: /uzluksiz emas/ },
  { name: 'ikkita blok ustma-ust tushgan', layout: { ...base(), blocks: [
      { id: 'A-01', x: 5, y: 5, cols: 4, rows: 2 },
      { id: 'A-02', x: 8, y: 5, cols: 4, rows: 2 },
    ] }, expect: /1-biriga yopishib|Ustma-ust/ },
  { name: 'yo\'lakcha 1 m (tor) — ogohlantirish', layout: { ...base(), blocks: [
      { id: 'A-01', x: 5, y: 5, cols: 4, rows: 2 },
      { id: 'A-02', x: 18, y: 5, cols: 4, rows: 2 },
    ] }, expect: 'ok', expectWarn: /1\.00 m/ },
  { name: 'stend ustunga kirib ketgan', layout: { ...base(), blocks: [{ id: 'A-01', x: 5, y: 5, cols: 4, rows: 2 }], features: [{ type: 'column', label: 'Ustun', x: 11, y: 5, w: 1.2, h: 1.2 }] }, expect: /obyektiga kirib ketgan/ },
  { name: 'stend zal chegarasidan tashqarida', layout: { ...base(), hall: { width: 20, height: 20, outline: [[0, 0], [20, 0], [20, 20], [0, 20]] }, blocks: [{ id: 'A-01', x: 18, y: 5, cols: 4, rows: 2 }] }, expect: /chegarasidan tashqariga/ },
  { name: 'blok ID takrorlangan', layout: { ...base(), blocks: [
      { id: 'A-01', x: 5, y: 5, cols: 4, rows: 2 },
      { id: 'A-01', x: 20, y: 5, cols: 4, rows: 2 },
    ] }, expect: /Blok ID takrorlanyapti/ },
  { name: 'maydon 72 emas (meta.block.areaM2 = 90)', layout: { ...base(), meta: { stand: { w: 3, h: 3, areaM2: 9 }, block: { stands: 8, areaM2: 90 }, minAisleM: 2 } }, expect: /72 bo'lishi shart/ },
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
    console.log(`✗ ${c.name}\n   kutilgan: ${c.expect}\n   natija: ${r.ok ? "XATO YO'Q (o'tib ketdi!)" : joined}`);
  }
}
console.log(`\n${pass} o'tdi, ${fail} yiqildi.`);
process.exit(fail ? 1 : 0);
