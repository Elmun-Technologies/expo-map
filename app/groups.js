/*
 * ОБЪЕДИНЕНИЕ занятых мест.
 *
 * Правило (требование клиента): сколько бы стендов ни заняла одна компания
 * (9, 18, 36 м² или целый блок) — на плане это не отдельные ячейки, а ОДНА общая
 * рамка, и название компании пишется внутри неё.
 *
 * Группа = один клиент (компания) + один статус (бронь/продано) + стенды,
 * примыкающие друг к другу сторонами. Если клиента нет (стенд свободен) — группы нет.
 *
 * Файл используется в двух местах:
 *   - браузер: app/index.html → <script src="./groups.js"> (window.ExpoGroups)
 *   - Node:    через lib/groups.mjs (export-svg, package, server)
 * Поэтому здесь только чистые вычисления, без DOM.
 */
(function (root) {
  'use strict';
  const EPS = 0.02;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const span = (a1, a2, b1, b2) => Math.min(a2, b2) - Math.max(a1, b1);

  /** Примыкают ли два прямоугольника сторонами (не углами). */
  function touches(a, b) {
    const vOverlap = span(a.y, a.y + a.h, b.y, b.y + b.h) > EPS;
    const hOverlap = span(a.x, a.x + a.w, b.x, b.x + b.w) > EPS;
    if (Math.abs(a.x + a.w - b.x) < EPS || Math.abs(b.x + b.w - a.x) < EPS) return vOverlap;
    if (Math.abs(a.y + a.h - b.y) < EPS || Math.abs(b.y + b.h - a.y) < EPS) return hOverlap;
    return false;
  }

  const unitKey = (it) => `${it.status}|${String(it.company || it.buyer || '').trim().toLowerCase()}`;

  /**
   * Раскладывает занятые стенды по группам.
   * @param {Array} stands — layout.stands (id, x, y, w, h, areaM2, blockId, section, ...)
   * @param {Object} items — standId -> {status, buyer, company, phone, ...}
   * @returns {Array} группы: {ids, stands, x, y, w, h, areaM2, label, status, ...}
   */
  function groupBookings(stands, items) {
    const booked = stands.filter((s) => items[s.id] && items[s.id].status && items[s.id].status !== 'free');
    const used = new Set();
    const out = [];
    for (const s of booked) {
      if (used.has(s.id)) continue;
      const key = unitKey(items[s.id]);
      const stack = [s];
      const mem = [s];
      used.add(s.id);
      while (stack.length) {
        const cur = stack.pop();
        for (const o of booked) {
          if (used.has(o.id)) continue;
          if (unitKey(items[o.id]) !== key) continue;
          if (!touches(cur, o)) continue;
          used.add(o.id);
          stack.push(o);
          mem.push(o);
        }
      }
      mem.sort((a, b) => a.y - b.y || a.x - b.x);
      out.push(makeCluster(mem, items));
    }
    return out.sort((a, b) => a.y - b.y || a.x - b.x);
  }

  function makeCluster(mem, items) {
    const x = Math.min(...mem.map((s) => s.x));
    const y = Math.min(...mem.map((s) => s.y));
    const x2 = Math.max(...mem.map((s) => s.x + s.w));
    const y2 = Math.max(...mem.map((s) => s.y + s.h));
    const it = items[mem[0].id] || {};
    const ids = mem.map((s) => s.id);
    const label = String(it.company || it.buyer || '').trim();
    return {
      ids,
      stands: mem,
      x, y, w: x2 - x, h: y2 - y,
      areaM2: mem.reduce((a, s) => a + (s.areaM2 || 0), 0),
      status: it.status || 'sold',
      label,
      buyer: it.buyer || '',
      company: it.company || '',
      phone: it.phone || '',
      sellerName: it.sellerName || '',
      note: it.note || '',
      blockIds: [...new Set(mem.map((s) => s.blockId))],
      section: mem[0].section || null,
    };
  }

  /**
   * ВНЕШНИЙ контур объединённых ячеек (один замкнутый многоугольник).
   * Внутренние границы исчезают — получается одна рамка.
   * @returns {string} SVG path ("M…Z")
   */
  function unionPath(cells) {
    const keyOf = (a, b) => `${r3(a[0])},${r3(a[1])}>${r3(b[0])},${r3(b[1])}`;
    const edges = new Map();
    for (const c of cells) {
      const p = [[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x, c.y + c.h]];
      for (let i = 0; i < 4; i++) {
        const a = p[i], b = p[(i + 1) % 4];
        const opposite = keyOf(b, a);
        if (edges.has(opposite)) edges.delete(opposite);      // umumiy qirra — ichki, olib tashlanadi
        else edges.set(keyOf(a, b), [a, b]);
      }
    }
    const from = new Map();                                  // nuqta -> chiqish qirralari kalitlari
    for (const [k, [a]] of edges) {
      const pt = `${r3(a[0])},${r3(a[1])}`;
      if (!from.has(pt)) from.set(pt, []);
      from.get(pt).push(k);
    }
    const polys = [];
    const done = new Set();
    for (const startKey of edges.keys()) {
      if (done.has(startKey)) continue;
      const pts = [];
      let k = startKey;
      let guard = 0;
      while (k && !done.has(k) && guard++ < 10000) {
        done.add(k);
        const [a, b] = edges.get(k);
        pts.push(a);
        const nextPt = `${r3(b[0])},${r3(b[1])}`;
        const outs = (from.get(nextPt) || []).filter((x) => !done.has(x));
        if (!outs.length) { k = null; break; }
        // eng "to'g'ri" davomini tanlaymiz (burilishni kamaytiradi)
        const cur = { x: b[0] - a[0], y: b[1] - a[1] };
        outs.sort((x, y) => {
          const e1 = edges.get(x), e2 = edges.get(y);
          const d1 = { x: e1[1][0] - e1[0][0], y: e1[1][1] - e1[0][1] };
          const d2 = { x: e2[1][0] - e2[0][0], y: e2[1][1] - e2[0][1] };
          return (cur.x * d2.x + cur.y * d2.y) - (cur.x * d1.x + cur.y * d1.y);
        });
        k = outs[0];
      }
      if (pts.length >= 3) polys.push(pts);
    }
    return polys.map((p) => 'M' + p.map((q) => `${r3(q[0])} ${r3(q[1])}`).join('L') + 'Z').join('');
  }

  /**
   * НАИБОЛЬШИЙ прямоугольник внутри объединения — сюда пишется название
   * (чтобы в Г-образных группах имя не вылезало в соседнюю пустую ячейку).
   * Считается с шагом 0,25 м.
   */
  function largestRect(cells, step) {
    if (!cells.length) return { x: 0, y: 0, w: 0, h: 0, area: 0 };
    const s = step || 0.25;
    const x0 = Math.min(...cells.map((c) => c.x));
    const y0 = Math.min(...cells.map((c) => c.y));
    const x1 = Math.max(...cells.map((c) => c.x + c.w));
    const y1 = Math.max(...cells.map((c) => c.y + c.h));
    const nx = Math.max(1, Math.round((x1 - x0) / s));
    const ny = Math.max(1, Math.round((y1 - y0) / s));
    const grid = [];
    for (let i = 0; i < nx; i++) {
      const col = [];
      for (let j = 0; j < ny; j++) {
        const mx = x0 + (i + 0.5) * s, my = y0 + (j + 0.5) * s;
        col.push(cells.some((c) => mx > c.x + 1e-6 && mx < c.x + c.w - 1e-6 && my > c.y + 1e-6 && my < c.y + c.h - 1e-6) ? 1 : 0);
      }
      grid.push(col);
    }
    const heights = new Array(nx).fill(0);
    let best = { area: 0, x: x0, y: y0, w: 0, h: 0 };
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) heights[i] = grid[i][j] ? heights[i] + 1 : 0;
      const stack = [];
      for (let i = 0; i <= nx; i++) {
        const cur = i === nx ? 0 : heights[i];
        while (stack.length && heights[stack[stack.length - 1]] >= cur) {
          const hh = heights[stack.pop()];
          const left = stack.length ? stack[stack.length - 1] + 1 : 0;
          const ww = i - left;
          if (hh * ww > best.area) best = { area: hh * ww, x: x0 + left * s, y: y0 + (j - hh + 1) * s, w: ww * s, h: hh * s };
        }
        stack.push(i);
      }
    }
    return best;
  }

  /**
   * «Объединённые ячейки» схемы (компания объединила несколько стендов)
   * группируются так же, как обычные стенды — одна рамка, одно название.
   */
  function mergedAsStands(blocks) {
    const stands = [], items = {};
    for (const b of blocks || []) {
      (b.merged || []).forEach((m, i) => {
        if (!m.status && !m.buyer && !m.label) return;
        const id = `${b.id}~m${i}`;
        stands.push({ id, x: m.x, y: m.y, w: m.w, h: m.h, areaM2: m.w * m.h, blockId: b.id, section: b.section || null, label: m.label || id, mergedCell: true });
        items[id] = { status: m.status || 'sold', buyer: m.buyer || m.label || '', company: m.buyer || m.label || '' };
      });
    }
    return { stands, items };
  }

  /**
   * Ширина текста (в единицах em) — средние показатели DejaVu Sans / Arial.
   * Зачем: чтобы подписи не наезжали друг на друга, ширину текста нужно знать
   * ЗАРАНЕЕ (прежняя оценка «0,6 × число символов» занижала кириллицу,
   * и надписи накладывались).
   */
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
  /** Ширина текста в пикселях (или единицах SVG). При bold=true добавляется 5 %. */
  function textWidth(text, fs, bold) {
    const s = String(text ?? '');
    let w = 0;
    for (const ch of s) w += charWidth(ch);
    return w * fs * (bold ? 1.05 : 1) + s.length * fs * 0.02;
  }

  /** Разбивает текст на строки под заданную ширину/высоту и подбирает размер шрифта. */
  function fitText(text, maxW, maxH, o) {
    const opt = o || {};
    const minFs = opt.minFs || 0.7;
    const maxFs = opt.maxFs || 3;
    const maxLines = opt.maxLines || 3;
    const bold = !!opt.bold;
    const lh = opt.lh || 1.22;         // высота строки / шрифт
    const words = String(text).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return { lines: [], fs: minFs };
    const wrap = (fs, limit) => {
      const lines = [];
      let cur = '';
      for (const w of words) {
        const next = cur ? cur + ' ' + w : w;
        if (textWidth(next, fs, bold) > maxW && cur) { lines.push(cur); cur = w; }
        else cur = next;
        if (lines.length >= limit) return null;
      }
      if (cur) lines.push(cur);
      if (lines.length > limit) return null;
      if (lines.some((l) => textWidth(l, fs, bold) > maxW)) return null;
      if (lines.length * lh * fs > maxH) return null;
      return lines;
    };
    for (let n = 1; n <= maxLines; n++) {
      let best = null;
      for (let fs = maxFs; fs >= minFs; fs -= 0.04) {
        const lines = wrap(fs, n);
        if (lines) { best = { lines, fs: r3(fs) }; break; }
      }
      if (best) return best;
    }
    // sig'madi — eng katta shriftda qisqartiramiz
    const fs = Math.max(minFs, Math.min(maxFs, (maxW / textWidth(words[0], 1, bold)) || 1, maxH / (2 * lh)));
    let out = '';
    for (const w of words) {
      const next = out ? out + ' ' + w : w;
      if (textWidth(next, fs, bold) > maxW) break;
      out = next;
    }
    if (out.length < String(text).trim().length) out = out.replace(/.$/, '') + '…';
    return { lines: out ? [out] : [], fs: r3(fs) };
  }

  /** Длинные слова («Derevenskoye») режем на части — иначе имя не влезает в ячейку 3×3 м. */
  function softBreak(text, chunk) {
    const c = chunk || 12;
    return String(text ?? '').split(/\s+/).map((w) => {
      if (w.length <= c) return w;
      // сначала пробуем перенести по дефису (Conference-Hall → Conference- + Hall)
      const hy = w.lastIndexOf('-');
      if (hy > 2 && hy < w.length - 1 && w.length - hy - 1 <= c) return w.slice(0, hy + 1) + ' ' + w.slice(hy + 1);
      const parts = [];
      for (let i = 0; i < w.length; i += c) parts.push(w.slice(i, i + c));
      return parts.join(' ');
    }).join(' ');
  }

  /**
   * Подпись внутри рамки БЕЗ обрезки (многоточия): подбираем размер шрифта так,
   * чтобы самое длинное слово влезало по ширине, а число строк — по высоте.
   * Длинные слова при необходимости режутся на части (chunk).
   */
  function fitLabel(text, maxW, maxH, o) {
    const opt = o || {};
    const maxFs = opt.maxFs || 11;
    const minFs = opt.minFs || 5.2;
    const bold = opt.bold !== false;
    const chunk = opt.chunk || 12;
    const words = softBreak(String(text || ''), chunk).split(/\s+/).filter(Boolean);
    if (!words.length) return { lines: [], fs: minFs };
    const wrapAt = (fs) => {
      const lines = [];
      let cur = '';
      for (const w of words) {
        const next = cur ? cur + ' ' + w : w;
        if (cur && textWidth(next, fs, bold) > maxW) { lines.push(cur); cur = w; } else cur = next;
      }
      if (cur) lines.push(cur);
      return lines;
    };
    for (let fs = maxFs; fs >= minFs; fs -= 0.2) {
      const widest = Math.max(...words.map((w) => textWidth(w, fs, bold)), 1);
      if (widest > maxW) continue;
      const lines = wrapAt(fs);
      if (lines.length * fs * 1.18 <= maxH) return { lines, fs: r3(fs) };
    }
    // не влезло даже в минимальный размер — берём максимально возможный по ширине,
    // но не мельче floor (в пикселях экспорта floor = 4.6, на плане в метрах — 0.35)
    const widest1 = Math.max(...words.map((w) => textWidth(w, 1, bold)), 1);
    const fs = Math.max(opt.floor ?? 0.35, Math.min(minFs, maxW / widest1));
    return { lines: wrapAt(fs), fs: r3(fs) };
  }

  root.ExpoGroups = { groupBookings, unionPath, fitText, largestRect, mergedAsStands, touches, textWidth, charWidth, fitLabel };
})(typeof globalThis !== 'undefined' ? globalThis : this);
