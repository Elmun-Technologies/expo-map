#!/usr/bin/env node
/**
 * Проверка «чистоты» листа: каждая подпись должна помещаться в свою ячейку
 * (с запасом) и не выходить за границы плана — это те самые «затики», из-за
 * которых надпись упирается в рамку соседней ячейки.
 *
 *   node tools/check-fit.mjs exports/foodera-2026/01-план-зала-весь.svg
 *
 * Код возврата 1 — есть подписи, которые не помещаются.
 */
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2] || 'exports/foodera-2026/01-план-зала-весь.svg';
const svg = fs.readFileSync(file, 'utf8');

// --- ширина текста: точные метрики DejaVu Sans, если есть файл метрик ---
// (python3 tools/font-metrics.py > /tmp/dejavu.json), иначе — та же оценка, что в экспорте
const METRICS_PATH = process.env.FONT_METRICS || path.join(process.cwd(), 'tools/dejavu-metrics.json');
let METRICS = null;
try { METRICS = JSON.parse(fs.readFileSync(METRICS_PATH, 'utf8')); } catch { METRICS = null; }

const NARROW = new Set('iljI.,:;\'|![]()');
const WIDE = new Set('mwMWШЩЮ@%');
function charWidth(ch, fs, bold) {
  const table = METRICS?.fonts?.[bold ? 'bold' : 'regular'];
  if (table) {
    const w = table[ch];
    if (w != null) return w * fs;
    return 0.6 * fs; // символа нет в шрифте — консервативная оценка
  }
  const k = bold ? 1.04 : 1;
  if (NARROW.has(ch)) return 0.34 * fs * k;
  if (WIDE.has(ch)) return 0.92 * fs * k;
  if (ch === ' ') return 0.31 * fs;
  if (ch >= 'A' && ch <= 'Z') return 0.68 * fs * k;
  if (/[0-9]/.test(ch)) return 0.6 * fs * k;
  if (ch >= 'А' && ch <= 'я') return 0.64 * fs * k;
  return 0.56 * fs * k;
}
// та же формула, что в app/groups.js: +1 % на кернинг и 0,02 em на символ
const textWidth = (t, fs, bold) => {
  const s = String(t);
  let w = 0;
  for (const ch of s) w += charWidth(ch, fs, bold);
  return w * 1.01 + s.length * fs * 0.02;
};

// --- прямоугольники-«вместилища»: ячейки стендов, объединённые места, зоны, фичи ---
const boxes = [];
for (const m of svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"([^>]*)>/g)) {
  const [, x, y, w, h, rest] = m;
  const W = +w, H = +h;
  // интересуют небольшие ячейки (стенды 3×3 м и подобные) — крупные заливки пропускаем
  if (W < 4 || H < 4 || W > 120 || H > 120) continue;
  if (/fill="#ffffff"/.test(rest) && W > 60) continue;
  boxes.push({ x: +x, y: +y, w: W, h: H });
}
for (const m of svg.matchAll(/<path d="M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)Z"/g)) {
  const xs = [+m[1], +m[3], +m[5], +m[7]], ys = [+m[2], +m[4], +m[6], +m[8]];
  const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
  if (w >= 4 && h >= 4 && w <= 120 && h <= 120) boxes.push({ x, y, w, h });
}

// --- подписи ---
const problems = [];
let checked = 0;
for (const m of svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)) {
  const [, xs, ys, fss, textRaw] = m;
  const text = textRaw.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  if (!text.trim()) continue;
  const fs2 = +fss, x = +xs, y = +ys;
  const bold = /font-weight="bold"/.test(m[0]);
  const w = textWidth(text, fs2, bold);
  const mid = /text-anchor="middle"/.test(m[0]);
  const end = /text-anchor="end"/.test(m[0]);
  const left = mid ? x - w / 2 : end ? x - w : x;
  const right = left + w;
  const top = y - fs2 * 0.82, bottom = y + fs2 * 0.26;

  // ближайшая ячейка, внутри которой лежит центр подписи
  const cx = (left + right) / 2, cy = (top + bottom) / 2;
  const host = boxes.filter((b) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h)
    .sort((a, b) => a.w * a.h - b.w * b.h)[0];
  if (!host) continue;
  checked++;
  const pad = 1.0;   // подпись должна не просто влезать, а не упираться в рамку
  const over = [];
  if (left < host.x + pad) over.push(`слева на ${(host.x + pad - left).toFixed(1)} px`);
  if (right > host.x + host.w - pad) over.push(`справа на ${(right - host.x - host.w + pad).toFixed(1)} px`);
  if (top < host.y + pad) over.push(`сверху на ${(host.y + pad - top).toFixed(1)} px`);
  if (bottom > host.y + host.h - pad) over.push(`снизу на ${(bottom - host.y - host.h + pad).toFixed(1)} px`);
  if (over.length) problems.push({ text, fs: fs2, box: host, over });
}

console.log(`проверено подписей: ${checked} · не помещаются: ${problems.length}`);
for (const p of problems.slice(0, 25)) {
  console.log(`  ✗ «${p.text}» (${p.fs} px) — ${p.over.join(', ')} [ячейка ${p.box.w.toFixed(1)}×${p.box.h.toFixed(1)}]`);
}
if (problems.length > 25) console.log(`  … и ещё ${problems.length - 25}`);
process.exit(problems.length ? 1 : 0);
