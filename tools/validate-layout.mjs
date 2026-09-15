#!/usr/bin/env node
/**
 * Проверка плана:  node tools/validate-layout.mjs layout/foodera-2026.json
 * Запускается после любого изменения (в том числе в CI).
 * При ошибке — код выхода 1 (с таким планом к клиенту выходить нельзя).
 */
import fs from 'node:fs';
import path from 'node:path';
import { validateLayout } from '../lib/layout.mjs';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Использование: node tools/validate-layout.mjs <layout.json> [ещё.json ...]');
  process.exit(2);
}

let failed = 0;
for (const f of files) {
  const p = path.resolve(f);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.log(`\n✗ ${f}\n  не удалось прочитать JSON: ${e.message}`);
    failed++;
    continue;
  }
  const r = validateLayout(raw);
  const rel = path.relative(process.cwd(), p);
  console.log(`\n${r.ok ? '✓' : '✗'} ${rel}`);
  if (r.stats) {
    console.log(`  ${r.stats.blocks} блоков · ${r.stats.stands} стендов · ${r.stats.totalAreaM2} м² · стенд ${r.stats.standWidthM}×${r.stats.standHeightM} м · мин. проход ${r.stats.minAisleM} м`);
  }
  for (const w of r.warnings) console.log(`  ⚠ ${w}`);
  for (const e of r.errors) console.log(`  ✗ ${e}`);
  if (!r.ok) failed++;
}

if (failed) {
  console.log(`\n${failed} план(ов) завершились с ОШИБКОЙ.`);
  process.exit(1);
}
console.log('\nВсё в порядке.');
