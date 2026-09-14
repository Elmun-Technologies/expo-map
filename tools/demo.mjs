#!/usr/bin/env node
/**
 * Demo holat:  node tools/demo.mjs --seed    (bir nechta bron/sotuv qo'shadi — ranglar ko'rinadi)
 *              node tools/demo.mjs --reset   (hamma joyni bo'shatadi — toza holat)
 *
 * Ishlab turgan serverga murojaat qiladi (standart http://localhost:4173).
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
const layout = await (await fetch(BASE + '/api/layout')).json();
const state = await (await fetch(BASE + '/api/state')).json();
const ids = (blockId, list) => list.map((n) => `${blockId}-${String(n).padStart(2, '0')}`);

if (mode === 'reset') {
  const all = layout.stands.filter((s) => state.items[s.id]).map((s) => s.id);
  if (!all.length) console.log("Bo'shatadigan joy yo'q — holat allaqachon toza.");
  else console.log(`↺ ${all.length} joy bo'shatilmoqda...`);
  for (const id of all) await call(admin, { action: 'release', standIds: [id] });
  console.log('✓ Holat toza.');
} else {
  const free = (blockId, list) => ids(blockId, list).every((id) => !state.items[id]);
  const blocks = layout.blocks.map((b) => b.id);
  const plan = [
    [blocks[0], aziz, 'sell', [1, 2, 3, 4, 5, 6, 7, 8], 'Orient Textile MChJ', '+998 90 123 45 67'],
    [blocks[1], aziz, 'sell', [1, 2, 5, 6], 'Navoiy Agro', '+998 71 200 10 10'],
    [blocks[2], dilnoza, 'reserve', [3, 4, 7, 8], 'Silk Road Ceramics', '+998 93 300 44 55'],
    [blocks[4], dilnoza, 'reserve', [1, 2, 5, 6], 'Buxoro Mebel', '+998 65 221 33 44'],
    [blocks[5], aziz, 'sell', [3, 4], 'Toshkent Print', '+998 93 555 22 11'],
  ];
  for (const [blockId, token, action, nums, buyer, phone] of plan) {
    if (!free(blockId, nums)) { console.log(`• ${blockId} band — o'tkazib yuborildi`); continue; }
    const r = await call(token, { action, standIds: ids(blockId, nums), buyer, phone, ttlHours: 48 });
    console.log(`${r.status === 200 ? '✓' : '•'} ${action} ${ids(blockId, nums).join(', ')} · ${buyer}`);
  }
  const st = await (await fetch(BASE + '/api/state')).json();
  const c = {};
  Object.values(st.items).forEach((i) => { c[i.status] = (c[i.status] || 0) + 1; });
  console.log(`\nDemo holat tayyor: ${JSON.stringify(c)} (revision ${st.revision})`);
}
