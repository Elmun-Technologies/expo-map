#!/usr/bin/env node
/**
 * Проверка «чистоты» плана: находит НАЛОЖЕНИЯ ТЕКСТОВ друг на друга.
 *
 *   node tools/check-overlaps.mjs out/app-map.svg
 *   node tools/check-overlaps.mjs exports/foodera-2026/01-план-зала-весь.svg
 *
 * Работает и с картой из приложения (единицы — метры, размеры шрифта в CSS-классах),
 * и с экспортным SVG (единицы — пиксели, размер шрифта в атрибуте font-size).
 * Ширина текста считается тем же способом, что и в app/groups.js / tools/export-svg.mjs,
 * поэтому результат совпадает с тем, что видно глазами.
 *
 * Код возврата 1 — если найдены наложения (удобно для CI).
 */
import fs from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('Использование: node tools/check-overlaps.mjs <svg>'); process.exit(2); }
const svg = fs.readFileSync(file, 'utf8');

// ------------------------------------------------ ширина текста (как в движке)
const NARROW = /[ijltfrI.,:;!|'"`()[\]{}\-–—•·]/;
const WIDE = /[mwMWШЩшщюЮМФ]/;
const UPPER = /[A-ZА-ЯЁҚҒҲЎ]/;
function charWidth(ch) {
  if (ch === ' ') return 0.318;
  if (ch >= '0' && ch <= '9') return 0.636;
  if (NARROW.test(ch)) return 0.38;
  if (WIDE.test(ch)) return 0.9;
  if (UPPER.test(ch)) return 0.7;
  return 0.56;
}
function textWidth(text, fs, bold) {
  const s = String(text ?? '');
  let w = 0;
  for (const ch of s) w += charWidth(ch);
  return w * fs * (bold ? 1.05 : 1) + s.length * fs * 0.02;
}

// ------------------------------------------------ размеры шрифта из <style>
const cssFs = {};
for (const m of svg.matchAll(/\.([A-Za-z0-9_-]+)[^{}]*\{([^}]*)\}/g)) {
  const fm = /font-size:\s*([\d.]+)px/.exec(m[2]);
  if (fm && cssFs[m[1]] === undefined) cssFs[m[1]] = Number(fm[1]);
}
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');

// ------------------------------------------------ все <text>
const boxes = [];
for (const m of svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)) {
  const attrs = m[1];
  const text = decode(m[2]).trim();
  if (!text) continue;
  const attr = (n) => { const r = new RegExp(`\\b${n}="([^"]*)"`).exec(attrs); return r ? r[1] : null; };
  const cls = attr('class') || '';
  const style = attr('style') || '';
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  let fs = num(/(^|;)\s*font-size:\s*([\d.]+)px/.exec(style)?.[2]) || num(attr('font-size'));
  if (!fs) fs = cssFs[cls.split(/\s+/)[0]] ?? 1.15;
  const x = num(attr('x')) ?? 0;
  const y = num(attr('y')) ?? 0;
  const anchor = /text-anchor="middle"/.test(attrs) || /text-anchor:\s*middle/.test(style) || /text-anchor:\s*middle/.test(cssRule(cls))
    ? 'middle'
    : /text-anchor="end"/.test(attrs) ? 'end' : 'start';
  const bold = /font-weight="(bold|[6-9]00)"/.test(attrs) || /font-weight:\s*(bold|[6-9]00)/.test(style + cssRule(cls));
  const ls = num(/(^|;)\s*letter-spacing:\s*([\d.]+)px/.exec(style)?.[2]) || num(attr('letter-spacing'))
    || (Number(/(^|;)\s*letter-spacing:\s*([\d.]+)px/.exec(cssRule(cls))?.[2]) || 0);
  const w = textWidth(text, fs, bold) + ls * text.length;
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  boxes.push({ text, fs, x0, x1: x0 + w, y0: y - fs * 0.78, y1: y + fs * 0.24, cls });
}
function cssRule(cls) {
  if (!cls) return '';
  const out = [];
  for (const m of svg.matchAll(new RegExp(`\\.${cls.split(/\\s+/)[0]}[^{}]*\\{([^}]*)\\}`, 'g'))) out.push(m[1]);
  return out.join(';');
}

// ------------------------------------------------ поиск наложений
const unit = Math.max(...boxes.map((b) => Math.abs(b.y1 - b.y0)), 1) > 50 ? 'px' : 'м';
const px = unit === 'px' ? 1 : 0.02;
const hits = [];
for (let i = 0; i < boxes.length; i++) {
  for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (ox <= px || oy <= px) continue;
    const minH = Math.min(a.y1 - a.y0, b.y1 - b.y0);
    if (oy < minH * 0.25) continue;                    // касание базовой линии — не наложение
    hits.push({ a, b, ox, oy });
  }
}
// уникальные пары по тексту (одно и то же имя в соседних ячейках не дублируем)
const seen = new Set();
const uniq = hits.filter((h) => {
  const k = [h.a.text, h.b.text].sort().join('|') + '|' + Math.round(h.a.x0 / (px * 10)) + '|' + Math.round(h.a.y0 / (px * 10));
  if (seen.has(k)) return false;
  seen.add(k); return true;
});

console.log(`${file}: текстовых подписей ${boxes.length}, наложений ${uniq.length}`);
for (const h of uniq.sort((p, q) => q.ox * q.oy - p.ox * p.oy).slice(0, 40)) {
  console.log(`  ✗ «${h.a.text}» ↔ «${h.b.text}»  (пересечение ${h.ox.toFixed(1)}×${h.oy.toFixed(1)} ${unit})`);
}
if (uniq.length) process.exitCode = 1;
