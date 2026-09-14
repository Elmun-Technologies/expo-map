#!/usr/bin/env node
/**
 * FOODERA EXPO 2026 chizmasidagi HAQIQIY kompaniyalarni xaritaga joylaydi.
 *
 *   node tools/seed-foodera.mjs           → данные пишутся в data/state.json (перезапустите сервер)
 *   node tools/seed-foodera.mjs --dry     → только показать, не записывать
 *   node tools/seed-foodera.mjs --reset   → освободить все занятые места
 *
 * Размеры ячеек на исходном плане (12/18/36/40 м²) приводятся к сетке 9 м²:
 * 12 m² → 1 katak · 18 m² → 2 katak · 36 va 40 m² → 4 katak.
 * Chizmadagi asl maydon `note` ichida saqlanadi.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandLayout } from '../lib/layout.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LAYOUT = process.env.LAYOUT || path.join(ROOT, 'layout/foodera-2026.json');
const STATE = path.join(ROOT, 'data/state.json');
const PRICE = 1_250_000;
const dry = process.argv.includes('--dry');
const reset = process.argv.includes('--reset');

const SELLERS = [
  { sellerId: 's1', sellerName: 'Aziz Karimov' },
  { sellerId: 's2', sellerName: 'Dilnoza Yusupova' },
  { sellerId: 's3', sellerName: 'Sardor Umarov' },
];

/** [blok, [[kompaniya, chizmadagi m², status?], ...]] — FOODERA chizmasidan o'qildi */
const PLAN = [
  ['A', [['Silver', 9], ['YaTT Sh.X.T.', 12], ['Ecocups', 12]]],
  ['B', [['Ansor-Zoxir', 9], ['B12 — бронь', 9, 'reserved']]],
  ['C', [['Toyirxon', 9]]],
  ['D', [['Xinjiang Lianfu Food', 9], ['Sayhal Agro Holding', 9]]],
  ['E', [['Kolna', 9]]],
  ['F', []],
  ['G', []],
  ['H', [["Oltin Go'sht Sari", 12], ["Oltin Go'sht Turon", 12], ['Saldis Trading Group', 12], ['Dobroye Derevenskoye', 12], ['Saldis Trading Group (2)', 12]]],
  ['I', [['AKULA', 12], ['CHORTAK FIDANI', 40]]],
  ['J', [['Brew Group', 9], ['New Leads Camping', 9], ['Milliy Bottlers', 9], ['Amir Tea', 9], ['Bogi Baland', 9]]],
  ['K', [['OOO PPK', 12], ['ERMAK', 36]]],
  ['L', [['MEZBON', 18], ['Xinjiang Lianfu Food (2)', 9]]],
  ['M', [['NEW ENERGY DRINKS KZ', 9]]],
  ['N', [['Gulf Flavours and Fragrances', 12], ['Bimak', 12], ['ADMIRAL', 12]]],
  ['O', [['ASLAN TEA', 12], ['SVD-Grupp', 12], ['Real Tea Zone', 9], ['Biana Konfet', 9], ['Archan X', 9], ['Silver Green Tea', 18]]],
  ['P', [['CINDER FRUIT', 9], ['BIO LAB', 9], ['Pisobas', 12], ['CINDER FRUIT (2)', 18]]],
  ['Q', [['Perfumed', 9], ['Greenway Group', 9], ['Dall Foods Group', 9], ['Javohirlar Food & Drink', 6]]],
  ['R', []],
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

const cells = (a) => Math.max(1, Math.round(a / 9));
const items = {};
let gid = 0;
let n = 0;

for (const [blockId, companies] of PLAN) {
  const block = exp.blocks.find((b) => b.id === blockId);
  if (!block) { console.log(`• ${blockId} bloki topilmadi`); continue; }
  let cursor = 0;
  for (const [name, planArea, status] of companies) {
    const count = cells(planArea);
    const take = block.stands.slice(cursor, cursor + count);
    cursor += count;
    if (!take.length) { console.log(`• ${blockId}: ${name} uchun joy yetmadi`); continue; }
    const seller = SELLERS[n % SELLERS.length];
    const areaM2 = take.length * 9;
    const groupId = `gf${gid++}`;
    for (const st of take) {
      items[st.id] = {
        standId: st.id,
        blockId,
        areaM2: 9,
        status: status || 'sold',
        buyer: name,
        phone: '',
        company: '',
        pricePerM2: PRICE,
        amount: 9 * PRICE,
        sellerId: seller.sellerId,
        sellerName: seller.sellerName,
        updatedAt: new Date().toISOString(),
        reservedUntil: null,
        note: planArea !== 9 ? `по исходному плану: ${planArea} м²` : '',
        groupId,
      };
    }
    console.log(`${blockId}: ${name} → ${take.map((s) => s.id).join(', ')} (${areaM2} м²${planArea !== areaM2 ? `, в исходном плане ${planArea} м²` : ''})`);
    n++;
  }
}

state.items = items;
state.revision = (state.revision || 0) + 1;
if (!dry) fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
const sold = Object.values(items).filter((i) => i.status === 'sold').length;
const res = Object.values(items).filter((i) => i.status === 'reserved').length;
const area = Object.values(items).reduce((a, i) => a + i.areaM2, 0);
// hisobot: fayldagi HAQIQIY holat bo'yicha (yozilgan stendlarning o'zi)
const allItems = Object.values(state.items || {});
const soldN = allItems.filter((i) => i.status === 'sold').length;
const resN = allItems.filter((i) => i.status === 'reserved').length;
const areaN = allItems.filter((i) => i.status === 'sold' || i.status === 'reserved')
  .reduce((a, i) => a + Number(i.areaM2 || 0), 0);
console.log(`\n✓ ${n} компаний · продано ${soldN} + бронь ${resN} = ${soldN + resN} стендов · ${areaN.toLocaleString('ru-RU')} м² (revision ${state.revision})`);
if (dry) console.log('(--dry: файл не записан)');
