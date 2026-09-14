/**
 * Layout yadrosi — "yagona haqiqat manbai" (single source of truth).
 *
 * Butun tizim (xarita, sotuv paneli, mijozga yuboriladigan PDF, hisobot)
 * faqat shu modul orqali hisoblanadi. Figma'da qo'lda chizish yo'q.
 *
 * Qoidalar (o'zgarmas):
 *   1 stend  = 3m x 3m  = 9 m2
 *   1 blok   = 8 ta stend = 72 m2
 */

const EPS = 1e-6;

export const DEFAULTS = {
  stand: { w: 3, h: 3, areaM2: 9 },
  block: { stands: 8, areaM2: 72 },
  minAisleM: 2,
  currency: 'UZS',
};

function num(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} raqam bo'lishi kerak (hozir: ${JSON.stringify(v)})`);
  return n;
}

/** Bloklarni alohida stendlarga ochish. Har bir stend aniq koordinatga ega bo'ladi. */
export function expandLayout(raw) {
  if (!raw) throw new Error('layout bo\'sh');
  const meta = {
    ...DEFAULTS,
    ...raw.meta,
    stand: { ...DEFAULTS.stand, ...(raw.meta?.stand || {}) },
    block: { ...DEFAULTS.block, ...(raw.meta?.block || {}) },
  };
  const hall = raw.hall || { width: 0, height: 0 };
  if (!hall.width || !hall.height) {
    throw new Error("hall.width va hall.height majburiy (metrda)");
  }

  const stands = [];
  const blocks = [];
  const pad = num(meta.standPadM ?? 0, 'meta.standPadM');

  for (const b of raw.blocks || []) {
    const block = {
      id: String(b.id),
      label: b.label || String(b.id),
      group: b.group || null,
      note: b.note || null,
      x: num(b.x, `${b.id}.x`),
      y: num(b.y, `${b.id}.y`),
      cols: b.cols ?? null,
      rows: b.rows ?? null,
      standIds: [],
      stands: [],
    };

    let cells;
    if (Array.isArray(b.stands) && b.stands.length) {
      // Qo'lda berilgan joylashuv (nostandart shakldagi bloklar uchun)
      cells = b.stands.map((s, i) => ({
        col: num(s.col ?? i, `${b.id}.stands[${i}].col`),
        row: num(s.row ?? 0, `${b.id}.stands[${i}].row`),
        no: s.no ?? i + 1,
      }));
    } else {
      const cols = num(b.cols, `${b.id}.cols`);
      const rows = num(b.rows, `${b.id}.rows`);
      cells = [];
      const rowMajor = (b.numbering || 'row-major') === 'row-major';
      let n = 0;
      if (rowMajor) {
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ col: c, row: r, no: ++n });
      } else {
        for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) cells.push({ col: c, row: r, no: ++n });
      }
    }

    const numFmt = (i) => String(i).padStart(2, '0');
    cells.forEach((cell, i) => {
      const w = meta.stand.w - pad;
      const h = meta.stand.h - pad;
      const stand = {
        id: `${block.id}-${numFmt(cell.no)}`,
        no: cell.no,
        noLabel: String(cell.no),
        blockId: block.id,
        blockLabel: block.label,
        index: i,
        x: block.x + cell.col * meta.stand.w + pad / 2,
        y: block.y + cell.row * meta.stand.h + pad / 2,
        w,
        h,
        areaM2: meta.stand.areaM2,
      };
      block.stands.push(stand);
      block.standIds.push(stand.id);
      stands.push(stand);
    });

    const cols = block.cols ?? Math.max(...cells.map((c) => c.col)) + 1;
    const rows = block.rows ?? Math.max(...cells.map((c) => c.row)) + 1;
    block.w = cols * meta.stand.w;
    block.h = rows * meta.stand.h;
    block.areaM2 = block.stands.length * meta.stand.areaM2;
    block.cx = block.x + block.w / 2;
    block.cy = block.y + block.h / 2;
    blocks.push(block);
  }

  return { meta, hall, features: raw.features || [], blocks, stands };
}

/** 72 = 8 x 9 qoidasi va xarita geometriyasi bo'yicha tekshiruv. */
export function validateLayout(raw) {
  const errors = [];
  const warnings = [];
  let exp;
  try {
    exp = expandLayout(raw);
  } catch (e) {
    return { ok: false, errors: [e.message], warnings: [], stats: null };
  }
  const { meta, blocks, stands } = exp;
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);
  const near = (a, b) => Math.abs(a - b) < 1e-3;

  // --- 9 m2 / stend ---
  const standArea = meta.stand.w * meta.stand.h;
  if (!near(standArea, 9)) err(`1 stend maydoni ${standArea.toFixed(2)} m2 — 9 m2 bo'lishi shart (stand.w=${meta.stand.w}, stand.h=${meta.stand.h})`);
  if (!near(meta.stand.areaM2, 9)) err(`meta.stand.areaM2 = ${meta.stand.areaM2} — 9 bo'lishi shart`);

  // --- 8 stend / blok ---
  for (const b of blocks) {
    if (b.stands.length !== 8) err(`${b.id}: ${b.stands.length} ta stend — aynan 8 ta bo'lishi shart`);
    if (!near(b.areaM2, 72)) err(`${b.id}: maydon ${b.areaM2} m2 — 72 m2 bo'lishi shart`);
  }
  if (!near(meta.block.areaM2, 72)) err(`meta.block.areaM2 = ${meta.block.areaM2} — 72 bo'lishi shart`);
  if (!near(meta.block.stands, 8)) err(`meta.block.stands = ${meta.block.stands} — 8 bo'lishi shart`);

  // --- ID takrorlanmasligi ---
  const seen = new Set();
  for (const s of stands) {
    if (seen.has(s.id)) err(`ID takrorlanyapti: ${s.id}`);
    seen.add(s.id);
  }
  const blockSeen = new Set();
  for (const b of blocks) {
    if (blockSeen.has(b.id)) err(`Blok ID takrorlanyapti: ${b.id}`);
    blockSeen.add(b.id);
  }

  // --- Stendlar ustma-ust tushmasligi ---
  const inter = (a, b) => {
    const x = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const y = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return x > 1e-4 && y > 1e-4 ? x * y : 0;
  };
  for (let i = 0; i < stands.length; i++) {
    for (let j = i + 1; j < stands.length; j++) {
      const a = stands[i];
      const bb = stands[j];
      if (inter(a, bb) > 1e-4) err(`Ustma-ust tushish: ${a.id} va ${bb.id} (${inter(a, bb).toFixed(2)} m2 kesishyapti)`);
    }
  }

  // --- Blok ichidagi stendlar yaxlit (uzluksiz) bo'lishi ---
  const touching = (a, b) => {
    const gapX = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w));
    const gapY = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h));
    return (Math.abs(gapX) < 1e-3 && gapY < -1e-3) || (Math.abs(gapY) < 1e-3 && gapX < -1e-3);
  };
  for (const b of blocks) {
    if (b.stands.length < 2) continue;
    const visited = new Set([b.stands[0].id]);
    const queue = [b.stands[0]];
    while (queue.length) {
      const cur = queue.shift();
      for (const other of b.stands) {
        if (visited.has(other.id)) continue;
        if (touching(cur, other)) {
          visited.add(other.id);
          queue.push(other);
        }
      }
    }
    const missing = b.stands.filter((s) => !visited.has(s.id)).map((s) => s.id);
    if (missing.length) err(`${b.id}: uzluksiz emas — ${missing.join(', ')} blokdan uzilib qolgan (8 ta stend yonma-yon turishi kerak)`);
  }

  // --- Yo'lakcha (aisle) kengligi ---
  const minAisle = Number(meta.minAisleM ?? 2);
  const seenPair = new Set();
  for (const a of blocks) {
    for (const b of blocks) {
      if (a.id >= b.id) continue;
      const key = `${a.id}|${b.id}`;
      if (seenPair.has(key)) continue;
      const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      const gapX = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w));
      const gapY = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h));
      let gap = Infinity;
      if (yOverlap > 1e-3 && gapX > -1e-3) gap = Math.min(gap, Math.abs(gapX));
      if (xOverlap > 1e-3 && gapY > -1e-3) gap = Math.min(gap, Math.abs(gapY));
      if (gap < Infinity && gap < minAisle) {
        seenPair.add(key);
        if (gap < 1e-3) err(`${a.id} va ${b.id} bir-biriga yopishib qolgan (yo'lak yo'q)`);
        else warn(`${a.id} va ${b.id} orasidagi yo'lak ${gap.toFixed(2)} m — tavsiya etilgan minimum ${minAisle} m`);
      }
    }
  }

  // --- Devor/obyektlar bilan kesishuv ---
  for (const f of exp.features) {
    if (f.w == null || f.h == null) continue;
    for (const s of stands) if (inter(f, s) > 1e-4) err(`${s.id} "${f.label || f.type}" obyektiga kirib ketgan`);
  }

  // --- Zal ichida joylashganligi ---
  const outline = exp.hall.outline;
  const inside = (px, py) => {
    if (!Array.isArray(outline) || outline.length < 3) return true; // outline berilmagan
    let c = false;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const [xi, yi] = outline[i];
      const [xj, yj] = outline[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  for (const s of stands) {
    const corners = [
      [s.x, s.y],
      [s.x + s.w, s.y],
      [s.x + s.w, s.y + s.h],
      [s.x, s.y + s.h],
    ];
    if (corners.some(([x, y]) => !inside(x, y))) err(`${s.id} zal chegarasidan tashqariga chiqib ketgan`);
  }

  const stats = {
    blocks: blocks.length,
    stands: stands.length,
    totalAreaM2: stands.length * meta.stand.areaM2,
    blockAreaM2: meta.block.areaM2,
    standWidthM: meta.stand.w,
    standHeightM: meta.stand.h,
    minAisleM: minAisle,
  };

  return { ok: errors.length === 0, errors, warnings, stats, expanded: exp };
}
