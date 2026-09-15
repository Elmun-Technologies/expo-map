/**
 * UI smoke-test: ishlab turgan serverga qarshi ilovani jsdom'da ishga tushirib,
 * проверяет потоки: вход → выбор стенда/блока → продажа → конфликт → режим клиента.
 *
 *   npm install            # bir marta (jsdom)
 *   npm start              # boshqa oynada server
 *   npm run smoke
 *
 * ВНИМАНИЕ: тест продаёт стенды. Поэтому по умолчанию он работает в ОТДЕЛЬНОМ (временном) файле состояния
 * ishlaydi — haqiqiy data/state.json ga tegmaydi. Xohlasangiz BASE berib tirik serverga
 * на своём порту — реальное состояние не меняется.
 *
 *   npm run smoke              # izolyatsiya: o'zi server ko'taradi, o'zi tozalaydi
 *   BASE=http://localhost:4173 npm run smoke   # tirik serverga qarshi (ehtiyot bo'ling)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
const ROOT = path.resolve(APP, '..');
let BASE = process.env.BASE || null;
let child = null;
let tmpDir = null;

if (!BASE) {
  // izolyatsiya: haqiqiy holatning NUSXASI bilan alohida portda server ko'taramiz
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-smoke-'));
  const tmpState = path.join(tmpDir, 'state.json');
  fs.copyFileSync(path.join(ROOT, 'data/state.json'), tmpState);
  const port = Number(process.env.SMOKE_PORT || 4293);
  child = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), STATE: tmpState },
    stdio: 'ignore',
  });
  BASE = `http://localhost:${port}`;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(BASE + '/api/healthz'); if (r.ok) break; } catch { /* hali ko'tarilmadi */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`ℹ изоляция: временное состояние + порт ${port} (реальный state.json не затронут)`);
} else {
  console.warn('⚠ BASE berilgan — test HAQIQIY holatni o\'zgartiradi.');
}
const cleanup = () => {
  try { child?.kill('SIGTERM'); } catch { /* заглушка */ }
  try { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* заглушка */ }
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(APP, 'app.js'), 'utf8');
const groupsJs = fs.readFileSync(path.join(APP, 'groups.js'), 'utf8');
const css = fs.readFileSync(path.join(APP, 'style.css'), 'utf8');

// --- server tirikmi
try {
  const r = await fetch(BASE + '/api/healthz');
  if (!r.ok) throw new Error('healthz ' + r.status);
} catch (e) {
  console.error(`✗ Сервер не отвечает (${BASE}). Сначала запустите "npm start".`);
  process.exit(2);
}

// --- выбираем блок, где все стенды свободны (чтобы тест работал на любом состоянии)
const layout = await (await fetch(BASE + '/api/layout')).json();
let st = await (await fetch(BASE + '/api/state')).json();
// у нестандартных (custom) стендов ID не совпадает с ID блока — для теста нужен обычный блок
const gridBlocks = layout.blocks.filter((b) => b.kind !== 'custom');
let freeBlock = gridBlocks.find((b) => b.stands.every((s) => !st.items[s.id]));
if (!freeBlock) {
  // берём блок, где меньше всего занятых мест, и освобождаем их (права менеджера)
  const tok0 = (await (await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Менеджер', pin: '9999' }) })).json()).token;
  const cand = gridBlocks.map((b) => ({ b, booked: b.stands.filter((s) => st.items[s.id]) })).sort((x, y) => x.booked.length - y.booked.length)[0];
  if (cand.booked.length) {
    await fetch(BASE + '/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok0 },
      body: JSON.stringify({ action: 'release', standIds: cand.booked.map((s) => s.id) }),
    });
    st = await (await fetch(BASE + '/api/state')).json();
    console.log(`ℹ для теста освобождён блок ${cand.b.id} (${cand.booked.length} стендов)`);
  }
  freeBlock = cand.b;
}
const freeStand = layout.stands.find((s) => !st.items[s.id]);
if (!freeBlock || !freeStand) {
  console.error('✗ Нет полностью свободного блока — выполните "node tools/demo.mjs --reset" и повторите.');
  process.exit(2);
}
console.log(`ℹ тестовый блок: ${freeBlock.id}, тестовый стенд: ${freeStand.id}`);

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

// index.html'dagi skriptlar tartibi: avval groups.js, keyin app.js
window.eval(groupsJs);
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
assert(errors.length === 0, 'приложение загрузилось без ошибок' + (errors.length ? ' → ' + errors.join(' | ') : ''));
assert($('#hallTitle').textContent.includes(layout.meta.project) || $('#hallTitle').textContent.includes(layout.meta.hall),
  'план загружен: ' + $('#hallTitle').textContent);
// занятые места рисуются одной рамкой: стендов = свободные ячейки + стенды внутри рамок
const unitStands = $$('#world .booking-unit').flatMap((u) => u.dataset.ids.split(',').filter((id) => !id.includes('~m')));
const customUnitStands = unitStands.filter((id) => (layout.customStands || []).some((c) => c.id === id));
assert(!layout.customStands?.length
  || doc.querySelectorAll('#world .stand.custom').length + customUnitStands.length === layout.customStands.length,
  `nostandart stendlar chizildi (${doc.querySelectorAll('#world .stand.custom').length + customUnitStands.length}/${layout.customStands?.length || 0})`);
if ((layout.meta.status || 'draft') !== 'approved') {
  assert(!$('#draftBanner').hidden, 'баннер «ЧЕРНОВИК» показан');
}
assert($$('#world .stand').length + unitStands.length === layout.stands.length,
  `на плане ${layout.stands.length} стендов (свободных ячеек ${$$('#world .stand').length} + внутри рамок ${unitStands.length})`);
assert($('#stats').textContent.includes('свободно'), 'статистика показана');

// --- login
$('#loginName').value = 'Aziz Karimov';
$('#loginPin').value = '1111';
fire($('#loginForm'), 'submit');
await tick(600);
assert($('#who').textContent.includes('Aziz'), 'вход выполнен: ' + $('#who').textContent.trim());

// --- выбор одного стенда
clickMap($$('#world .stand').find((g) => g.dataset.id === freeStand.id));
await tick();
assert(!$('#selBody').hidden, 'при клике на стенд открылась панель выбора');
assert($('#selTitle').textContent.includes(freeStand.blockId), 'блок выбора: ' + $('#selTitle').textContent);
assert($('#selInfo').textContent.includes('9 м²'), 'показано 9 м²');
assert($('#btnSell').disabled === false, 'кнопка «Продать» активна');

// --- клик по ярлыку блока = весь блок (8 × 9 = 72 м²)
$('#clearSel').click();
await tick(50);
clickMap($$('#world .block-chip').find((c) => c.dataset.block === freeBlock.id), 2);
await tick();
const fbArea = freeBlock.stands.reduce((a, s) => a + s.areaM2, 0);
const fbAreaTxt = fbArea.toLocaleString('ru-RU').replace(/\u00A0/g, ' ');
assert($('#selChips').children.length === freeBlock.stands.length, `при клике на блок выбрано ${freeBlock.stands.length} стендов (${$('#selChips').children.length})`);
assert($('#selInfo').textContent.replace(/\s+/g, ' ').includes(`${freeBlock.stands.length} стендов · ${fbAreaTxt} м²`),
  'площадь блока показана: ' + $('#selInfo').textContent.replace(/\s+/g, ' ').slice(0, 90));

// --- sotish oqimi
$('#buyer').value = 'Smoke Test MChJ';
$('#phone').value = '+998900000000';
$('#btnSell').click();
await tick(200);
assert(!$('#confirm').hidden, 'окно подтверждения показано');
assert($('#confirmBody').textContent.includes(freeBlock.stands[0].id), 'в окне подтверждения показаны ID стендов');
$('#confirmOk').click();
await tick(900);
assert(!$('#receipt').hidden, 'квитанция о продаже показана');
assert($('#receipt').textContent.includes('Smoke Test MChJ'), 'в квитанции есть имя клиента');
assert($('#receipt').textContent.replace(/\u00A0/g, ' ').includes(`${fbAreaTxt} м²`), 'в квитанции площадь блока');
assert(errors.length === 0, 'после продажи ошибок нет' + (errors.length ? ' → ' + errors.join(' | ') : ''));

st = await (await fetch(BASE + '/api/state')).json();
const sold = Object.values(st.items).filter((i) => i.blockId === freeBlock.id && i.status === 'sold');
assert(sold.length === freeBlock.stands.length, `на сервере все ${freeBlock.stands.length} стендов блока ${freeBlock.id} — "sold" (${sold.length})`);

// --- одна компания = ОДНА рамка на плане, название внутри
const unit = $$('#world .booking-unit').find((u) => u.dataset.ids.split(',').includes(freeBlock.stands[0].id));
assert(!!unit, 'занятое место стало одной рамкой (.booking-unit)');
assert(unit.dataset.ids.split(',').length === freeBlock.stands.length,
  `quti butun guruhni o\'z ichiga oldi (${unit.dataset.ids.split(',').length}/${freeBlock.stands.length})`);
const unitText = unit.textContent.replace(/\s+/g, ' ');
assert(unitText.includes('Smoke Test MChJ'), 'название компании написано ВНУТРИ рамки: ' + unitText.slice(0, 60));
assert($$('#world .stand').every((g) => !g.dataset.id.startsWith(freeBlock.id + '-')), 'занятые стенды не остались отдельными ячейками');
const row = $$('#bookingsList .booking-row').find((r) => r.textContent.includes('Smoke Test MChJ'));
assert(!!row, 'в списке занятых мест тоже одна строка');
assert(row.textContent.replace(/\s+/g, ' ').includes(`${freeBlock.stands.length} стендов`), 'в строке количество стендов одним числом');

// --- для проданного блока кнопка «Продать» заблокирована
$('#clearSel').click();
await tick(50);
clickMap($$('#world .block-chip').find((c) => c.dataset.block === freeBlock.id), 3);
await tick(150);
assert($('#btnSell').disabled === true, 'для проданного блока кнопка «Продать» отключена');
assert($('#selInfo').textContent.includes('Свободно'), 'для занятого блока показано «свободно 0»');

// --- boshqa sotuvchi bir vaqtda xuddi shu joyni sotmoqchi: server rad etadi
const tok2 = (await (await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Dilnoza Yusupova', pin: '2222' }) })).json()).token;
const r409 = await fetch(BASE + '/api/action', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok2 },
  body: JSON.stringify({ action: 'sell', standIds: freeBlock.stands.slice(0, 2).map((s) => s.id), buyer: 'Второй клиент' }),
});
const j409 = await r409.json();
assert(r409.status === 409 && j409.error === 'conflict', `одновременная продажа отклонена (${r409.status}: ${j409.message})`);
assert(j409.conflicts[0].buyer === 'Smoke Test MChJ', 'видно, кто продал: ' + JSON.stringify(j409.conflicts[0]));

// --- режим клиента
const dom2 = new JSDOM(html, { url: BASE + '/?mode=client', runScripts: 'outside-only', pretendToBeVisual: true });
dom2.window.fetch = (p, o) => fetch(new URL(p, BASE), o);
dom2.window.SVGElement.prototype.createSVGPoint = mkPoint;
dom2.window.SVGElement.prototype.getScreenCTM = () => ({ inverse: () => ({}) });
// index.html'dagi skriptlar tartibi: avval groups.js, keyin app.js
dom2.window.eval(groupsJs);
dom2.window.eval(appJs);
await new Promise((r) => setTimeout(r, 800));
const d2 = dom2.window.document;
assert(d2.querySelector('#login').style.display === 'none', 'в режиме клиента нет формы входа');
const drawnStands = d2.querySelectorAll('#world .stand').length;
const drawnUnits = d2.querySelectorAll('#world .booking-unit').length;
assert(drawnStands + drawnUnits > 0 && drawnUnits > 0, `в режиме клиента план нарисован (${drawnStands} свободных стендов + ${drawnUnits} рамок занятых мест)`);
assert(d2.querySelector('#stats').textContent.includes('продано'), 'в режиме клиента статистика видна');

window.close();
dom2.window.close();
console.log(failed ? `\nSMOKE: провалено проверок — ${failed}` : '\nSMOKE: всё пройдено');
process.exit(failed ? 1 : 0);
