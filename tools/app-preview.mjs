#!/usr/bin/env node
/**
 * Предпросмотр плана ИЗ ПРИЛОЖЕНИЯ (то, что видит продавец) — без браузера.
 *
 *   node tools/app-preview.mjs [out.png] [width]
 *
 * Загружает app/index.html в jsdom, ждёт отрисовки карты, забирает <svg id="map">
 * вместе с CSS и рендерит в PNG (resvg). Нужен, чтобы проверять, что на плане
 * ничего не наезжает друг на друга.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { Resvg } from '@resvg/resvg-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || '/tmp/app-preview.png';
const WIDTH = Number(process.argv[3] || 2200);
const PORT = 4398;
const BASE = `http://127.0.0.1:${PORT}`;

// если порт уже занят прошлым запуском, рисуем по СТАРОМУ серверу — об этом лучше узнать сразу
try {
  await fetch(BASE + '/api/healthz');
  console.error(`✗ порт ${PORT} уже занят другим сервером — остановите его (иначе предпросмотр будет устаревшим)`);
  process.exit(1);
} catch { /* порт свободен — как и должно быть */ }

const srv = spawn('node', [path.join(ROOT, 'server.mjs')], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' }, stdio: 'ignore',
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 40; i++) { try { await fetch(BASE + '/api/healthz'); break; } catch { await wait(150); } }

const html = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
const dom = new JSDOM(html.replace(/<script[^>]*><\/script>/g, '').replace(/<link[^>]*>/, ''), {
  url: BASE + '/', runScripts: 'outside-only', pretendToBeVisual: true,
});
const { window } = dom;
// полифиллы (в jsdom их нет)
window.fetch = (p, o) => fetch(new URL(p, BASE), o);
window.SVGElement.prototype.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform: () => ({ x: 0, y: 0 }) });
window.SVGElement.prototype.getScreenCTM = () => ({ inverse: () => ({}) });
window.Element.prototype.setPointerCapture = () => {};
window.Element.prototype.releasePointerCapture = () => {};
window.eval(fs.readFileSync(path.join(ROOT, 'app/groups.js'), 'utf8'));
window.eval(fs.readFileSync(path.join(ROOT, 'app/app.js'), 'utf8'));
await wait(2500);

// — проверяем также печатную шапку (то, что уходит на бумагу/в PDF)
if (process.argv.includes('--print')) {
  const w2 = window;
  w2.dispatchEvent(new w2.Event('beforeprint'));
  const head = w2.document.querySelector('#printHead');
  const text = head ? head.textContent.replace(/\s+/g, ' ').trim() : '(нет #printHead)';
  const sheet = w2.document.querySelector('#printSheet');
  console.log('── печатная шапка: ' + text);
  console.log('── таблицы на листе: ' + (sheet ? sheet.querySelectorAll('table').length : 0) + ' шт., body.print-tables = ' + w2.document.body.classList.contains('print-tables'));
  const page = w2.document.querySelector('#printPage');
  const pageSvg = page?.querySelector('svg');
  console.log('── лист печати: ' + (pageSvg ? `${pageSvg.style.width} × ${pageSvg.style.height}` : '(не готов)')
    + ' | классы body: ' + (w2.document.body.className || '—'));
}

const svg = window.document.querySelector('#map');
if (!svg || !svg.querySelectorAll('.stand, .booking-unit').length) {
  console.error('✗ карта не отрисовалась'); srv.kill('SIGKILL'); process.exit(1);
}
svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
const css = fs.readFileSync(path.join(ROOT, 'app/style.css'), 'utf8');
const inner = svg.innerHTML;
const vb = (svg.getAttribute('viewBox') || '0 0 96 50').split(/\s+/).map(Number);
// width/height задаём явно: у resvg не всегда срабатывает fitTo, а атрибуты дают нужный масштаб
const outH = Math.round((WIDTH * vb[3]) / vb[2]);
const wrapped = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${outH}" viewBox="${vb.join(' ')}" font-family="DejaVu Sans, Arial, sans-serif">
<style>${css}</style><rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="#fff"/>${inner}</svg>`;
const tmp = '/tmp/app-map-inline.svg';
fs.writeFileSync(tmp, wrapped);
const r = new Resvg(wrapped, { fitTo: { mode: 'width', value: WIDTH }, font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' } });
fs.writeFileSync(OUT, r.render().asPng());
console.log(`✓ ${OUT} — ${r.width}×${r.height}px (стендов: ${svg.querySelectorAll('.stand').length}, занятых мест: ${svg.querySelectorAll('.booking-unit').length})`);
srv.kill('SIGKILL');
process.exit(0);
