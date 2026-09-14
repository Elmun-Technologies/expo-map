#!/usr/bin/env node
/**
 * Layout'ni tekshirish:  node tools/validate-layout.mjs layout/hall-A.json
 * Har qanday o'zgarishdan keyin (CI'da ham) shu skript ishlaydi.
 * Xato topsa — chiqish kodi 1 (ya'ni xarita bilan mijozga chiqib bo'lmaydi).
 */
import fs from 'node:fs';
import path from 'node:path';
import { validateLayout } from '../lib/layout.mjs';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Ishlatish: node tools/validate-layout.mjs <layout.json> [yana.json ...]');
  process.exit(2);
}

let failed = 0;
for (const f of files) {
  const p = path.resolve(f);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.log(`\n✗ ${f}\n  JSON o'qib bo'lmadi: ${e.message}`);
    failed++;
    continue;
  }
  const r = validateLayout(raw);
  const rel = path.relative(process.cwd(), p);
  console.log(`\n${r.ok ? '✓' : '✗'} ${rel}`);
  if (r.stats) {
    console.log(`  ${r.stats.blocks} blok · ${r.stats.stands} stend · ${r.stats.totalAreaM2} m² · stend ${r.stats.standWidthM}×${r.stats.standHeightM} m · min yo'lak ${r.stats.minAisleM} m`);
  }
  for (const w of r.warnings) console.log(`  ⚠ ${w}`);
  for (const e of r.errors) console.log(`  ✗ ${e}`);
  if (!r.ok) failed++;
}

if (failed) {
  console.log(`\n${failed} ta layout XATO bilan tugadi.`);
  process.exit(1);
}
console.log('\nHammasi joyida.');
