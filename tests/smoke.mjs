/**
 * UI smoke-test: ishlab turgan serverga qarshi ilovani jsdom'da ishga tushirib,
 * login → stend/blok tanlash → sotish → konflikt → mijoz rejimi oqimlarini tekshiradi.
 *
 *   npm install            # bir marta (jsdom)
 *   npm start              # boshqa oynada server
 *   npm run smoke
 *
 * DIQQAT: test haqiqiy holatni o'zgartiradi — bo'sh blok sotiladi.
 * Demo holatni tiklash: node tools/demo.mjs --reset
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
const BASE = process.env.BASE || 'http://localhost:4173';

const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(APP, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(APP, 'style.css'), 'utf8');

// --- server tirikmi
try {
  const r = await fetch(BASE + '/api/healthz');
  if (!r.ok) throw new Error('healthz ' + r.status);
} catch (e) {
  console.error(`✗ Server javob bermayapti (${BASE}). Avval "npm start" qiling.`);
  process.exit(2);
}

// --- bo'sh blokni tanlaymiz (holat toza bo'lmasa ham test ishlashi uchun)
const layout = await (await fetch(BASE + '/api/layout')).json();
let st = await (await fetch(BASE + '/api/state')).json();
// nostandart (custom) bloklar stendi blok ID'si bilan bir xil bo'ladi — sinov uchun oddiy blok kerak
const gridBlocks = layout.blocks.filter((b) => b.kind !== 'custom');
let freeBlock = gridBlocks.find((b) => b.stands.every((s) => !st.items[s.id]));
if (!freeBlock) {
  // eng ko'p bo'sh joyi bor blokni bo'shatamiz (menejer huquqi bilan)
  const tok0 = (await (await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Menejer', pin: '9999' }) })).json()).token;
  const cand = gridBlocks.map((b) => ({ b, booked: b.stands.filter((s) => st.items[s.id]) })).sort((x, y) => x.booked.length - y.booked.length)[0];
  if (cand.booked.length) {
    await fetch(BASE + '/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok0 },
      body: JSON.stringify({ action: 'release', standIds: cand.booked.map((s) => s.id) }),
    });
    st = await (await fetch(BASE + '/api/state')).json();
    console.log(`ℹ sinov uchun ${cand.b.id} bloki bo'shatildi (${cand.booked.length} stend)`);
  }
  freeBlock = cand.b;
}
const freeStand = layout.stands.find((s) => !st.items[s.id]);
if (!freeBlock || !freeStand) {
  console.error('✗ Butunlay bo\'sh blok yo\'q — "node tools/demo.mjs --reset" qilib qayta urinib ko\'ring.');
  process.exit(2);
}
console.log(`ℹ sinov bloki: ${freeBlock.id}, sinov stendi: ${freeStand.id}`);

const dom = new JSDOM(html, { url: BASE + '/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const doc = window.document;

// ---- polyfills (jsdom'da yo'q)
window.fetch = (p, o) => fetch(new URL(p, BASE), o);
const mkPoint = () => ({ x: 0, y: 0, matrixTransform: () => ({ x: 0, y: 0 }) });
window.SVGElement.prototype.createSVGPoint = mkPoint;
window.SVGElement.prototype.getScreenCTM = () => ({ inverse: () => ({}) });
window.Element.prototype.setPointerCapture = () => {};
window.Element.prototype.releasePointerCapture = () => {};
let hitEl = null;
doc.elementFromPoint = () => hitEl;
const styleEl = doc.createElement('style');
styleEl.textContent = css;
doc.head.appendChild(styleEl);

// ---- xatolarni ushlash
const errors = [];
window.addEventListener('error', (e) => errors.push('window.error: ' + (e.error?.stack || e.message)));
window.onunhandledrejection = (e) => errors.push('unhandled: ' + (e.reason?.stack || e.reason));
const nativeErr = console.error;
console.error = (...a) => { errors.push('console.error: ' + a.join(' ')); nativeErr(...a); };

window.eval(appJs);

const tick = (ms = 120) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const assert = (cond, msg) => { if (!cond) { failed++; console.log('✗ ' + msg); } else console.log('✓ ' + msg); };
const $$ = (s) => [...doc.querySelectorAll(s)];
const $ = (s) => doc.querySelector(s);
const fire = (el, type, props = {}) => {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, props);
  el.dispatchEvent(ev);
};
const clickMap = (el, pointerId = 1) => {
  hitEl = el;
  fire($('#map'), 'pointerdown', { button: 0, clientX: 100, clientY: 100, pointerId });
  fire($('#map'), 'pointerup', { button: 0, clientX: 100, clientY: 100, pointerId });
};

await tick(600);
assert(errors.length === 0, 'ilova xatosiz yuklandi' + (errors.length ? ' → ' + errors.join(' | ') : ''));
assert($('#hallTitle').textContent.includes(layout.meta.project) || $('#hallTitle').textContent.includes(layout.meta.hall),
  'layout yuklandi: ' + $('#hallTitle').textContent);
assert(!layout.customStands?.length || doc.querySelectorAll('#world .stand.custom').length === layout.customStands.length,
  `nostandart stendlar chizildi (${doc.querySelectorAll('#world .stand.custom').length}/${layout.customStands?.length || 0})`);
if ((layout.meta.status || 'draft') !== 'approved') {
  assert(!$('#draftBanner').hidden, 'QORALAMA banneri ko\'rsatildi');
}
assert($$('#world .stand').length === layout.stands.length, `xaritada ${layout.stands.length} stend chizildi (${$$('#world .stand').length})`);
assert($('#stats').textContent.includes("bo'sh"), 'statistika ko\'rsatildi');

// --- login
$('#loginName').value = 'Aziz Karimov';
$('#loginPin').value = '1111';
fire($('#loginForm'), 'submit');
await tick(600);
assert($('#who').textContent.includes('Aziz'), 'login ishladi: ' + $('#who').textContent.trim());

// --- bitta stend tanlash
clickMap($$('#world .stand').find((g) => g.dataset.id === freeStand.id));
await tick();
assert(!$('#selBody').hidden, 'stend bosilganda tanlov paneli ochildi');
assert($('#selTitle').textContent.includes(freeStand.blockId), 'tanlov bloki: ' + $('#selTitle').textContent);
assert($('#selInfo').textContent.includes('9 m²'), '9 m² ko\'rsatildi');
assert($('#btnSell').disabled === false, 'tanlovda "Sotish" tugmasi faol');

// --- blok yorlig'i bosilganda butun blok (8 × 9 = 72 m²)
$('#clearSel').click();
await tick(50);
clickMap($$('#world .block-chip').find((c) => c.dataset.block === freeBlock.id), 2);
await tick();
const fbArea = freeBlock.stands.reduce((a, s) => a + s.areaM2, 0);
const fbAreaTxt = fbArea.toLocaleString('ru-RU').replace(/\u00A0/g, ' ');
assert($('#selChips').children.length === freeBlock.stands.length, `blok bosilganda ${freeBlock.stands.length} stend tanlandi (${$('#selChips').children.length})`);
assert($('#selInfo').textContent.replace(/\s+/g, ' ').includes(`${freeBlock.stands.length} stend · ${fbAreaTxt} m²`),
  'blok maydoni ko\'rsatildi: ' + $('#selInfo').textContent.replace(/\s+/g, ' ').slice(0, 90));

// --- sotish oqimi
$('#buyer').value = 'Smoke Test MChJ';
$('#phone').value = '+998900000000';
$('#btnSell').click();
await tick(200);
assert(!$('#confirm').hidden, 'tasdiqlash oynasi chiqdi');
assert($('#confirmBody').textContent.includes(freeBlock.stands[0].id), 'tasdiqlashda stend ID\'lari ko\'rsatildi');
$('#confirmOk').click();
await tick(900);
assert(!$('#receipt').hidden, 'sotuv kvitansiyasi chiqdi');
assert($('#receipt').textContent.includes('Smoke Test MChJ'), 'kvitansiyada mijoz ismi bor');
assert($('#receipt').textContent.replace(/\u00A0/g, ' ').includes(`${fbAreaTxt} m²`), 'kvitansiyada blok maydoni');
assert(errors.length === 0, 'sotuvdan keyin ham xato yo\'q' + (errors.length ? ' → ' + errors.join(' | ') : ''));

st = await (await fetch(BASE + '/api/state')).json();
const sold = Object.values(st.items).filter((i) => i.blockId === freeBlock.id && i.status === 'sold');
assert(sold.length === freeBlock.stands.length, `serverda ${freeBlock.id} ning ${freeBlock.stands.length} stendi "sold" (${sold.length})`);

// --- sotilgan blok qayta tanlanganda "Sotish" o'chirilgan
$('#clearSel').click();
await tick(50);
clickMap($$('#world .block-chip').find((c) => c.dataset.block === freeBlock.id), 3);
await tick(150);
assert($('#btnSell').disabled === true, 'sotilgan blok qayta tanlanganda "Sotish" o\'chirilgan');
assert($('#selInfo').textContent.includes("Bo'sh joy"), 'band blokda "bo\'sh joy 0" ko\'rsatildi');

// --- boshqa sotuvchi bir vaqtda xuddi shu joyni sotmoqchi: server rad etadi
const tok2 = (await (await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Dilnoza Yusupova', pin: '2222' }) })).json()).token;
const r409 = await fetch(BASE + '/api/action', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok2 },
  body: JSON.stringify({ action: 'sell', standIds: freeBlock.stands.slice(0, 2).map((s) => s.id), buyer: 'Ikkinchi mijoz' }),
});
const j409 = await r409.json();
assert(r409.status === 409 && j409.error === 'conflict', `bir vaqtda sotish urinishi rad etildi (${r409.status}: ${j409.message})`);
assert(j409.conflicts[0].buyer === 'Smoke Test MChJ', 'kim sotgani ko\'rsatildi: ' + JSON.stringify(j409.conflicts[0]));

// --- mijoz rejimi
const dom2 = new JSDOM(html, { url: BASE + '/?mode=client', runScripts: 'outside-only', pretendToBeVisual: true });
dom2.window.fetch = (p, o) => fetch(new URL(p, BASE), o);
dom2.window.SVGElement.prototype.createSVGPoint = mkPoint;
dom2.window.SVGElement.prototype.getScreenCTM = () => ({ inverse: () => ({}) });
dom2.window.eval(appJs);
await new Promise((r) => setTimeout(r, 800));
const d2 = dom2.window.document;
assert(d2.querySelector('#login').style.display === 'none', 'mijoz rejimida login yo\'q');
assert(d2.querySelectorAll('#world .stand').length === layout.stands.length, 'mijoz rejimida xarita chizildi');
assert(d2.querySelector('#stats').textContent.includes('sotilgan'), 'mijoz rejimida statistika ko\'rinadi');

window.close();
dom2.window.close();
console.log(failed ? `\nSMOKE: ${failed} ta tekshiruv yiqildi` : '\nSMOKE: hammasi o\'tdi');
process.exit(failed ? 1 : 0);
