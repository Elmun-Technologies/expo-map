#!/usr/bin/env node
/**
 * MIJOZGA TAYYOR PAKET (bitta buyruq bilan hamma fayl).
 *
 *   node tools/package.mjs                        # LAYOUT=layout/foodera-2026.json
 *   node tools/package.mjs --layout layout/hall-A.json --out exports/boshqa
 *
 * Nima chiqadi (exports/<zagolovka>/ ichida):
 *   01-xarita-butun-zal.svg        — butun zal, bo'limlar va band joylar bilan
 *   01-xarita-butun-zal.pdf        — shu xaritaning BITTA varaqli PDF'i (A3 landscape, mijozga)
 *   02-xarita-bosh-joylar.svg      — FAQAT bo'sh joylar (sotuvchiga/katalogga)
 *   02-xarita-bosh-joylar.pdf      — shu xaritaning BITTA varaqli PDF'i
 *   03-bolim-<ID>-<nom>.svg        — har bir bo'lim uchun alohida varaq
 *   04-kompaniyalar.csv            — band qilingan joylar ro'yxati (Excel uchun)
 *   00-IZOH.txt                    — versiya, sana, qoidalar, qanday o'qish kerak
 *
 * Qoidalar: layout validatordan o'tishi shart; QORALAMA bo'lsa paket yasalmaydi.
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
  console.error('✗ Layout xato — paket yasalmadi:\n' + check.errors.map((e) => '   ✗ ' + e).join('\n'));
  process.exit(1);
}
if ((raw.meta?.status || 'draft') !== 'approved') {
  console.error('✗ Layout QORALAMA (meta.status != "approved") — mijozga paket yasash mumkin emas.');
  process.exit(1);
}
const exp = expandLayout(raw);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9ä-ü]+/gi, '-').replace(/^-|-$/g, '').slice(0, 28);
const baseName = path.basename(layoutPath).replace(/\.json$/, '');
const outDir = path.resolve(ROOT, String(opt('out', `exports/${baseName}`)));
fs.mkdirSync(outDir, { recursive: true });
// eski varaqlarni tozalash (bo'lim nomi o'zgargan bo'lsa, eski fayl qolib ketmasin)
for (const f of fs.readdirSync(outDir)) {
  if (/^03-bolim-.*\.svg$/.test(f)) fs.rmSync(path.join(outDir, f));
}

const stateFile = path.join(ROOT, 'data/state.json');
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { items: {} };
const items = state.items || {};
const statusOf = (id) => items[id]?.status || 'free';

const run = (argsList) => {
  try {
    const out = execFileSync('node', [path.join(ROOT, 'tools/export-svg.mjs'), '--layout', layoutPath, ...argsList], { cwd: ROOT, encoding: 'utf8' });
    return out.trim().split('\n').pop();
  } catch (e) {
    console.error('✗ eksport xatosi:', e.message);
    return null;
  }
};

console.log(`\n📦 Paket: ${raw.meta.project} · ${raw.meta.hall} — v${raw.meta.version}\n`);
const made = [];

// 1) butun zal (band joylar bilan) va 2) faqat bo'sh joylar
const f1 = path.join(outDir, '01-xarita-butun-zal.svg');
const f2 = path.join(outDir, '02-xarita-bosh-joylar.svg');
if (run(['--out', f1])) made.push(f1);
if (run(['--no-state', '--out', f2])) made.push(f2);

// 1b) PDF — FAQAT ASOSIY XARITA, bitta varaq (A3 landscape).
// Brauzerdagi "Save as PDF" ko'p varaqqa bo'lib tashlaydi; bu fayl mijozga to'g'ridan-to'g'ri yuboriladi.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-pdf-'));
for (const item of [
  { svg: f1, name: '01-xarita-butun-zal.pdf', extra: [] },
  { svg: f2, name: '02-xarita-bosh-joylar.pdf', extra: ['--no-state'] },
]) {
  const mapSvg = path.join(tmpDir, item.name.replace(/\.pdf$/, '.svg'));
  const pdfOut = path.join(outDir, item.name);
  if (!run(['--map', ...item.extra, '--out', mapSvg])) continue;
  try {
    const line = execFileSync('python3',
      [path.join(ROOT, 'tools/export-pdf.py'), mapSvg, pdfOut, '--title', `${raw.meta.project} — ${raw.meta.hall}`],
      { cwd: ROOT, encoding: 'utf8' });
    console.log('  ' + line.trim());
    made.push(pdfOut);
  } catch (e) {
    console.error('⚠ PDF yasalmadi (python3 + reportlab + svglib kerak):', String(e.message).split('\n')[0]);
  }
}
fs.rmSync(tmpDir, { recursive: true, force: true });

// 3) har bir bo'lim alohida varaq
for (const sec of exp.sections || []) {
  const mine = exp.stands.filter((s) => s.section === sec.id);
  if (!mine.length) continue;
  const f = path.join(outDir, `03-bolim-${sec.id}-${slug(sec.short || sec.label)}.svg`);
  if (run(['--section', sec.id, '--out', f])) made.push(f);
}

// 4) kompaniyalar CSV — BITTA kompaniya = BITTA qator (nechta stend olgan bo'lsa ham)
const rows = [['Bolim', 'Kompaniya', 'Mijoz', 'Telefon', 'Holat', 'Stendlar soni', 'm2', 'Summa', 'Stend ID lari', 'Sotuvchi', 'Yangilangan']];
const extra = mergedAsStands(exp.blocks);
const units = groupBookings([...exp.stands, ...extra.stands], Object.assign({}, items, extra.items))
  .sort((a, b) => (a.section || '').localeCompare(b.section || '') || b.areaM2 - a.areaM2);
for (const u of units) {
  const sec = (exp.sections || []).find((x) => x.id === u.section);
  const first = items[u.ids[0]] || {};
  const sum = u.ids.reduce((a, id) => a + (Number(items[id]?.amount) || 0), 0);
  rows.push([sec ? sec.label : '', u.company || u.buyer || '', u.buyer || '', u.phone || '',
    { sold: 'Sotilgan', reserved: 'Bron', blocked: 'Bloklangan' }[u.status] || u.status,
    String(u.stands.length), String(u.areaM2), String(sum || ''), u.ids.join(', '), first.sellerName || '', first.updatedAt || '']);
}
const csv = '\uFEFF' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
const f4 = path.join(outDir, '04-kompaniyalar.csv');
fs.writeFileSync(f4, csv);
made.push(f4);

// 4b) bo'sh joylar CSV (sotuvchiga)
const freeRows = [['Bolim', 'Blok', 'Stend', 'm2', 'Narx (so\'m)']];
for (const s of exp.stands) {
  if (statusOf(s.id) !== 'free') continue;
  const sec = (exp.sections || []).find((x) => x.id === s.section);
  freeRows.push([sec ? sec.label : '', s.blockId, s.id, String(s.areaM2), String(Math.round(s.areaM2 * (raw.meta.pricePerM2 || 0)))]);
}
const f4b = path.join(outDir, '05-bosh-joylar.csv');
fs.writeFileSync(f4b, '\uFEFF' + freeRows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n'));
made.push(f4b);

// 5) izoh
const secTable = (exp.sections || []).map((sec) => {
  const st = exp.stands.filter((s) => s.section === sec.id);
  if (!st.length) return null;
  const free = st.filter((s) => statusOf(s.id) === 'free');
  const area = st.reduce((a, x) => a + x.areaM2, 0);
  const freeArea = free.reduce((a, x) => a + x.areaM2, 0);
  return `  ${sec.label.padEnd(32)} ${String(st.length).padStart(3)} stend · ${String(area).padStart(8)} m² · bo'sh: ${free.length} (${freeArea.toFixed(2)} m²)`;
}).filter(Boolean).join('\n');
const totalStands = exp.stands.length;
const totalArea = exp.stands.reduce((a, s) => a + s.areaM2, 0);
const freeStands = exp.stands.filter((s) => statusOf(s.id) === 'free');
const izoh = `${raw.meta.project} — ${raw.meta.hall}
Joylashuv xaritasi · versiya ${raw.meta.version} · ${new Date().toLocaleDateString('ru-RU')}
Manba: ${path.relative(ROOT, layoutPath)} (o'zgartirilsa paket qayta yasaladi)

QOIDALAR
  1 stend = 3×3 m = 9 m²
  1 blok  = 8 stend = 72 m²
  Har bir stendning o'z ID'si bor (masalan A-01-05). Shartnomada ham, xaritada ham
  aynan shu ID ishlatiladi — "o'rtadagi joy" kabi ifoda ishlatilmaydi.

UMUMIY
  Jami: ${totalStands} stend · ${totalArea.toFixed(2)} m²
  Bo'sh: ${freeStands.length} stend · ${freeStands.reduce((a, s) => a + s.areaM2, 0).toFixed(2)} m²
  Narx: ${raw.meta.pricePerM2 ? raw.meta.pricePerM2.toLocaleString('ru-RU') + " so'm/m²" : 'belgilanmagan'}

BO'LIMLAR
${secTable}

FAYLLAR
  01-xarita-butun-zal.svg     butun zal: bo'limlar, bron va sotilgan joylar bilan (mijozga/rahbariyatga)
  01-xarita-butun-zal.pdf     shu xaritaning BITTA varaqli PDF'i (A3 landscape) - to'g'ridan-to'g'ri yuborish uchun
  02-xarita-bosh-joylar.svg   faqat bo'sh joylar (sotuvchiga, katalogga)
  02-xarita-bosh-joylar.pdf   bo'sh joylar xaritasining bitta varaqli PDF'i
  03-bolim-*.svg              har bir bo'lim alohida varaq (mijozga aynan o'z bo'limini yuborish uchun)
  04-kompaniyalar.csv         band qilingan joylar: kompaniya, stend ID, summa, sotuvchi
  05-bosh-joylar.csv          bo'sh joylar ro'yxati (narx bilan)

RANGLAR
  Yashil  — bo'sh (sotuvga tayyor)
  Sariq   — bron qilingan (muddat tugasa avtomatik bo'shaydi)
  Qizil   — sotilgan
  Kulrang — bloklangan (texnik yoki egasi uchun)

IZOH: PDF fayllar BITTA A3 varaqdan iborat (brauzerdan "Save as PDF" qilish shart emas - u ko'p
varaqqa bo'lib tashlaydi). SVG fayllar brauzerda ochiladi, tahrirlanadigan vektor bo'lib qoladi.
Xarita layout faylidan avtomatik chiziladi — qo'lda tahrirlash mumkin emas, shuning uchun
xarita bilan holat hech qachon ajralib qolmaydi.
`;
const f5 = path.join(outDir, '00-IZOH.txt');
fs.writeFileSync(f5, izoh);
made.push(f5);

console.log('\nFayllar:');
for (const f of made) console.log(`  ${path.relative(ROOT, f)}`);
console.log(`\n✓ Paket tayyor: ${path.relative(ROOT, outDir)} (${made.length} fayl)\n`);
