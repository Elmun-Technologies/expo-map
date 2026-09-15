#!/usr/bin/env node
/**
 * BAND QILINGANLARNI OMMAVIY YUKLASH (menejer qo'lda birma-bir kiritmasin).
 *
 * Excel'da bitta jadval tayyorlanadi va shu skript bilan bir marta yuklanadi:
 *
 *   Blok/Stend | Holat   | Kompaniya            | Mijoz (ism)     | Telefon         | Sotuvchi | Summa (so'm)
 *   A          | band    | Orient Food Group    | Aziz Karimov    | +998 71 200 10 10 | Aziz K. | 90 000 000
 *   A-01-05    | band    | Navoiy Agro          | ...             | ...              | ...
 *   B          | bron    | Buxoro Sut           | ...             | ...              | ...      | 36 000 000
 *   C          | bosh    |                      |                 |                  |          |
 *
 *   node tools/import-bookings.mjs band.csv                 # avval KO'RSATADI (dry-run)
 *   node tools/import-bookings.mjs band.csv --apply         # haqiqatan yuklaydi
 *   node tools/import-bookings.mjs band.csv --apply --ttl 48
 *
 * Qoidalar:
 *   - "Blok/Stend" ustunida blok ID (A, B, EQ-1...) yoki bitta stend ID (A-01-05) yoki A6 (chap qanot) bo'ladi.
 *   - Blok yozilsa — blokning BARCHA stendlari band qilinadi.
 *   - "Summa" berilsa, narx shu summadan kelib chiqib yozuvga qo'shiladi (maydon bo'yicha narxdan ustun).
 *   - Xato qatorlar yuklanmaydi va hisobot oxirida ko'rsatiladi (hech narsa "yarim" qolmaydi).
 *   - Har bir yozuv jurnalga (audit.log) tushadi: kim yukladi, qachon.
 *
 * Server ishlab turishi kerak: node server.mjs  (yoki BASE=... bilan boshqa manzil)
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:4173';
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  if (i === -1) return def;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const file = args.find((a) => !a.startsWith('--') && !['apply', 'ttl', 'user', 'pin', 'seller', 'out'].includes(a));
if (!file) { console.error('Использование: node tools/import-bookings.mjs <занятые.csv> [--apply] [--ttl 48] [--user "Menejer" --pin 9999]'); process.exit(2); }
const apply = args.includes('--apply');
const ttlHours = Number(opt('ttl', 0)) || undefined;
const userName = String(opt('user', 'Menejer'));
const userPin = String(opt('pin', '9999'));

// ---------------------------------------------------------------- CSV
const raw = fs.readFileSync(path.resolve(file), 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
const split = (line) => {
  const cells = []; let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === delim && !inQ) { cells.push(cur); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
};
const [header, ...rows] = lines.map(split);
const ALIAS = {
  target: ['blok/stend', 'blok', 'stend', 'block', 'stand', 'joy', 'joylar', 'blok yoki stend'],
  status: ['holat', 'status', 'sotuv', 'band'],
  company: ['kompaniya', 'company', 'firma', 'tashkilot', 'mijoz kompaniyasi'],
  buyer: ['mijoz', 'mijoz (ism)', 'ism', 'contact', 'kontakt'],
  phone: ['telefon', 'phone', 'tel', 'aloqa'],
  seller: ['sotuvchi', 'manager', 'menejer', 'sotuvchi (ism)'],
  amount: ['summa', 'summa (so\'m)', 'narx', 'amount', 'total'],
  note: ['izoh', 'note', 'eslatma'],
};
const col = {};
header.forEach((h, i) => {
  const key = h.toLowerCase().trim();
  for (const [field, names] of Object.entries(ALIAS)) if (names.includes(key)) col[field] = i;
});
if (col.target == null || col.status == null) {
  console.error(`✗ в CSV обязательны колонки «Blok/Stend» и «Holat».\n  Найденный заголовок: ${header.join(' | ')}`);
  process.exit(1);
}
const get = (r, f) => (col[f] == null ? '' : (r[col[f]] ?? ''));

// ---------------------------------------------------------------- server
async function login() {
  const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: userName, pin: userPin }) });
  if (!r.ok) throw new Error(`login: ${(await r.json()).message || r.status}`);
  return (await r.json()).token;
}
const layout = await (await fetch(BASE + '/api/layout')).json();
const state = await (await fetch(BASE + '/api/state')).json();
const blocksById = new Map(layout.blocks.map((b) => [b.id.toUpperCase(), b]));
const standsById = new Map(layout.stands.map((s) => [s.id.toUpperCase(), s]));

const STATUS_WORDS = {
  band: 'sell', sotilgan: 'sell', sold: 'sell', sell: 'sell', sotuv: 'sell',
  bron: 'reserve', reserved: 'reserve', reserve: 'reserve', band_qilindi: 'reserve',
  bosh: 'release', 'bo\'sh': 'release', free: 'release', release: 'release', ozod: 'release',
  bloklangan: 'block', blocked: 'block', block: 'block',
};

/** Blok/stend yozuvini stend ID'lar ro'yxatiga aylantirish */
function resolveTarget(text) {
  const t = String(text).toUpperCase().trim();
  if (!t) return { error: "bo'sh" };
  const block = blocksById.get(t);
  if (block) {
    // blok: barcha stendlari (nostandart stend uchun — o'zi)
    return { ids: [...new Set(block.stands.map((s) => s.id))], kind: block.kind === 'custom' ? 'stend' : 'blok', label: block.label };
  }
  const stand = standsById.get(t);
  if (stand) return { ids: [stand.id], kind: 'stand' };
  // A6-01 kabi noto'g'ri variantni tutish
  if (/^[A-Z]+-\d+-\d+$/.test(t)) {
    const shorter = t.replace(/-(\d+)$/, '');
    return { error: `stend topilmadi: ${text}${standsById.has(shorter) ? ` (ehtimol ${shorter}?)` : ''}` };
  }
  return { error: `"${text}" — bunday blok ham, stend ham yo'q` };
}

const plan = [];
const problems = [];
for (const [i, r] of rows.entries()) {
  const lineNo = i + 2;
  const targetText = get(r, 'target');
  if (!targetText) continue;
  const statusWord = get(r, 'status').toLowerCase().replace(/\s+/g, '_');
  const action = STATUS_WORDS[statusWord];
  if (!action) { problems.push(`${lineNo}-qator: "${get(r, 'status')}" holati noma'lum (band/bron/bosh yozing)`); continue; }
  const res = resolveTarget(targetText);
  if (res.error) { problems.push(`${lineNo}-qator: ${res.error}`); continue; }

  const company = get(r, 'company');
  const buyer = get(r, 'buyer') || company;
  const phone = get(r, 'phone');
  const note = get(r, 'note');
  const amount = get(r, 'amount').replace(/[^\d.]/g, '');
  const seller = get(r, 'seller');

  if ((action === 'sell' || action === 'reserve') && !buyer) {
    problems.push(`${lineNo}-qator: ${targetText} — mijoz/kompaniya ismi yo'q`);
    continue;
  }

  const ids = res.ids.filter((id) => {
    const cur = state.items[id];
    if (!cur) return true;
    if (action === 'release') return true;
    // allaqachon shu holatda va shu mijozga tegishli bo'lsa — qayta yozish shart emas
    if (cur.status === (action === 'sell' ? 'sold' : action === 'reserve' ? 'reserved' : 'blocked') && cur.buyer === buyer) return false;
    problems.push(`${lineNo}-qator: ${id} allaqachon band (${cur.status}${cur.buyer ? ', ' + cur.buyer : ''}) — o'tkazib yuborildi`);
    return false;
  });

  plan.push({ lineNo, target: targetText, kind: res.kind, action, ids, buyer, company, phone, seller, note, amount: amount ? Number(amount) : null });
}

// ---------------------------------------------------------------- ko'rsatish
const actName = { sell: 'SOTISH', reserve: 'BRON', release: "BO'SHATISH", block: 'BLOKLASH' };
console.log(`\n${apply ? '▶ ЗАГРУЗКА' : 'ℹ ПРОВЕРКА (dry-run)'} — ${path.basename(file)} · строк ${plan.length}\n`);
console.log('  Блок/Стенд     Тип   Действие    Стендов  м²     Компания / клиент              Сумма');
for (const p of plan) {
  const area = p.ids.reduce((a, id) => a + (standsById.get(id)?.areaM2 || 0), 0);
  const amt = p.amount ?? (area * (layout.meta.pricePerM2 || 0));
  console.log(`  ${p.target.padEnd(14)} ${p.kind.padEnd(5)} ${actName[p.action].padEnd(11)} ${String(p.ids.length).padStart(4)}  ${String(area).padStart(6)}  ${(p.buyer || '—').padEnd(28)} ${amt ? amt.toLocaleString('ru-RU') : ''}`);
}
if (problems.length) {
  console.log(`\n⚠ проблемных строк: ${problems.length} (не загружаются):`);
  for (const p of problems) console.log('   • ' + p);
}
const totalArea = plan.filter((p) => p.action !== 'release').reduce((a, p) => a + p.ids.reduce((x, id) => x + (standsById.get(id)?.areaM2 || 0), 0), 0);
const totalAmount = plan.filter((p) => p.action !== 'release').reduce((a, p) => a + (p.amount ?? p.ids.reduce((x, id) => x + (standsById.get(id)?.areaM2 || 0) * (layout.meta.pricePerM2 || 0), 0)), 0);
console.log(`\nИтого: ${plan.filter((p) => p.action !== 'release').reduce((a, p) => a + p.ids.length, 0)} стендов · ${totalArea.toFixed(2)} м² · ${totalAmount.toLocaleString('ru-RU')} сум`);

if (!apply) {
  console.log('\nДля загрузки: node tools/import-bookings.mjs ' + path.basename(file) + ' --apply');
  process.exit(problems.length && !plan.length ? 1 : 0);
}

// ---------------------------------------------------------------- yuklash
const token = await login();
let ok = 0, fail = 0;
for (const p of plan) {
  const body = { action: p.action, standIds: p.ids, buyer: p.buyer, company: p.company, phone: p.phone, note: p.note };
  if (p.amount && p.action !== 'release') body.amount = p.amount;
  if (p.action === 'reserve' && ttlHours) body.ttlHours = ttlHours;
  const r = await fetch(BASE + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
  const j = await r.json();
  if (r.ok) { ok++; console.log(`✓ ${p.target}: ${actName[p.action]} ${p.ids.length} стендов${p.buyer ? ' · ' + p.buyer : ''}`); }
  else { fail++; console.log(`✗ ${p.target}: ${j.message || r.status}`); }
}
console.log(`\nзагружено строк: ${ok}, ошибок: ${fail}.${problems.length ? ` Пропущено строк: ${problems.length}.` : ''}`);
console.log('Журнал: data/audit.log (записано каждое действие)');
