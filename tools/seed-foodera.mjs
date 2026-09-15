#!/usr/bin/env node
/**
 * Расставляет РЕАЛЬНЫЕ компании из чертежа «FOOD ERA MAP.pdf» по карте v2.0.
 *
 *   node tools/seed-foodera.mjs           → данные пишутся в data/state.json (перезапустите сервер)
 *   node tools/seed-foodera.mjs --dry     → только показать, не записывать
 *   node tools/seed-foodera.mjs --reset   → освободить все занятые места
 *
 * v2.0: стенды на карте = стенды чертежа (ID 1:1), каждая компания
 * ставится на СВОЙ стенд с чертежа — без пересчёта в сетку 9 м².
 * Уже занятые стенды не трогаются (данные менеджера важнее).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandLayout } from '../lib/layout.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LAYOUT = process.env.LAYOUT || path.join(ROOT, 'layout/foodera-2026.json');
const STATE = path.join(ROOT, 'data/state.json');
const PRICE = 0;   // narx hali kelishilmagan — summalar 0 bo'lib turadi
const dry = process.argv.includes('--dry');
const reset = process.argv.includes('--reset');

const SELLERS = [
  { sellerId: 's1', sellerName: 'Aziz Karimov' },
  { sellerId: 's2', sellerName: 'Dilnoza Yusupova' },
  { sellerId: 's3', sellerName: 'Sardor Umarov' },
];

/** [standId (чертёж), компания, статус?] — прочитано с чертежа FOOD ERA MAP.pdf */
const PLAN = [
  ['A18', 'Silver'], ['A19', 'YaTT Sh.X.T.'], ['A20', 'Ecocups'],
  ['A5', 'Xinghua Lianfu'], ['A7', 'MEZBON'], ['A11', 'Mmiraj'],
  ['B13', 'Ansor-Zoxir'], ['B12', 'B12 — бронь', 'reserved'],
  ['B2', 'LOno'], ['B5', 'NEW ENERGY DRINKS KZ'],
  ['B6', 'Dobroye Derevenskoye'], ['B7', 'Saids Trading'], ['B9', 'Saids Trading (2)'],
  ["B10", "Oltin Go'sht · Sam"], ["B11", "Oltin Go'sht · Sam"],
  ['C2', 'ADMIRAL'], ['C5', 'Gulf Flavours and Fragrances'], ['C6', 'Бронь (чертёж)', 'reserved'],
  ['C7', 'CHORTAK FIDANI'], ['C11', 'AKULA'], ['C16', 'Toyirxon'],
  ['D1', 'Silver Green Tea'], ['D3', 'Argan X'], ['D4', 'Slava konfet'], ['D5', 'Real Tea Zone'],
  ['D6', 'СВД-Групп'], ['D7', 'ASLAN TEA'],
  ['D9', 'Amir Tea'], ['D10', 'Bogi Baland'], ['D11', 'Milliy Bottlers'],
  ['D13', 'Brewo Group'], ['D14', 'New Leads Camping'],
  ['D15', 'Xinghua Lianfu Food'], ['D16', 'Payhal agro holding'],
  ['E2', 'Flexobo'], ['E4', 'CINDER FRUIT'], ['E5', 'BIOLAB'], ['E6', 'CINDER FRUIT (2)'],
  ['E9', 'ERMAK'], ['E11', 'Kohna'], ['PPK', 'OOO PPK'],
  ['F1', 'Dali Foods Group'], ['F2', 'Innovatsion Texnologiya'],
  ['F3', 'Perilafood'], ['F4', 'Qosimov Group'],
];

const exp = expandLayout(JSON.parse(fs.readFileSync(LAYOUT, 'utf8')));
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { items: {}, revision: 0 };

if (reset) {
  state.items = {};
  state.revision = (state.revision || 0) + 1;
  if (!dry) fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  console.log(`✓ Все места освобождены (revision ${state.revision})`);
  process.exit(0);
}

const byId = new Map(exp.stands.map((s) => [s.id, s]));
const items = { ...state.items };
let n = 0;

for (const [standId, name, status] of PLAN) {
  const st = byId.get(standId);
  if (!st) { console.log(`• стенд ${standId} («${name}») не найден в плане`); continue; }
  if (state.items[standId]) { console.log(`• ${standId} уже занят («${state.items[standId].buyer}») — «${name}» пропущена`); continue; }
  const seller = SELLERS[n % SELLERS.length];
  items[standId] = {
    standId,
    blockId: st.blockId,
    areaM2: st.areaM2,
    status: status || 'sold',
    buyer: name,
    phone: '',
    company: '',
    pricePerM2: PRICE,
    amount: st.areaM2 * PRICE,
    sellerId: seller.sellerId,
    sellerName: seller.sellerName,
    updatedAt: new Date().toISOString(),
    reservedUntil: null,
    note: '',
    groupId: `gf2-${standId}`,
  };
  console.log(`${standId}: ${name} · ${st.areaM2} м²`);
  n++;
}

state.items = items;
state.revision = (state.revision || 0) + 1;
if (!dry) fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
const sold = Object.values(items).filter((i) => i.status === 'sold').length;
const res = Object.values(items).filter((i) => i.status === 'reserved').length;
console.log(`\n${dry ? '(dry-run, ничего не записано)' : '✓ записано'}: ${sold} продано · ${res} бронь · всего ${Object.keys(items).length} занятых (revision ${state.revision})`);
