/**
 * Layout yadrosi — "yagona haqiqat manbai" (single source of truth).
 *
 * Butun tizim (xarita, sotuv paneli, mijozga yuboriladigan PDF, hisobot)
 * faqat shu modul orqali hisoblanadi. Figma'da qo'lda chizish yo'q.
 *
 * Asosiy qoidalar (o'zgarmas):
 *   1 stend  = 3m x 3m  = 9 m2
 *   1 blok   = 8 ta stend = 72 m2      <- sotuv birligi
 *
 * Real chizmalar uchun qo'shimcha imkoniyatlar:
 *   - zones[]        — zal ichidagi zonalar (asosiy zal, B2B, konferens...) rang bilan;
 *   - blocks[]       — istalgan o'lchamdagi guruh (masalan 2x6 = 12 stend = 108 m2);
 *                      agar 72 m2 bo'lmasa — ogohlantirish (meta.enforceBlockRule bilan sozlanadi);
 *   - customStands[] — nostandart o'lchamdagi yakka stendlar (masalan A3 = 25.4 m2);
 *                      ularning maydoni JSON'da aniq yoziladi, geometriyasi tekshiriladi;
 *   - meta.status    — "draft" | "approved". Qoralama xarita mijozga chiqmaydi.
 */

export const DEFAULTS = {
  stand: { w: 3, h: 3, areaM2: 9 },
  block: { stands: 8, areaM2: 72 },
  minAisleM: 2,
  currency: 'UZS',
};

export const STATUS = { DRAFT: 'draft', APPROVED: 'approved' };

function num(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} raqam bo'lishi kerak (hozir: ${JSON.stringify(v)})`);
  return n;
}

/** Bloklarni alohida stendlarga ochish. Har bir stend aniq koordinatga ega bo'ladi. */
export function expandLayout(raw) {
  if (!raw) throw new Error("layout bo'sh");
  const meta = {
    ...DEFAULTS,
    ...raw.meta,
    stand: { ...DEFAULTS.stand, ...(raw.meta?.stand || {}) },
    block: { ...DEFAULTS.block, ...(raw.meta?.block || {}) },
  };
  const hall = raw.hall || {};
  if (!hall.width || !hall.height) throw new Error('hall.width va hall.height majburiy (metrda)');

  const stands = [];
  const blocks = [];
  const pad = num(meta.standPadM ?? 0, 'meta.standPadM');

  // ---------------------------------------------------------------- standart bloklar
  for (const b of raw.blocks || []) {
    const block = {
      id: String(b.id),
      label: b.label || String(b.id),
      group: b.group || null,
      color: b.color || null,
      zone: b.zone || null,
      note: b.note || null,
      kind: 'grid',
      x: num(b.x, `${b.id}.x`),
      y: num(b.y, `${b.id}.y`),
      cols: b.cols ?? null,
      rows: b.rows ?? null,
      standIds: [],
      stands: [],
    };

    let cells;
    if (Array.isArray(b.stands) && b.stands.length) {
      // qo'lda berilgan joylashuv (nostandart shakl)
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
      const stand = {
        id: `${block.id}-${numFmt(cell.no)}`,
        no: cell.no,
        noLabel: String(cell.no),
        blockId: block.id,
        blockLabel: block.label,
        group: block.group,
        color: block.color,
        zone: block.zone,
        kind: 'grid',
        index: i,
        x: block.x + cell.col * meta.stand.w + pad / 2,
        y: block.y + cell.row * meta.stand.h + pad / 2,
        w: meta.stand.w - pad,
        h: meta.stand.h - pad,
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

  // ---------------------------------------------------------------- nostandart stendlar
  const custom = [];
  for (const s of raw.customStands || []) {
    const w = num(s.w, `${s.id}.w`);
    const h = num(s.h, `${s.id}.h`);
    const area = Number.isFinite(Number(s.areaM2)) ? Number(s.areaM2) : w * h;
    const stand = {
      id: String(s.id),
      no: s.no ?? null,
      noLabel: s.label || String(s.id).replace(/^.*?(?=[A-Z])/, ''),
      blockId: String(s.id),
      blockLabel: s.label || String(s.id),
      group: s.group || null,
      color: s.color || null,
      zone: s.zone || null,
      kind: 'custom',
      index: custom.length,
      x: num(s.x, `${s.id}.x`),
      y: num(s.y, `${s.id}.y`),
      w,
      h,
      areaM2: area,
      note: s.note || null,
    };
    custom.push(stand);
    stands.push(stand);
  }
  const customBlocks = custom.map((s) => ({
    id: s.id,
    label: s.blockLabel,
    group: s.group,
    color: s.color,
    zone: s.zone,
    note: s.note,
    kind: 'custom',
    x: s.x,
    y: s.y,
    w: s.w,
    h: s.h,
    areaM2: s.areaM2,
    cx: s.x + s.w / 2,
    cy: s.y + s.h / 2,
    standIds: [s.id],
    stands: [s],
  }));

  // ---------------------------------------------------------------- zonalar
  const zones = (raw.zones || []).map((z) => {
    const box = z.outline && z.outline.length >= 3
      ? {
          x: Math.min(...z.outline.map((p) => p[0])),
          y: Math.min(...z.outline.map((p) => p[1])),
          w: Math.max(...z.outline.map((p) => p[0])) - Math.min(...z.outline.map((p) => p[0])),
          h: Math.max(...z.outline.map((p) => p[1])) - Math.min(...z.outline.map((p) => p[1])),
        }
      : { x: num(z.x ?? 0, `${z.id}.x`), y: num(z.y ?? 0, `${z.id}.y`), w: num(z.w ?? 0, `${z.id}.w`), h: num(z.h ?? 0, `${z.id}.h`) };
    return { id: String(z.id), label: z.label || String(z.id), color: z.color || '#eef2f6', kind: z.kind || 'zone', ...box, outline: z.outline || null };
  });

  return { meta, hall, zones, features: raw.features || [], blocks: [...blocks, ...customBlocks], gridBlocks: blocks, customStands: custom, stands };
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
  const { meta, blocks, gridBlocks, customStands, stands, zones } = exp;
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);
  const near = (a, b, tol = 1e-3) => Math.abs(a - b) < tol;
  const strictBlock = meta.enforceBlockRule !== false;
  const blockProblem = (m) => (strictBlock ? err(m) : warn(m));

  // --- 9 m2 / stend (standart to'r) ---
  const standArea = meta.stand.w * meta.stand.h;
  if (!near(standArea, 9)) err(`1 stend maydoni ${standArea.toFixed(2)} m2 — 9 m2 bo'lishi shart (stand.w=${meta.stand.w}, stand.h=${meta.stand.h})`);
  if (!near(meta.stand.areaM2, 9)) err(`meta.stand.areaM2 = ${meta.stand.areaM2} — 9 bo'lishi shart`);

  // --- blok qoidasi: 8 stend / 72 m2 ---
  for (const b of gridBlocks) {
    if (b.stands.length !== 8) blockProblem(`${b.id}: ${b.stands.length} ta stend — standart blok 8 ta bo'lishi shart (72 m2 = 8 x 9)`);
    if (!near(b.areaM2, 72)) blockProblem(`${b.id}: maydon ${b.areaM2} m2 — 72 m2 bo'lishi shart`);
  }
  if (!near(meta.block.areaM2, 72)) err(`meta.block.areaM2 = ${meta.block.areaM2} — 72 bo'lishi shart`);
  if (!near(meta.block.stands, 8)) err(`meta.block.stands = ${meta.block.stands} — 8 bo'lishi shart`);

  // --- nostandart stendlar: maydon o'lchamga mos kelishi shart ---
  for (const s of customStands) {
    const real = s.w * s.h;
    if (!near(real, s.areaM2, 0.05)) err(`${s.id}: ko'rsatilgan maydon ${s.areaM2} m2, o'lchamdan ${real.toFixed(2)} m2 chiqadi (w=${s.w}, h=${s.h})`);
    if (s.areaM2 > 100) warn(`${s.id}: maydon ${s.areaM2} m2 — juda katta, bloklarga bo'lish kerakmi?`);
  }

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
      const ov = inter(a, bb);
      if (ov > 1e-4) err(`Ustma-ust tushish: ${a.id} va ${bb.id} (${ov.toFixed(2)} m2 kesishyapti)`);
    }
  }

  // --- Blok ichidagi stendlar yaxlit (uzluksiz) bo'lishi ---
  const touching = (a, b) => {
    const gapX = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w));
    const gapY = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h));
    return (Math.abs(gapX) < 1e-3 && gapY < -1e-3) || (Math.abs(gapY) < 1e-3 && gapX < -1e-3);
  };
  for (const b of gridBlocks) {
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
    if (missing.length) err(`${b.id}: uzluksiz emas — ${missing.join(', ')} blokdan uzilib qolgan (stendlar yonma-yon turishi kerak)`);
  }

  // --- Yo'lakcha (aisle) kengligi ---
  const minAisle = Number(meta.minAisleM ?? 2);
  const seenPair = new Set();
  for (const a of blocks) {
    for (const b of blocks) {
      if (a.id >= b.id) continue;
      const key = `${a.id}|${b.id}`;
      if (seenPair.has(key)) continue;
      // yakka (nostandart) stendlar yonma-yon turishi mumkin — ular orasida yo'lak talab qilinmaydi
      if (a.kind === 'custom' && b.kind === 'custom') continue;
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
    if (f.type === 'entrance' || f.type === 'service' || f.type === 'wc' || f.type === 'room') continue; // bu zonalar ustiga stend chiqmasa bo'ldi, lekin devor hisoblanmaydi
    for (const s of stands) if (inter(f, s) > 1e-4) err(`${s.id} "${f.label || f.type}" obyektiga kirib ketgan`);
  }

  // --- Zona ichidaligi (agar zona ko'rsatilgan bo'lsa) ---
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  for (const s of stands) {
    if (!s.zone) continue;
    const z = zoneById.get(s.zone);
    if (!z) { warn(`${s.id}: "${s.zone}" zonasi topilmadi`); continue; }
    if (z.outline && z.outline.length >= 3) {
      if (!insidePolygon(s.x + s.w / 2, s.y + s.h / 2, z.outline)) err(`${s.id} "${z.label}" zonasidan tashqarida`);
    } else if (z.w > 0 && z.h > 0) {
      const inside = s.x >= z.x - 1e-6 && s.y >= z.y - 1e-6 && s.x + s.w <= z.x + z.w + 1e-6 && s.y + s.h <= z.y + z.h + 1e-6;
      if (!inside) err(`${s.id} "${z.label}" zonasidan tashqarida`);
    }
  }

  // --- Zal ichida joylashganligi ---
  const outline = exp.hall.outline;
  for (const s of stands) {
    if (!insidePolygon(s.x + s.w / 2, s.y + s.h / 2, outline && outline.length >= 3 ? outline : [[0, 0], [exp.hall.width, 0], [exp.hall.width, exp.hall.height], [0, exp.hall.height]])) {
      err(`${s.id} zal chegarasidan tashqariga chiqib ketgan`);
    }
  }

  // --- Holat: qoralama xarita mijozga chiqmasligi kerak ---
  const status = meta.status || STATUS.DRAFT;
  if (status === STATUS.DRAFT) {
    warn(`Layout "${raw.meta?.version || '?'}" — QORALAMA. Tasdiqlangach meta.status = "approved" qilinadi, aks holda eksport bloklanadi.`);
  }

  const stats = {
    status,
    blocks: gridBlocks.length,
    customStands: customStands.length,
    stands: stands.length,
    gridStands: stands.length - customStands.length,
    totalAreaM2: Number(stands.reduce((a, s) => a + s.areaM2, 0).toFixed(2)),
    blockAreaM2: meta.block.areaM2,
    standWidthM: meta.stand.w,
    standHeightM: meta.stand.h,
    minAisleM: minAisle,
    zones: zones.length,
  };

  return { ok: errors.length === 0, errors, warnings, stats, expanded: exp };
}

function insidePolygon(px, py, outline) {
  if (!Array.isArray(outline) || outline.length < 3) return true;
  let c = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, yi] = outline[i];
    const [xj, yj] = outline[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
