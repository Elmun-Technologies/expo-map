#!/usr/bin/env node
/**
 * Demo holat:  node tools/demo.mjs --seed     (kompaniyalar bo'limlarga joylashadi — ranglar ko'rinadi)
 *              node tools/demo.mjs --reset    (hamma joyni bo'shatadi — toza holat)
 *
 * Ishlab turgan serverga murojaat qiladi (standart http://localhost:4173).
 * Bo'limlar bo'yicha taqsimlaydi: har bir bo'limdan bir necha stend band qilinadi,
 * shunda xaritada ham bo'sh, ham bron, ham sotilgan joylar ko'rinadi.
 */
const BASE = process.env.BASE || 'http://localhost:4173';
const mode = process.argv.includes('--reset') ? 'reset' : process.argv.includes('--seed') ? 'seed' : null;
if (!mode) {
  console.error('Ishlatish: node tools/demo.mjs --seed | --reset');
  process.exit(2);
}

async function login(name, pin) {
  const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, pin }) });
  if (!r.ok) throw new Error(`${name} login xatosi: ${(await r.json()).message || r.status}`);
  return (await r.json()).token;
}
async function call(token, body) {
  const r = await fetch(BASE + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok && r.status !== 409) throw new Error(`${body.action} xatosi: ${j.message || r.status}`);
  return { status: r.status, body: j };
}

const admin = await login('Menejer', '9999');
const aziz = await login('Aziz Karimov', '1111');
const dilnoza = await login('Dilnoza Yusupova', '2222');
const sardor = await login('Sardor Umarov', '3333');
const layout = await (await fetch(BASE + '/api/layout')).json();
const state = await (await fetch(BASE + '/api/state')).json();
const taken = (id) => !!state.items[id];

if (mode === 'reset') {
  const all = layout.stands.filter((s) => taken(s.id)).map((s) => s.id);
  if (!all.length) console.log("Bo'shatadigan joy yo'q — holat allaqachon toza.");
  else console.log(`↺ ${all.length} joy bo'shatilmoqda...`);
  for (let i = 0; i < all.length; i += 20) {
    for (const id of all.slice(i, i + 20)) await call(admin, { action: 'release', standIds: [id] });
  }
  console.log("✓ Holat toza.");
} else {
  const byId = new Map(layout.blocks.map((b) => [b.id, b]));
  const pick = (blockId, nos) => {
    const b = byId.get(blockId);
    if (!b) return null;
    return nos.map((n) => b.stands.find((s) => s.no === n)?.id).filter(Boolean);
  };
  // bo'limlar bo'yicha taqsimlangan band qilish (FOODERA tuzilishi)
  const plan = [
    ['A', aziz, 'sell', [1, 2, 3, 4, 5, 6, 7, 8], 'Orient Food Group', '+998 71 200 10 10', 'HoReCa uchun to\'liq blok'],
    ['B', dilnoza, 'sell', [1, 2, 3, 4], 'Navoiy Konserva Zavodi', '+998 79 220 30 40', ''],
    ['B', sardor, 'reserve', [5, 6], 'Buxoro Sut Mahsulotlari', '+998 65 221 33 44', ''],
    ['C', aziz, 'reserve', [1, 2, 3, 4], 'Silk Road Seafood', '+998 93 300 44 55', '48 soatga bron'],
    ['D', dilnoza, 'sell', [1, 2, 5, 6], 'Fergana Fruit Export', '+998 73 244 55 66', ''],
    ['E', sardor, 'sell', [1, 2, 3, 4, 5, 6, 7, 8], 'Biosifat Organik', '+998 90 900 70 80', ''],
    ['F', aziz, 'reserve', [3, 4, 7, 8], 'EcoFood Uzbekistan', '+998 91 111 22 33', ''],
    ['J', dilnoza, 'sell', [1, 2, 3, 4, 5, 6], 'Toshkent Yarim Tayyor', '+998 93 555 22 11', ''],
    ['I', sardor, 'sell', [1, 2, 3, 4], 'Aqua Water Company', '+998 71 288 99 00', ''],
    ['K', aziz, 'reserve', [1, 2, 3, 4, 5, 6], 'Galla Bakaleya Savdosi', '+998 66 233 44 55', ''],
    ['L', dilnoza, 'sell', [5, 6, 7, 8], 'Qandolat Olam', '+998 70 610 20 30', ''],
    ['H', dilnoza, 'sell', [1, 2, 3, 4], 'Namangan Go\'sht Kombinati', '+998 69 227 40 40', ''],
    ['H', sardor, 'reserve', [7, 8], 'Qashqadaryo Sut Zavodi', '+998 75 226 55 66', ''],
    ['L', dilnoza, 'sell', [1, 2, 3, 4], 'Shirin Ta\'m Qandolat', '+998 71 244 66 77', ''],
    ['G', sardor, 'sell', [1, 2, 3, 4, 5, 6], 'Osiyo Ingredient MChJ', '+998 71 200 55 66', ''],
    ['EQ-1', aziz, 'reserve', [1, 2, 3, 4], 'UzPack Equipment', '+998 71 233 88 99', 'Uskunalar qatori'],
    ['EQ-2', dilnoza, 'sell', [1, 2, 3, 4], 'Konserv Liniya Servis', '+998 74 226 11 22', ''],
    ['EQ-1', sardor, 'sell', [5, 6], 'Rus Expo Group', '+998 71 200 44 55', ''],
    ['EQ-2', aziz, 'reserve', [5, 6], 'KazPack Machinery', '+998 71 288 77 66', ''],
  ];
  const wingPlan = [
    ['A6', dilnoza, 'sell', 'Milliy Ziravorlar', '+998 71 244 12 12'],
    ['A5', aziz, 'reserve', 'Andijon Meva Savdo', '+998 74 223 45 67'],
    ['A4', sardor, 'sell', 'Samarqand Non Zavodi', '+998 66 233 78 90'],
    ['A2', aziz, 'reserve', 'Qarshi Sifat Sut', '+998 75 221 33 55'],
  ];

  for (const [blockId, token, action, nos, buyer, phone, note] of plan) {
    const ids = pick(blockId, nos);
    if (!ids || !ids.length) { console.log(`• ${blockId} topilmadi — o'tkazib yuborildi`); continue; }
    if (ids.some(taken)) { console.log(`• ${blockId} (${ids.length} stend) band — o'tkazib yuborildi`); continue; }
    const r = await call(token, { action, standIds: ids, buyer, phone, note, ttlHours: action === 'reserve' ? 48 : undefined });
    console.log(`${r.status === 200 ? '✓' : '•'} ${blockId}: ${action} ${ids.length} stend · ${buyer}`);
  }
  for (const [standId, token, action, buyer, phone] of wingPlan) {
    if (taken(standId)) { console.log(`• ${standId} band — o'tkazib yuborildi`); continue; }
    const r = await call(token, { action, standIds: [standId], buyer, phone, ttlHours: action === 'reserve' ? 48 : undefined });
    console.log(`${r.status === 200 ? '✓' : '•'} ${standId}: ${action} · ${buyer}`);
  }

  const st = await (await fetch(BASE + '/api/state')).json();
  const c = {};
  Object.values(st.items).forEach((i) => { c[i.status] = (c[i.status] || 0) + 1; });
  const bookedArea = Object.values(st.items).reduce((a, i) => a + (i.areaM2 || 0), 0);
  console.log(`\nDemo holat tayyor: ${JSON.stringify(c)} · band ${bookedArea.toFixed(2)} m² (revision ${st.revision})`);
}
