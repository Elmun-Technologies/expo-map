/* Экспо-карта — панель продаж (vanilla JS, без сборки). Весь интерфейс — на русском. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const CLIENT = new URLSearchParams(location.search).get('mode') === 'client';

  let layout = null;          // ответ /api/layout
  let items = {};             // standId -> { status, buyer, ... } (свободные не хранятся)
  let revision = 0;
  let seller = JSON.parse(localStorage.getItem('expo.seller') || 'null');
  let token = localStorage.getItem('expo.token') || null;
  let selection = new Set();
  let activeSection = null;
  let hiddenStatuses = new Set();

  // ------------------------------------------------------------ utils
  const fmtNum = (n) => Number(n || 0).toLocaleString('ru-RU').replace(/\u00A0/g, ' ');
  const fmtMoney = (n) => `${fmtNum(n)} сум`;
  const fmtMln = (n) => `${(Number(n || 0) / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} млн сум`;
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  /** Русское склонение: 1 стенд · 2 стенда · 5 стендов. */
  const plural = (n, forms) => {
    const v = Math.abs(Number(n) || 0) % 100, d = v % 10;
    if (v > 10 && v < 20) return forms[2];
    if (d === 1) return forms[0];
    if (d >= 2 && d <= 4) return forms[1];
    return forms[2];
  };
  const standsWord = (n) => `${fmtNum(n)} ${plural(n, ['стенд', 'стенда', 'стендов'])}`;
  const statusOf = (id) => items[id]?.status || 'free';
  const STATUS_LABEL = { free: 'Свободно', reserved: 'Забронировано', sold: 'Продано', blocked: 'Блокировано' };
  const STATUS_COLOR = { free: '#2e7d32', reserved: '#f59e0b', sold: '#c62828', blocked: '#607d8b' };
  const pricePerM2 = () => Number(layout?.meta?.pricePerM2 || 0);
  const ttlDefault = () => Number(layout?.meta?.reserveTtlHours || 72);
  const isAdmin = () => seller?.role === 'admin';
  const sectionById = (id) => (layout?.sections || []).find((s) => s.id === id) || null;
  const sectionOf = (stand) => stand.section || null;

  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 5200);
  }
  function fail(msg) { toast(msg, 'err'); }

  // ------------------------------------------------------------ api
  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !CLIENT) { doLogout(true); throw Object.assign(new Error(data.message || 'Сессия истекла'), { code: 401 }); }
    if (!res.ok) throw Object.assign(new Error(data.message || 'Ошибка'), { code: res.status, data });
    return data;
  }

  async function loadAll() {
    layout = await api('/api/layout');
    await refreshState();
    renderMap();
    renderStats();
    renderLegend();
    renderSections();
    document.title = `${layout.meta.hall} · Экспо-карта`;
    const msgs = [];
    if ((layout.meta.status || 'draft') !== 'approved') {
      msgs.push(`⚠ ЧЕРНОВИК ПЛАНА (v${layout.meta.version || '?'}) — размеры не подтверждены, клиенту отправлять нельзя.`);
    }
    const deviants = (layout.blocks || []).filter((b) => b.kind !== 'custom' && Math.abs((b.areaM2 + (b.merged || []).reduce((a, m) => a + m.w * m.h, 0)) - 72) > 0.01);
    if (deviants.length) {
      const some = deviants.slice(0, 4).map((b) => `${b.label} = ${fmtNum(b.areaM2)} м²`).join(', ');
      msgs.push(`ℹ Группы в этом зале отличаются от правила 72 м² (8×9): ${some}${deviants.length > 4 ? ` и ещё ${deviants.length - 4}` : ''}. Площадь и цена считаются по каждой группе.`);
    }
    const customCount = (layout.customStands || []).length;
    if (customCount) msgs.push(`ℹ ${customCount} нестандартных стендов (например A1–A6) — площадь написана на плане, цена считается по ней.`);
    if (msgs.length) {
      $('#draftBanner').hidden = false;
      $('#draftBanner').className = 'draft-banner' + ((layout.meta.status || 'draft') !== 'approved' ? '' : ' info');
      $('#draftBanner').textContent = msgs.join('  |  ');
    }
    $('#hallTitle').textContent = `${layout.meta.project} — ${layout.meta.hall}`;
    $('#hallSub').textContent = `${layout.blocks.length} блоков · ${layout.stands.length} стендов · ${fmtNum(layout.stands.length * 9)} м² · версия плана v${layout.meta.version || '?'}`;
  }

  async function refreshState(force) {
    const s = await api('/api/state');
    const changed = force || s.revision !== revision;
    revision = s.revision;
    items = s.items || {};
    const stamp = $('#updatedAt');
    if (stamp) stamp.textContent = 'Обновлено: ' + new Date().toLocaleTimeString('ru-RU');
    if (changed) {
      // если место из выборки уже занято — предупреждаем
      if (selection.size) {
        const taken = [...selection].filter((id) => statusOf(id) !== 'free');
        if (taken.length) {
          taken.forEach((id) => selection.delete(id));
          toast(`Внимание: ${taken.join(', ')} заняты другим продавцом — сняты с выбора.`, 'err');
        }
      }
      renderMap(); renderStats(); renderLegend(); renderSections(); renderBookings(); renderSelection();
      if ($('#pane-deals') && !$('#pane-deals').hidden) renderDeals();
    }
  }

  // ------------------------------------------------------------ login
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#loginError').textContent = '';
    try {
      const r = await api('/api/login', { method: 'POST', body: { name: $('#loginName').value, pin: $('#loginPin').value } });
      token = r.token; seller = r.seller;
      localStorage.setItem('expo.token', token);
      localStorage.setItem('expo.seller', JSON.stringify(seller));
      $('#login').style.display = 'none';
      startSession();
    } catch (err) {
      $('#loginError').textContent = err.message;
    }
  });
  $$('.demo-hint .chip').forEach((c) => c.addEventListener('click', () => {
    $('#loginName').value = c.dataset.user;
    $('#loginPin').value = c.dataset.pin;
  }));

  function doLogout(silent) {
    if (!silent) api('/api/logout', { method: 'POST' }).catch(() => {});
    token = null; seller = null;
    localStorage.removeItem('expo.token');
    localStorage.removeItem('expo.seller');
    $('#login').style.display = 'grid';
    $('#who').textContent = '';
  }
  $('#logoutBtn').addEventListener('click', () => doLogout(false));

  function startSession() {
    $('#who').innerHTML = `Продавец: <b>${seller.name}</b>${isAdmin() ? ' (менеджер)' : ''}`;
    $('#auditCard').hidden = !isAdmin();
    if (isAdmin()) loadAudit();
    renderSelection();
  }

  async function loadAudit() {
    try {
      const r = await api('/api/audit?limit=50');
      const ACT = { sell: 'продажа', reserve: 'бронь', release: 'освобождение', block: 'блокировка', expire: 'снятие брони', login: 'вход' };
    $('#auditList').innerHTML = r.entries.map((e) => `<div><b>${fmtDate(e.ts)}</b> — ${e.sellerName || e.sellerId}: ${ACT[e.action] || e.action}${e.standIds?.length ? ' · ' + e.standIds.join(', ') : ''}${e.buyer ? ' · ' + e.buyer : ''}</div>`).join('') || '<div class="muted">Записей нет</div>';
    } catch { /* jim */ }
  }

  // ------------------------------------------------------------ map
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, text) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  };
  const view = { k: 1, tx: 0, ty: 0 };
  let pad = 3;

  function renderMap() {
    const world = $('#world');
    world.innerHTML = '';
    const { width: W, height: H } = layout.hall;
    pad = Math.max(3, W * 0.04);
    $('#map').setAttribute('viewBox', `${-pad} ${-pad} ${W + pad * 2} ${H + pad * 2}`);
    // пропорция (ширина/высота) — чтобы при печати карта заполняла лист ЦЕЛИКОМ
    $('#map').style.setProperty('--map-ratio', ((W + pad * 2) / (H + pad * 2)).toFixed(4));

    // зоны (основной зал, левое крыло, B2B, конференц-зоны...)
    const zoneG = el('g');
    const zoneLabels = [];
    for (const z of layout.zones || []) {
      if (!z.w || !z.h) continue;
      zoneG.appendChild(el('rect', { x: z.x, y: z.y, width: z.w, height: z.h, rx: 0.4, fill: z.color || '#f2f5f8', 'fill-opacity': 0.9, stroke: '#c9d6e2', 'stroke-width': 0.14, 'stroke-dasharray': '1.2 .8' }));
      const pos = z.labelPos || 'none';
      if (pos === 'none') continue;
      zoneLabels.push({ z, y: pos === 'above' ? z.y - 0.5 : pos === 'bottom' ? z.y + z.h - 0.5 : z.y + 1.6 });
    }
    world.__zoneLabels = zoneLabels;
    world.appendChild(zoneG);

    // зал
    const hallG = el('g');
    const outline = layout.hall.outline?.length >= 3 ? layout.hall.outline.map((p) => p.join(',')).join(' ') : `0,0 ${W},0 ${W},${H} 0,${H}`;
    hallG.appendChild(el('polygon', { points: outline, class: 'hall-outline' }));
    for (const f of layout.features || []) {
      hallG.appendChild(el('rect', { x: f.x, y: f.y, width: f.w ?? 2, height: f.h ?? 2, class: 'feature ' + (f.type || '') , rx: 0.2 }));
      if (f.label) {
        const w = f.w ?? 2, h = f.h ?? 2;
        const note = String(f.note || '').trim();
        const noteFs = 0.8;
        const fit = ExpoGroups.fitLabel(f.label.replace(/\s*\([^)]*\)\s*/g, ' '), w - 0.5, h - 0.5 - (note ? noteFs * 1.4 : 0), {
          maxFs: 1.3, minFs: 0.7, chunk: 18, bold: false,
        });
        const lines = fit.lines.length ? fit.lines : [f.label];
        const lh = fit.fs * 1.18;
        const fitsNote = note && ExpoGroups.textWidth(note, noteFs) <= w - 0.4;
        const shift = fitsNote ? noteFs * 0.7 : 0;
        lines.forEach((ln, i) => {
          const yy = f.y + h / 2 - (lines.length - 1) * lh / 2 + i * lh + fit.fs * 0.35 - shift;
          const t = el('text', { x: f.x + w / 2, y: yy, class: 'feature-label' }, ln);
          t.style.fontSize = fit.fs + 'px';
          hallG.appendChild(t);
        });
        if (fitsNote) {
          const yy = f.y + h / 2 + (lines.length - 1) * lh / 2 + noteFs * 1.15;
          const nt = el('text', { x: f.x + w / 2, y: yy, class: 'feature-note' }, note);
          nt.style.fontSize = noteFs + 'px';
          hallG.appendChild(nt);
        }
      }
    }
    // служебные помещения: названия длинные — подпись ставится под рамкой, измерение внутри
    for (const sv of layout.service || []) {
      const w = sv.w ?? 2, h = sv.h ?? 2;
      hallG.appendChild(el('rect', { x: sv.x, y: sv.y, width: w, height: h, class: 'feature service', rx: 0.2 }));
      const note = String(sv.note || '').trim();
      const innerW = w - 0.6;
      const fit = ExpoGroups.fitLabel(sv.label, innerW, h - (note ? 1.1 : 0.2), { maxFs: 1.15, minFs: 0.62, maxLines: 2, chunk: 22, bold: false });
      const fitsInside = fit.lines.length > 0 && fit.lines.length <= 2
        && fit.lines.every((ln) => ExpoGroups.textWidth(ln, fit.fs) <= innerW)
        && fit.lines.length * fit.fs * 1.22 <= h - (note ? 1.1 : 0.2);
      if (fitsInside) {
        const lh = fit.fs * 1.22;
        const blockH = (fit.lines.length - 1) * lh + (note ? 1.1 : 0);
        const top = sv.y + h / 2 - blockH / 2 + fit.fs * 0.36;
        fit.lines.forEach((ln, i) => {
          const t = el('text', { x: sv.x + w / 2, y: top + i * lh, class: 'feature-label' }, ln);
          t.style.fontSize = fit.fs + 'px';
          hallG.appendChild(t);
        });
        if (note && ExpoGroups.textWidth(note, 0.72) <= innerW) {
          const nt = el('text', { x: sv.x + w / 2, y: top + (fit.lines.length - 1) * lh + 0.95, class: 'feature-note' }, note);
          nt.style.fontSize = '0.72px';
          hallG.appendChild(nt);
        }
      } else {
        // места мало — подпись под рамкой (или над ней, если снизу край зала)
        const above = sv.y + h + 1.6 > layout.hall.height;
        const ly = above ? sv.y - 0.7 : sv.y + h + 1.0;
        const fs = Math.min(0.9, ExpoGroups.fitLabel(sv.label, w + 1.6, 1.2, { maxFs: 0.9, minFs: 0.62, chunk: 22, bold: false }).fs);
        const t = el('text', { x: sv.x + w / 2, y: ly, class: 'feature-label' }, sv.label);
        t.style.fontSize = fs + 'px';
        hallG.appendChild(t);
        if (note && ExpoGroups.textWidth(note, 0.68) <= w + 1.6) {
          const nt = el('text', { x: sv.x + w / 2, y: above ? ly - 0.95 : ly + 0.95, class: 'feature-note' }, note);
          nt.style.fontSize = '0.68px';
          hallG.appendChild(nt);
        }
      }
    }
    world.appendChild(hallG);

    const blockG = el('g');
    const standG = el('g');
    // список занятых областей — чтобы подписи не наезжали друг на друга
    const occupied = [];
    for (const f of layout.features || []) {
      const fw = f.w ?? 2, fh = f.h ?? 2;
      if (f.label) occupied.push({ x: f.x + 0.4, y: f.y + fh / 2 - 1.0, w: Math.max(1, fw - 0.8), h: 2.0 });
    }
    // ЗАНЯТЫЕ места: сколько стендов ни заняла бы одна компания — одна общая рамка
    const extra = ExpoGroups.mergedAsStands(layout.blocks || []);
    const allStands = [...(layout.stands || []), ...extra.stands];
    const allItems = Object.assign({}, items, extra.items);
    const units = ExpoGroups.groupBookings(allStands, allItems);
    const bookedIds = new Set(units.flatMap((u) => u.ids.filter((id) => !id.includes('~m'))));
    for (const b of layout.blocks) {
      blockG.appendChild(el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, class: 'block-outline', rx: 0.3, stroke: b.color || '#90a4b5' }));
      occupied.push({ x: b.x, y: b.y, w: b.w, h: b.h });

      // имя блока: по нажатию выбирается весь блок (у стендов крыла размер свой)
      if (b.kind === 'custom') continue;
      const chip = el('g', { class: 'block-chip', 'data-block': b.id, tabindex: '0' });
      const label = b.label;
      const effArea = b.areaM2 + (b.merged || []).reduce((a, m) => a + m.w * m.h, 0);
      const chipText = `${label} · ${fmtNum(effArea)} м²`;
      // ширина — по тексту, но не шире блока (чтобы не наезжать на чип соседнего блока)
      const desired = ExpoGroups.textWidth(chipText, 1.15, true) + 1.3;
      const cw = Math.max(3.4, Math.min(desired, Math.max(3.4, b.w + 0.4)));
      const chipFs = Math.min(1.15, ((cw - 1.1) / Math.max(1e-3, ExpoGroups.textWidth(chipText, 1, true))));
      const chH = 1.5;
      let chipY = b.y - chH - 0.35;
      if (chipY < 0 && b.y - 0.45 > 0) chipY = -chH - 0.2;
      chip.appendChild(el('rect', { x: b.x, y: chipY, width: cw, height: chH, rx: 0.3, class: 'chip-bg', stroke: b.color || '#0f2233' }));
      const tnum = el('text', { x: b.x + cw / 2, y: chipY + chH / 2 + chipFs * 0.34 }, chipText);
      tnum.style.fill = b.color || '#0f2233';
      tnum.style.fontSize = chipFs + 'px';
      chip.appendChild(tnum);
      occupied.push({ x: b.x, y: chipY, w: cw, h: chH });
      const secForChip = sectionById(b.section);
      chip.appendChild(el('title', {}, `${label} — блок${secForChip ? ' · раздел ' + secForChip.label : ''} · ${b.stands.length} стендов × 9 м² = ${fmtNum(b.areaM2)} м². Нажмите — выберется весь блок.`));
      blockG.appendChild(chip);

      for (const s of b.stands) if (!bookedIds.has(s.id)) { standG.appendChild(standNode(s)); occupied.push({ x: s.x, y: s.y, w: s.w, h: s.h }); }
      // объединённые ячейки: если у них есть статус/владелец, выше они рисуются
      // одной рамкой — здесь остаются только пустые (технические) ячейки
      for (const m of (b.merged || []).filter((m) => !m.status && !m.buyer)) {
        const g = el('g', { class: 'merged', 'data-block': b.id });
        occupied.push({ x: m.x, y: m.y, w: m.w, h: m.h });
        const st = m.status ? STATUS_LABEL[m.status] : null;
        const fill = m.status === 'sold' ? 'url(#hatchSold)' : m.status === 'reserved' ? 'url(#hatchReserved)' : (b.color || '#0f2233');
        g.appendChild(el('rect', { x: m.x, y: m.y, width: m.w, height: m.h, rx: 0.25, fill, 'fill-opacity': m.status ? 1 : 0.9, stroke: b.color || '#0f2233', 'stroke-width': 0.16 }));
        const fs = Math.max(0.9, Math.min(1.5, (m.w / Math.max(6, (m.label || '').length)) * 2.1));
        g.appendChild(el('text', { x: m.x + m.w / 2, y: m.y + m.h / 2 + (m.buyer ? -0.25 : 0.25), fill: m.status === 'sold' ? '#fff' : '#fff', 'font-size': fs, 'text-anchor': 'middle', 'font-weight': 'bold' }, m.label || ''));
        if (m.buyer) g.appendChild(el('text', { x: m.x + m.w / 2, y: m.y + m.h / 2 + 1.3, fill: m.status === 'sold' ? '#fff' : '#eaf1f7', 'font-size': Math.min(1.0, fs * 0.75), 'text-anchor': 'middle' }, m.buyer));
        g.appendChild(el('title', {}, `${b.label}: ${m.label || 'объединённая ячейка'} · ${fmtNum(m.w * m.h)} м²${m.buyer ? ' · ' + m.buyer : ''}${st ? ' · ' + st : ''}`));
        standG.appendChild(g);
      }
      // название раздела под блоком — только если хватает места (не задевая чип)
      const sec = sectionById(b.section);
      if (sec) {
        const cx = b.x + b.w / 2;
        const gap = [...layout.blocks, ...(layout.features || [])].reduce((g, o) => {
          if (o.id === b.id) return g;
          const ow = o.w ?? 2, oh = o.h ?? 2;
          const ov = Math.min(o.x + ow, b.x + b.w) - Math.max(o.x, b.x);
          return ov > 0.1 && o.y - (b.y + b.h) >= 0 ? Math.min(g, o.y - (b.y + b.h)) : g;
        }, 99);
        // цветная метка и название — только если хватает места (не задевая нижний ряд)
        if (gap > 3.2) {
          blockG.appendChild(el('rect', { x: cx - 1.7, y: b.y + b.h + 0.55, width: 3.4, height: 0.28, rx: 0.14, fill: sec.color, class: 'sec-bar' }));
          const fitFs = (txt) => Math.max(0.62, Math.min(1.05, (b.w - 1.2) / Math.max(4, txt.length) / 0.62));
          const l1 = `Блок ${b.label}`;
          const l2 = sec.short || sec.label;
          const t1 = el('text', { x: cx, y: b.y + b.h + 1.9, class: 'sec-label', 'text-anchor': 'middle' }, l1);
          t1.style.fontSize = fitFs(l1) + 'px';
          const t2 = el('text', { x: cx, y: b.y + b.h + 3.1, class: 'sec-label', 'text-anchor': 'middle' }, l2);
          t2.style.fontSize = fitFs(l2) + 'px';
          blockG.appendChild(t1);
          blockG.appendChild(t2);
        }
      }
    }
    // стенды нестандартного размера (типа A1–A6)
    for (const s of layout.customStands || []) if (!bookedIds.has(s.id)) { standG.appendChild(standNode(s, true)); occupied.push({ x: s.x, y: s.y, w: s.w, h: s.h }); }
    for (const u of units) { standG.appendChild(unitNode(u)); occupied.push({ x: u.x, y: u.y, w: u.w, h: u.h }); }
    world.appendChild(blockG);
    world.appendChild(standG);
    // подписи зон — самым верхним слоем (чтобы ничего не перекрывали)
    const lastG = el('g');
    const zlFs = 1.2;                       // .zone-label CSS bilan bir xil
    const zlW = (txt) => txt.length * zlFs * 0.6;
    const isFree = (x1, x2, y, h) => !occupied.some((r) => Math.min(r.x + r.w, x2) - Math.max(r.x, x1) > 0.15
      && Math.min(r.y + r.h, y + h / 2) - Math.max(r.y, y - h / 2) > 0.05);
    for (const zl of (world.__zoneLabels || [])) {
      const z = zl.z;
      const fs = Math.max(0.7, Math.min(zlFs, (z.w - 0.8) / Math.max(4, z.label.length) / 0.62));
      const w = Math.min(z.w - 0.4, zlW(z.label));
      const cx = z.x + z.w / 2, x1 = cx - w / 2, x2 = cx + w / 2;
      // кандидаты: сначала заданное место, затем внутри зоны (сверху вниз), затем снаружи
      const cands = [zl.y];
      for (let y = z.y + 0.8; y <= z.y + z.h - 0.4; y += 0.25) cands.push(y);
      cands.push(z.y - 0.6, z.y + z.h + 0.9);
      let y = cands.find((c) => isFree(x1, x2, c, fs * 1.25)) ?? zl.y;
      const t = el('text', { x: cx, y, fill: '#8fa0af', 'text-anchor': 'middle', 'font-weight': 'bold' }, z.label);
      t.style.fontSize = fs + 'px';
      t.setAttribute('class', 'zone-label');
      lastG.appendChild(t);
      const znote = String(z.note || '').trim();
      if (znote && ExpoGroups.textWidth(znote, 0.8) <= z.w - 0.6) {
        const nt = el('text', { x: cx, y: y + 1.35, fill: '#bcc9d4', 'text-anchor': 'middle' }, znote);
        nt.style.fontSize = '0.8px';
        nt.setAttribute('class', 'zone-note');
        lastG.appendChild(nt);
      }
      occupied.push({ x: x1 - 0.4, y: y - fs * 0.95, w: (x2 - x1) + 0.8, h: fs * 1.5 });   // keyingi yorliq bu yerga tushmasin
    }
    world.appendChild(lastG);
    applyView();
    applyFilters();
    applySearch();
  }

  function standNode(s, custom) {
    const st = statusOf(s.id);
    const g = el('g', { class: 'stand' + (custom ? ' custom' : ''), 'data-id': s.id, 'data-status': st, 'data-block': s.blockId });
    g.appendChild(el('rect', { x: s.x, y: s.y, width: s.w, height: s.h, class: 'box', rx: 0.25, stroke: s.color || undefined }));
    const edge = s.color || '#90a4b5';
    if (custom) {
      const tn = el('text', { x: s.x + s.w / 2, y: s.y + s.h / 2 - 0.25, class: 'num' }, s.label || s.id);
      tn.style.fill = '#243b4a';
      g.appendChild(tn);
      g.appendChild(el('text', { x: s.x + s.w / 2, y: s.y + s.h / 2 + 1.15, class: 'area' }, `${fmtNum(s.areaM2)} м²`));
    } else {
      const n = items[s.id]?.buyer ? null : String(s.noLabel);
      const blockId = String(s.blockId || '');
      // подпись на стенде: A-01 → «A1», EQ-H-03 → «H3» (как на чертеже заказчика)
      const eq = /^EQ-([A-Z])$/.exec(blockId);
      const num = eq ? `${eq[1]}${s.noLabel}`
        : blockId.includes('-') ? `${blockId.replace(/^(\w+)-(\d+)$/, '$1$2')}-${s.noLabel}`
          : `${blockId}${s.noLabel}`;
      if (n) {
        const fs = Math.max(0.62, Math.min(1.15, (s.w - 0.4) / ExpoGroups.textWidth(num, 1, true)));
        const tn = el('text', { x: s.x + s.w / 2, y: s.y + s.h / 2, class: 'num' }, num);
        tn.style.fill = edge;
        tn.style.fontSize = fs + 'px';
        g.appendChild(tn);
      } else {
        // занятый стенд: название компании — прямо в ячейке
        const fit = ExpoGroups.fitLabel(String(items[s.id].buyer), s.w - 0.5, s.h - 0.55, { minFs: 0.8, maxFs: 1.15, chunk: 10, floor: 0.5 });
        (fit.lines.length ? fit.lines : [String(items[s.id].buyer)]).forEach((ln, i) => {
          const tn = el('text', { x: s.x + s.w / 2, y: s.y + s.h / 2 + (i - (fit.lines.length - 1) / 2) * fit.fs * 1.2 + fit.fs * 0.35, class: 'name', 'font-size': fit.fs }, ln);
          g.appendChild(tn);
        });
      }
    }
    g.appendChild(el('title', {}, `${s.id} · ${fmtNum(s.areaM2)} м² · ${STATUS_LABEL[st]}${items[s.id]?.buyer ? ' · ' + items[s.id].buyer : ''}${s.note ? ' · ' + s.note : ''}`));
    return g;
  }

  /** Длинное слово (Ansor-Zoxir, ZominFarms), не влезающее в ячейку, делим по слогам/дефису. */
  function softLabel(text) {
    return String(text).split(/\s+/).map((w) => {
      if (w.length <= 13) return w.includes('-') ? w.replace(/-/g, '- ').trim() : w;
      const n = Math.ceil(w.length / 11);          // bo'laklar SONI
      const len = Math.ceil(w.length / n);         // teng bo'laklar
      const parts = [];
      for (let i = 0; i < w.length; i += len) parts.push(w.slice(i, i + len));
      return parts.join(' ');
    }).join(' ');
  }

  /** Занятые места одной компании — одна рамка, название внутри. */
  function unitNode(u) {
    const g = el('g', { class: 'booking-unit', 'data-ids': u.ids.join(','), 'data-status': u.status, 'data-buyer': (u.label || '').toUpperCase() });
    const d = ExpoGroups.unionPath(u.stands.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h })));
    const fill = u.status === 'sold' ? '#fdecea' : u.status === 'reserved' ? '#fff6e0' : '#f1f4f6';
    g.appendChild(el('path', { d, class: 'unit-fill', fill }));
    g.appendChild(el('path', { d, class: 'unit-line' }));
    // название пишется в наибольший прямоугольник группы (корректно и для Г-формы)
    const boxes = ExpoGroups.largestRect(u.stands.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h })), 0.25);
    const onlyMerged = u.stands.every((st) => st.mergedCell);
    const unitLabel = softLabel(u.label || STATUS_LABEL[u.status]);
    const metaTxt = onlyMerged
      ? `${fmtNum(u.areaM2)} м²`
      : u.stands.length > 1
        ? `${u.stands.length} стендов · ${fmtNum(u.areaM2)} м²`
        : (Math.abs(u.areaM2 - 9) > 0.01 ? `${fmtNum(u.areaM2)} м²` : '');
    const withMeta = !!metaTxt && boxes.h > 2.4;
    const fit = ExpoGroups.fitLabel(unitLabel, boxes.w - 0.6, boxes.h - (withMeta ? 1.5 : 0.5), {
      chunk: boxes.w > 6 ? 12 : 10,
      minFs: 0.62,
      floor: 0.5,
      maxFs: Math.min(2.4, boxes.h / (withMeta ? 2.9 : 2.3)),
    });
    const cx = boxes.x + boxes.w / 2, cy = boxes.y + boxes.h / 2;
    const lh = fit.fs * 1.22;
    const shift = (fit.lines.length * lh) / 2;
    fit.lines.forEach((ln, i) => g.appendChild(el('text', { x: cx, y: cy - shift + lh * (i + 0.85) + (withMeta ? -0.4 : 0), class: 'unit-name', 'font-size': fit.fs }, ln)));
    if (withMeta) {
      // подпись «4 стенда · 36 м²» — строго внутри рамки, у нижнего края
      const my = Math.min(cy + shift + fit.fs * 0.6, boxes.y + boxes.h - 0.35);
      const mfs = Math.min(0.72, Math.max(0.55, fit.fs * 0.5), (boxes.w - 0.5) / ExpoGroups.textWidth(metaTxt, 1));
      g.appendChild(el('text', { x: cx, y: my, class: 'unit-meta', 'font-size': mfs }, metaTxt));
    }
    g.appendChild(el('title', {}, `${u.label || 'Занято'} — ${STATUS_LABEL[u.status]} · ${u.ids.length} стендов · ${fmtNum(u.areaM2)} м²`
      + `\nСтенды: ${u.ids.join(', ')}${u.sellerName ? '\nПродавец: ' + u.sellerName : ''}${u.phone ? ' · ' + u.phone : ''}`));
    return g;
  }

  function toggleUnit(ids) {
    const all = ids.every((id) => selection.has(id));
    ids.forEach((id) => (all ? selection.delete(id) : selection.add(id)));
    renderSelection();
    paintSelection();
  }

  function applyView() {
    $('#world').setAttribute('transform', `translate(${view.tx} ${view.ty}) scale(${view.k})`);
    const pct = $('#zoomPct');
    if (pct) pct.textContent = Math.round(view.k * 100) + '%';
  }
  function fit() { view.k = 1; view.tx = 0; view.ty = 0; applyView(); }

  const toUser = (ev) => {
    const pt = $('#map').createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    return pt.matrixTransform($('#map').getScreenCTM().inverse());
  };
  $('#zoomIn').addEventListener('click', () => zoomAt(1.3));
  $('#zoomOut').addEventListener('click', () => zoomAt(1 / 1.3));
  $('#zoomFit').addEventListener('click', fit);
  function zoomAt(factor, center) {
    const c = center || { x: pad + layout.hall.width / 2, y: pad + layout.hall.height / 2 };
    const k2 = Math.min(12, Math.max(0.5, view.k * factor));
    view.tx = c.x - (c.x - view.tx) * (k2 / view.k);
    view.ty = c.y - (c.y - view.ty) * (k2 / view.k);
    view.k = k2;
    applyView();
  }
  $('#map').addEventListener('wheel', (ev) => {
    ev.preventDefault();
    zoomAt(ev.deltaY < 0 ? 1.15 : 1 / 1.15, toUser(ev));
  }, { passive: false });

  let drag = null;
  $('#map').addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    drag = { x: ev.clientX, y: ev.clientY, moved: 0, tx: view.tx, ty: view.ty, start: toUser(ev) };
    $('#map').classList.add('dragging');
    $('#map').setPointerCapture(ev.pointerId);
  });
  $('#map').addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const p = toUser(ev);
    const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    drag.moved = Math.max(drag.moved, Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y));
    view.tx = drag.tx + dx; view.ty = drag.ty + dy;
    applyView();
  });
  $('#map').addEventListener('pointerup', (ev) => {
    $('#map').classList.remove('dragging');
    const moved = drag?.moved || 0;
    drag = null;
    if (moved > 4) return; // bu pan edi, klik emas
    const hit = document.elementFromPoint(ev.clientX, ev.clientY);
    const unit = hit?.closest?.('.booking-unit');
    const stand = hit?.closest?.('.stand');
    const chip = hit?.closest?.('.block-chip');
    if (unit) {
      if (CLIENT) showClientInfo(unit.dataset.ids.split(',')[0]);
      else toggleUnit(unit.dataset.ids.split(','));
    }
    else if (stand) toggleStand(stand.dataset.id);
    else if (chip) selectBlock(chip.dataset.block);
    else { selection.clear(); renderSelection(); paintSelection(); }
  });

  function toggleStand(id) {
    if (CLIENT) { showClientInfo(id); return; }
    selection.has(id) ? selection.delete(id) : selection.add(id);
    renderSelection(); paintSelection();
  }
  function selectBlock(blockId) {
    const b = layout.blocks.find((x) => x.id === blockId);
    if (!b) return;
    const free = b.stands.filter((s) => statusOf(s.id) === 'free').map((s) => s.id);
    const pick = free.length ? free : b.stands.map((s) => s.id);
    const allIn = pick.every((id) => selection.has(id));
    pick.forEach((id) => (allIn ? selection.delete(id) : selection.add(id)));
    if (free.length && free.length < 8) toast(`${blockId}: из 8 стендов свободно ${free.length} — выбраны они.`);
    renderSelection(); paintSelection();
  }
  function paintSelection() {
    $$('#world .stand').forEach((g) => g.classList.toggle('selected', selection.has(g.dataset.id)));
    $$('#world .booking-unit').forEach((g) => {
      const ids = g.dataset.ids.split(',');
      g.classList.toggle('selected', ids.every((id) => selection.has(id)));
      g.classList.toggle('part', ids.some((id) => selection.has(id)) && !ids.every((id) => selection.has(id)));
    });
  }

  // ------------------------------------------------------------ panel
  function selectionInfo() {
    const stands = layout.stands.filter((s) => selection.has(s.id));
    const free = stands.filter((s) => statusOf(s.id) === 'free');
    const taken = stands.filter((s) => statusOf(s.id) !== 'free');
    const area = free.reduce((a, s) => a + s.areaM2, 0);
    const blocks = [...new Set(stands.map((s) => s.blockId))];
    return { stands, free, taken, area, amount: area * pricePerM2(), blocks };
  }

  function renderSelection() {
    const has = selection.size > 0;
    $('#selHint').hidden = has;
    $('#selBody').hidden = !has;
    if (!has) { $('#details').innerHTML = ''; return; }
    const { stands, free, taken, area, amount, blocks } = selectionInfo();
    const kind = stands.every((s) => s.blockId === blocks[0]) && stands.length === 8 ? 'Весь блок (72 м²)' : standsWord(stands.length);
    $('#selTitle').textContent = `${blocks.join(', ')} · ${kind}`;
    $('#selChips').innerHTML = stands.map((s) => `<span class="chip ${statusOf(s.id)}" data-id="${s.id}" title="${STATUS_LABEL[statusOf(s.id)]}">${s.id.replace(/^.*?-(?=\d+$)/, '')}</span>`).join('');
    $$('#selChips .chip').forEach((c) => c.addEventListener('click', (e) => { e.stopPropagation(); toggleStand(c.dataset.id); }));

    $('#selInfo').innerHTML = `
      <dt>Свободно</dt><dd><b>${standsWord(free.length)}</b> · ${fmtNum(area)} м²</dd>
      ${taken.length ? `<dt>Занято</dt><dd>${standsWord(taken.length)} (${taken.map((s) => STATUS_LABEL[statusOf(s.id)]).filter((v, i, a) => a.indexOf(v) === i).join(', ')})</dd>` : ''}
      <dt>Цена</dt><dd>${pricePerM2() ? fmtMoney(amount) : '—'}<br><span class="muted">${pricePerM2() ? fmtMln(amount) + ' · ' + fmtMoney(pricePerM2()) + '/м²' : 'цена не задана'}</span></dd>`;

    const canAct = !CLIENT;
    $('#formFields').hidden = !canAct;
    $('#btnReserve').disabled = !canAct || free.length === 0;
    $('#btnSell').disabled = !canAct || free.length === 0;
    const releasable = stands.filter((s) => statusOf(s.id) !== 'free' && (isAdmin() || items[s.id]?.sellerId === seller?.id || statusOf(s.id) === 'blocked'));
    $('#btnRelease').disabled = !canAct || releasable.length === 0;
    $('#btnRelease').textContent = `Освободить${releasable.length && releasable.length < stands.length ? ` (${releasable.length})` : ''}`;
    $('#btnReserve').textContent = free.length ? `Забронировать (${fmtNum(free.length * 9)} м²)` : 'Забронировать';
    $('#btnSell').textContent = free.length ? `Продать (${fmtNum(free.length * 9)} м²)` : 'Продать';
    if (!$('#ttl').value) $('#ttl').value = ttlDefault();

    // детали выбранных мест
    const rows = stands.map((s) => {
      const it = items[s.id];
      return `<div style="margin:5px 0">
        <b>${s.id}</b> — ${STATUS_LABEL[statusOf(s.id)]}${it ? `<br><span class="muted">${it.buyer || ''}${it.phone ? ' · ' + it.phone : ''} · ${it.sellerName || ''} · ${fmtDate(it.updatedAt)}${it.reservedUntil ? ' · бронь до ' + fmtDate(it.reservedUntil) : ''}</span>` : ''}
      </div>`;
    }).join('');
    $('#details').innerHTML = (isAdmin() || !CLIENT ? rows : '');
  }

  function renderBookings() {
    const card = $('#bookingsCard');
    if (!card || !layout) return;
    const units = ExpoGroups.groupBookings(layout.stands || [], items);
    card.hidden = !units.length;
    if (!units.length) return;
    $('#bookingsList').innerHTML = units.map((u) => `
      <div class="booking-row" data-ids="${u.ids.join(',')}" data-x="${u.x}" data-y="${u.y}" data-w="${u.w}" data-h="${u.h}">
        <span class="sw" style="background:${STATUS_COLOR[u.status]}"></span>
        <b title="${u.ids.join(', ')}">${u.label || 'Занято'}</b>
        <span class="bmuted">${standsWord(u.ids.length)} · ${fmtNum(u.areaM2)} м²</span>
        <span class="bids">${u.ids.length > 6 ? u.ids.slice(0, 6).join(', ') + ' +' + (u.ids.length - 6) : u.ids.join(', ')}</span>
      </div>`).join('');
    $$('#bookingsList .booking-row').forEach((r) => r.addEventListener('click', () => {
      selection = new Set(r.dataset.ids.split(','));
      const x = +r.dataset.x, y = +r.dataset.y, w = +r.dataset.w, h = +r.dataset.h;
      zoomToBox(x - 4, y - 4, w + 8, h + 8);
      renderSelection();
      paintSelection();
    }));
  }

  function zoomToBox(x, y, w, h) {
    const vw = layout.hall.width, vh = layout.hall.height;
    view.k = Math.min(8, Math.max(0.5, Math.min(vw / w, vh / h) * 0.85));
    view.tx = (vw / 2 - x) * view.k;
    view.ty = (vh / 2 - y) * view.k;
    applyView();
  }

  function renderStats() {
    const by = { free: 0, reserved: 0, sold: 0, blocked: 0 };
    const area = { free: 0, reserved: 0, sold: 0, blocked: 0 };
    let revenue = 0;
    // объединённые ячейки — тоже часть площади зала
    const merged = (layout.blocks || []).flatMap((b) => (b.merged || []).map((m) => ({
      id: `${b.id}~m`, areaM2: m.w * m.h, status: m.status || 'sold',
    })));
    for (const s of [...layout.stands, ...merged]) {
      const st = statusOf(s.id);
      by[st] = (by[st] || 0) + 1;
      area[st] = (area[st] || 0) + s.areaM2;
      if (st === 'sold') revenue += items[s.id]?.amount || 0;
    }
    const totalArea = [...layout.stands, ...merged].reduce((a, s) => a + s.areaM2, 0);
    $('#stats').innerHTML = `
      <div class="stat"><b>${by.free}</b><span>свободно · ${fmtNum(area.free)} м²</span></div>
      <div class="stat"><b>${by.reserved}</b><span>бронь · ${fmtNum(area.reserved)} м²</span></div>
      <div class="stat"><b>${by.sold}</b><span>продано · ${fmtNum(area.sold)} м²</span></div>
      <div class="stat"><b>${fmtNum(totalArea)}</b><span>всего м² · занято ${by.sold + by.reserved}</span></div>
      <div class="stat" style="grid-column:1/-1"><b>${fmtNum(revenue)}</b><span>сум продаж · ${fmtMln(revenue)}</span></div>`;
    renderStatCards();
  }

  function renderLegend() {
    const counts = { free: 0, reserved: 0, sold: 0, blocked: 0 };
    for (const s of layout.stands) counts[statusOf(s.id)] = (counts[statusOf(s.id)] || 0) + 1;
    $('#legend').innerHTML = Object.keys(STATUS_LABEL).filter((k) => counts[k] || k !== 'blocked').map((k) => `
      <div class="row">
        <span class="sw" style="background:${k === 'free' ? '#eaf6ec' : k === 'reserved' ? '#fff8e1' : k === 'sold' ? '#fdecea' : '#eceff1'};border-color:${STATUS_COLOR[k]}"></span>
        <label><input type="checkbox" data-st="${k}" ${hiddenStatuses.has(k) ? '' : 'checked'}/> ${STATUS_LABEL[k]} (${counts[k] || 0})</label>
      </div>`).join('') + `<div class="row muted" style="font-size:11.5px">1 стенд = 3×3 м = 9 м² · 1 блок = 8 стендов = 72 м²
        <br>Номер стенда — буква блока + номер сверху вниз: A1…A8.
        ${layout.customStands?.length ? `<br>${layout.customStands.length} стендов нестандартной площади (A1–A6 слева) — площадь указана на плане.` : ''}</div>`;
    $$('#legend input[data-st]').forEach((cb) => cb.addEventListener('change', () => {
      cb.checked ? hiddenStatuses.delete(cb.dataset.st) : hiddenStatuses.add(cb.dataset.st);
      applyFilters();
    }));
  }
  function applyFilters() {
    $$('#world .booking-unit').forEach((g) => {
      g.style.display = hiddenStatuses.has(g.dataset.status) ? 'none' : '';
      const secOk = !activeSection || layout.stands.find((x) => x.id === g.dataset.ids.split(',')[0])?.section === activeSection;
      g.classList.toggle('sec-off', !secOk);
    });
    $$('#world .stand').forEach((g) => {
      g.style.display = hiddenStatuses.has(g.dataset.status) ? 'none' : '';
      const st = layout.stands.find((x) => x.id === g.dataset.id);
      g.classList.toggle('sec-off', !!activeSection && st?.section !== activeSection);
    });
    $$('#world .block-chip, #world .sec-label, #world .sec-bar').forEach((n) => {
      const blockId = n.dataset.block || n.getAttribute('data-block');
      const b = layout.blocks.find((x) => x.id === blockId);
      if (!b) return;
      n.classList.toggle('sec-off', !!activeSection && b.section !== activeSection);
    });
  }

  // ------------------------------------------------------------ разделы
  function sectionStats() {
    return (layout.sections || []).map((sec) => {
      const stands = layout.stands.filter((s) => s.section === sec.id);
      const free = stands.filter((s) => statusOf(s.id) === 'free');
      const blocks = (layout.blocks || []).filter((b) => b.section === sec.id);
      const mergedArea = blocks.reduce((a, b) => a + (b.merged || []).reduce((x, m) => x + m.w * m.h, 0), 0);
      const area = stands.reduce((a, s) => a + s.areaM2, 0) + mergedArea;
      const freeArea = free.reduce((a, s) => a + s.areaM2, 0);
      return { sec, stands, free, area, freeArea, amount: freeArea * pricePerM2(), mergedArea };
    });
  }

  function renderSections() {
    const list = sectionStats();
    $('#sectionsCard').hidden = !list.length;
    if (!list.length) return;
    $('#sectionChips').innerHTML = list.map(({ sec, stands, free }) => {
      const active = activeSection === sec.id;
      return `<span class="chip sec${active ? ' active' : ''}" data-sec="${sec.id}" style="border-left-color:${sec.color}" title="${sec.short || ''} — ${sec.label}">
        <i class="dot" style="background:${sec.color}"></i>${sec.short || sec.label} <b>${free.length}/${stands.length}</b></span>`;
    }).join('');
    $$('#sectionChips .chip').forEach((c) => c.addEventListener('click', () => {
      activeSection = activeSection === c.dataset.sec ? null : c.dataset.sec;
      applyFilters(); renderSections(); renderSectionInfo();
    }));
    renderSectionInfo();
  }

  function renderSectionInfo() {
    const box = $('#sectionInfo');
    const list = sectionStats();
    const found = list.find((x) => x.sec.id === activeSection);
    if (!found) { box.hidden = true; $('#sectionActions').hidden = true; return; }
    const { sec, stands, free, area, freeArea, amount } = found;
    box.hidden = false;
    $('#sectionActions').hidden = CLIENT;
    const rows = list.map((r) => `<tr>
        <td><span class="swatch" style="background:${r.sec.color}"></span> ${r.sec.short || r.sec.label}</td>
        <td class="num">${r.stands.length}</td>
        <td class="num">${fmtNum(r.area)}</td>
        <td class="num">${r.free.length}</td>
        <td class="num">${fmtNum(r.freeArea)}</td>
      </tr>`).join('');
    box.innerHTML = `
      <div class="sec-head"><span class="swatch" style="background:${sec.color}"></span><b>${sec.label}</b></div>
      ${sec.short ? `<div class="muted">${sec.short} · раздел ${sec.id}</div>` : ''}
      <table class="sec-table">
        <thead><tr><th>Раздел</th><th class="num">Стендов</th><th class="num">м²</th><th class="num">Свободно</th><th class="num">Свободно м²</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="kv">
        <dt>В разделе</dt><dd><b>${standsWord(stands.length)}</b> · ${fmtNum(area)} м²${mergedArea ? ` <span class="muted">(${fmtNum(mergedArea)} м² объединённые ячейки)</span>` : ''}</dd>
        <dt>Свободно</dt><dd><b>${standsWord(free.length)}</b> · ${fmtNum(freeArea)} м²</dd>
        <dt>Цена (свободные места)</dt><dd>${pricePerM2() ? fmtMoney(amount) : '—'}</dd>
      </div>
      ${free.length && free.length <= 24 ? `<div class="muted">Свободно: ${free.map((s) => s.id).join(', ')}</div>` : ''}`;
  }

  $('#secClear').addEventListener('click', () => { activeSection = null; applyFilters(); renderSections(); });
  $('#secSelectFree').addEventListener('click', () => {
    const found = sectionStats().find((x) => x.sec.id === activeSection);
    if (!found) return;
    selection = new Set(found.free.map((s) => s.id));
    paintSelection(); renderSelection();
    toast(`${found.sec.short || found.sec.label}: выбрано ${found.free.length} свободных стендов (${fmtNum(found.freeArea)} м²)`);
  });

  // ------------------------------------------------------------ search
  let searchTerm = '';
  $('#search').addEventListener('input', (e) => { searchTerm = e.target.value.trim().toUpperCase(); applySearch(); });
  function applySearch() {
    if (!layout) return;
    const q = searchTerm;
    const secHit = (layout.sections || []).find((s) => s.short?.toUpperCase() === q || s.id.toUpperCase() === q);
    if (secHit && activeSection !== secHit.id) { activeSection = secHit.id; renderSections(); applyFilters(); }
    $$('#world .stand').forEach((g) => g.classList.toggle('dim', !!q && !g.dataset.id.includes(q) && !g.dataset.block.includes(q)));
    $$('#world .booking-unit').forEach((g) => g.classList.toggle('dim', !!q && !g.dataset.ids.includes(q) && !g.dataset.buyer.includes(q)));
    if (q && layout.stands.some((s) => s.id === q)) { selection = new Set([q]); paintSelection(); renderSelection(); }
  }

  // ------------------------------------------------------------ actions
  function confirmDialog(title, html) {
    return new Promise((resolve) => {
      $('#confirmTitle').textContent = title;
      $('#confirmBody').innerHTML = html;
      $('#confirm').hidden = false;
      const done = (v) => { $('#confirm').hidden = true; $('#confirmOk').onclick = null; $('#confirmCancel').onclick = null; resolve(v); };
      $('#confirmOk').onclick = () => done(true);
      $('#confirmCancel').onclick = () => done(false);
    });
  }

  async function doAction(action, standIds, extra = {}) {
    try {
      const r = await api('/api/action', { method: 'POST', body: { action, standIds, expectedRevision: revision, ...extra } });
      await refreshState(true);   // карта обновляется сразу (одна компания = одна рамка)
      renderStats(); renderLegend();
      const ids = standIds;
      if (action === 'sell') showReceipt(ids, extra, r.items);
      toast(`${action === 'sell' ? 'Продано' : action === 'reserve' ? 'Забронировано' : action === 'release' ? 'Освобождено' : 'Блокировано'}: ${ids.join(', ')}`, 'ok');
      selection = new Set();
      renderSelection(); paintSelection();
      if (isAdmin()) loadAudit();
    } catch (err) {
      if (err.code === 409 && err.data?.conflicts) {
        const c = err.data.conflicts.map((x) => `${x.standId} (${STATUS_LABEL[x.status] || x.status}${x.sellerName ? ', ' + x.sellerName : ''})`);
        fail(`Уже занято: ${c.join(', ')}. Страница обновлена — выберите заново.`);
        await refreshState();
      } else if (err.code !== 401) {
        fail(err.message);
      }
      throw err;
    }
  }
  $('#btnReserve').addEventListener('click', async () => {
    const { free, area, amount, blocks } = selectionInfo();
    if (!free.length) return;
    const buyer = $('#buyer').value.trim();
    if (!buyer) return fail('Введите имя клиента');
    const ttl = Number($('#ttl').value || ttlDefault());
    const ok = await confirmDialog('Подтвердите бронь', `
      <p>${standsWord(free.length)} (${fmtNum(area)} м²) бронируются на ${ttl} ч.:</p>
      <p><b>${free.map((s) => s.id).join(', ')}</b></p>
      <table>
        <tr><td>Блок(и)</td><td>${blocks.join(', ')}</td></tr>
        <tr><td>Клиент</td><td>${buyer}</td></tr>
        <tr><td>Сумма (по согласованию)</td><td>${amount ? fmtMoney(amount) : 'цена не указана'}</td></tr>
      </table>
      <p class="muted">Бронь действует до ${fmtDate(new Date(Date.now() + ttl * 3600e3).toISOString())}, затем снимается автоматически.</p>`);
    if (!ok) return;
    await doAction('reserve', free.map((s) => s.id), { buyer, phone: $('#phone').value, company: $('#company').value, note: $('#note').value, ttlHours: ttl }).catch(() => {});
  });

  $('#btnSell').addEventListener('click', async () => {
    const { free, area, amount, blocks, taken } = selectionInfo();
    if (!free.length) return;
    const buyer = $('#buyer').value.trim();
    if (!buyer) return fail('Введите имя клиента');
    const ok = await confirmDialog('Подтвердите ПРОДАЖУ', `
      <p style="margin-top:0">Эти места будут отмечены как <b>проданные</b>. Клиенту называются именно эти ID:</p>
      <p style="font-size:15px"><b>${free.map((s) => s.id).join(', ')}</b></p>
      <table>
        <tr><td>Блок(и)</td><td>${blocks.join(', ')}</td></tr>
        <tr><td>Площадь</td><td>${standsWord(free.length)} × 9 м² = ${fmtNum(area)} м²</td></tr>
        <tr><td>Клиент</td><td>${buyer} ${$('#phone').value ? '· ' + $('#phone').value : ''}</td></tr>
        <tr><td><b>Сумма</b></td><td><b>${amount ? fmtMoney(amount) : 'цена не указана'}</b></td></tr>
      </table>
      ${taken.length ? `<p class="muted">Внимание: из выбранных ${taken.length} стендов часть занята — продаются только свободные.</p>` : ''}
      <p class="muted">Операция записывается в журнал: кто, когда и какие места продал.</p>`);
    if (!ok) return;
    await doAction('sell', free.map((s) => s.id), { buyer, phone: $('#phone').value, company: $('#company').value, note: $('#note').value }).catch(() => {});
  });

  $('#btnRelease').addEventListener('click', async () => {
    const { stands } = selectionInfo();
    const releasable = stands.filter((s) => statusOf(s.id) !== 'free');
    if (!releasable.length) return;
    const ok = await confirmDialog('Подтвердите освобождение', `
      <p>Записи о брони/продаже будут удалены, места снова станут <b>свободными</b>:</p>
      <p><b>${releasable.map((s) => s.id).join(', ')}</b></p>
      <p class="muted">Проданное место освобождает только менеджер. Операция пишется в журнал.</p>`);
    if (!ok) return;
    await doAction('release', releasable.map((s) => s.id), { note: $('#note').value }).catch(() => {});
  });

  $('#clearSel').addEventListener('click', () => { selection.clear(); renderSelection(); paintSelection(); });

  function showReceipt(standIds, extra, result) {
    const area = standIds.reduce((a, id) => a + (layout.stands.find((s) => s.id === id)?.areaM2 || 0), 0);
    const amount = standIds.reduce((a, id) => a + (result?.[id]?.amount || 0), 0);
    const blockIds = [...new Set(standIds.map((id) => id.split('-').slice(0, 2).join('-')))];
    $('#receipt').hidden = false;
    $('#receipt').innerHTML = `
      <h2>Квитанция о продаже ✓</h2>
      <div>Проданные места: <b>${standIds.join(', ')}</b></div>
      <div>Группы: ${blockIds.join(', ')} · Площадь: ${standIds.length} стендов = <b>${fmtNum(area)} м²</b></div>
      <div>Клиент: <b>${extra.buyer || ''}</b> ${extra.phone || ''} ${extra.company ? '· ' + extra.company : ''}</div>
      <div>Сумма: <b>${amount ? fmtMoney(amount) : 'цена не указана'}</b>${amount ? ` (${fmtMln(amount)})` : ''}</div>
      <div class="muted">Продавец: ${seller?.name || ''} · ${fmtDate(new Date().toISOString())} · ${layout.meta.project}, ${layout.meta.hall} · версия плана v${layout.meta.version}</div>
      <div class="actions"><button class="btn" id="printReceipt">Печать квитанции</button></div>`;
    $('#printReceipt').onclick = () => { document.body.classList.add('print-receipt'); window.print(); };
    window.onafterprint = () => document.body.classList.remove('print-receipt');
  }

  function showClientInfo(id) {
    const s = layout.stands.find((x) => x.id === id);
    const st = statusOf(id);
    toast(`${s.id} · ${STATUS_LABEL[st]} · 9 м²`);
  }

  // ------------------------------------------------------------ режим клиента / печать / ссылка
  $('#clientMode').addEventListener('click', async () => {
    if ((layout?.meta?.status || 'draft') !== 'approved') {
      return fail('План ещё ЧЕРНОВИК — перед отправкой клиенту подтвердите размеры (meta.status = "approved").');
    }
    const url = new URL(location.href);
    url.searchParams.set('mode', 'client');
    try { await navigator.clipboard.writeText(url.toString()); toast('Ссылка для клиента скопирована: ' + url.toString()); }
    catch { window.open(url.toString(), '_blank'); }
  });

  /** Печать: шапка листа (проект, дата, цена) + строка «свободно/продано» над планом. */
  function buildPrintHead() {
    let head = $('#printHead');
    if (!head) {
      head = document.createElement('div');
      head.id = 'printHead';
      head.className = 'print-only-head';
      $('.map-wrap').prepend(head);
    }
    const by = { free: 0, reserved: 0, sold: 0, blocked: 0 };
    let area = { free: 0, sold: 0, reserved: 0 };
    for (const s of layout.stands) {
      const st = statusOf(s.id);
      by[st] = (by[st] || 0) + 1;
      if (area[st] !== undefined) area[st] += s.areaM2;
    }
    const totalArea = layout.stands.reduce((a, s) => a + s.areaM2, 0);
    head.innerHTML = `
      <div class="ph-row">
        <div class="ph-title">${layout.meta.project} — ${layout.meta.hall}</div>
        <div class="ph-date">${new Date().toLocaleDateString('ru-RU')}</div>
      </div>
      <div class="ph-sub">
        План залов · версия v${layout.meta.version || '?'} · 1 стенд = 3 × 3 м = 9 м² · 1 блок = 8 стендов = 72 м²${layout.meta.pricePerM2 ? ' · ' + fmtMoney(layout.meta.pricePerM2) + '/м²' : ''}
      </div>
      <div class="ph-sub">
        <b>Свободно: ${standsWord(by.free)} · ${fmtNum(area.free)} м²</b> ·
        продано: ${standsWord(by.sold)} · ${fmtNum(area.sold)} м² ·
        бронь: ${by.reserved}${by.blocked ? ' · блокировано: ' + by.blocked : ''} ·
        всего: ${standsWord(layout.stands.length)} · ${fmtNum(totalArea)} м²
      </div>`;
    return head;
  }

  function buildPrintSheet() {
    let sheet = $('#printSheet');
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.id = 'printSheet';
      sheet.className = 'print-only';
      document.body.appendChild(sheet);
    }
    const freeIds = layout.stands.filter((s) => statusOf(s.id) === 'free').map((s) => s.id);
    const rows = layout.blocks.filter((b) => b.kind !== 'custom').map((b) => {
      const cnt = { free: 0, reserved: 0, sold: 0, blocked: 0 };
      b.stands.forEach((s) => cnt[statusOf(s.id)]++);
      return `<tr><td>${b.id}</td><td>${b.stands.length} × 9 = ${fmtNum(b.areaM2)} м²</td><td>${cnt.free}</td><td>${cnt.reserved}</td><td>${cnt.sold}</td><td>${cnt.free ? b.stands.filter((s) => statusOf(s.id) === 'free').map((s) => s.id).join(', ') : '—'}</td></tr>`;
    }).join('');
    const secRows = sectionStats().map(({ sec, stands, free, area, freeArea }) => `<tr>
        <td>${sec.label}</td>
        <td>${stands.length}</td><td>${fmtNum(area)} м²</td>
        <td>${free.length}</td><td>${fmtNum(freeArea)} м²</td>
        <td>${free.length ? free.map((s) => s.id).join(', ') : '—'}</td>
      </tr>`).join('');
    sheet.innerHTML = `
      <h2>${layout.meta.project} — ${layout.meta.hall} · план залов (v${layout.meta.version})</h2>
      <p>1 стенд = 3×3 м = 9 м² · 1 блок = 8 стендов = 72 м² · Цена: ${layout.meta.pricePerM2 ? fmtMoney(layout.meta.pricePerM2) + '/м²' : '—'} · Дата: ${fmtDate(new Date().toISOString())}</p>
      <p><b>Свободные места (${freeIds.length} стендов = ${fmtNum(freeIds.length * 9)} м²):</b> ${freeIds.join(', ') || '—'}</p>
      <table>
        <thead><tr><th>Блок</th><th>Площадь</th><th>Свободно</th><th>Бронь</th><th>Продано</th><th>ID свободных стендов</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${(() => {
        const m = new Map();
        for (const s of layout.stands) {
          const it = items[s.id];
          if (!it?.buyer) continue;
          const k = it.buyer + '||' + it.status;
          if (!m.has(k)) m.set(k, { buyer: it.buyer, status: it.status, ids: [], area: 0 });
          const r = m.get(k); r.ids.push(s.id); r.area += s.areaM2;
        }
        const list = [...m.values()].sort((a, b) => b.area - a.area);
        if (!list.length) return '';
        return `<h3>Компании (занятые места)</h3>
        <table><thead><tr><th>Компания</th><th>Статус</th><th>Стендов</th><th>Площадь</th><th>ID стендов</th></tr></thead>
        <tbody>${list.map((r) => `<tr><td><b>${r.buyer}</b></td><td>${STATUS_LABEL[r.status]}</td><td>${r.ids.length}</td><td>${fmtNum(r.area)} м²</td><td>${r.ids.join(', ')}</td></tr>`).join('')}</tbody></table>`;
      })()}
      ${secRows ? `<h3>По разделам</h3>
      <table>
        <thead><tr><th>Раздел</th><th>Стендов</th><th>Площадь</th><th>Свободно</th><th>Свободная площадь</th><th>ID свободных стендов</th></tr></thead>
        <tbody>${secRows}</tbody>
      </table>` : ''}
      <p style="margin-top:6mm">Примечание для клиента: купленные места отмечены на плане по ID. ID стенда в договоре совпадает с местом на плане.</p>`;
  }
  // Вписывает план в лист A4 landscape (поля 8 мм) — PDF получается на одну страницу
  function fitPrintPage() {
    const svg = $('#map');
    const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    if (vb.length !== 4 || !(vb[2] > 0) || !(vb[3] > 0)) return;
    const mmW = 404, mmH = 281;
    const k = Math.min(mmW / vb[2], mmH / vb[3]);
    svg.style.width = (vb[2] * k).toFixed(1) + 'mm';
    svg.style.height = (vb[3] * k).toFixed(1) + 'mm';
    svg.style.maxWidth = 'none';
  }
  window.addEventListener('afterprint', () => {
    const s2 = $('#map');
    s2.style.width = ''; s2.style.height = ''; s2.style.maxWidth = '';
  });
  // ------------------------------------------------------------ печать листа A4 landscape
  // Готовый лист берём у сервера (/api/export/svg) — тот самый файл, что уходит клиенту:
  // он уже сверстан под А3, поэтому печать даёт ровно одну страницу, без склейки и полей.
  let planSvgMarkup = null;

  async function ensurePrintPage() {
    let page = document.getElementById('printPage');
    if (!page) {
      page = document.createElement('div');
      page.id = 'printPage';
      document.body.appendChild(page);
    }
    if (!planSvgMarkup) {
      const r = await fetch('/api/export/svg');
      if (!r.ok) throw new Error(`лист A4 недоступен (${r.status})`);
      planSvgMarkup = await r.text();
    }
    if (!page.querySelector('svg')) {
      page.innerHTML = planSvgMarkup;
      const svg = page.querySelector('svg');
      const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
      if (svg && vb.length === 4 && vb[2] > 0) {
        const mm = 295; // ширина листа A4 минус запас: вписываем чертёж в страницу целиком
        const k = mm / vb[2];
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.style.width = mm + 'mm';
        svg.style.height = (vb[3] * k).toFixed(2) + 'mm';
      }
    }
    return page;
  }

  async function preparePrint() {
    const tables = !!$('#printTables')?.checked;
    document.body.classList.add('print-sheet');
    document.body.classList.toggle('print-tables', tables);
    buildPrintSheet();
    try {
      await ensurePrintPage();
      document.body.classList.add('print-sheet-ok');
    } catch (e) {
      // запасной путь: печатаем живую карту (как раньше) — без готового листа
      document.body.classList.remove('print-sheet-ok');
      buildPrintHead();
      fitPrintPage();
      console.warn('печать: ' + e.message);
    }
  }
  window.addEventListener('beforeprint', () => { preparePrint().catch(() => {}); });
  $('#printBtn').addEventListener('click', async () => { await preparePrint(); window.print(); });

  // ------------------------------------------------------------ скачать PDF
  const pdfPage = () => String(layout?.meta?.format || 'A4').toUpperCase();
  const pdfUrl = (disp) => `/api/export/pdf?page=${encodeURIComponent(pdfPage())}${disp ? '&disp=' + disp : ''}`;
  const pngUrl = (scale = 1.6) => `/api/export/png?page=${encodeURIComponent(pdfPage())}&scale=${scale}`;
  const pdfName = () => `FOODERA-EXPO-2026-plan-${pdfPage()}.pdf`;   // A4 landscape, одна страница
  const isEmbedded = () => { try { return window.self !== window.top; } catch { return true; } };

  let pdfReady = null; // null — сервер ещё не ответил, true/false — его ответ
  let pngReady = null; // есть ли предпросмотр картинкой (pypdfium2 на сервере)
  (async () => {
    try {
      const h = await fetch('/api/healthz').then((r) => r.json());
      pdfReady = !!h?.pdf;
      pngReady = !!h?.png;
    } catch { /* сервер не ответил — проверим при клике */ }
  })();

  // Новая вкладка: в песочнице она может быть запрещена — тогда просто вернём null.
  function openTab(url) { try { return window.open(url, '_blank', 'noopener'); } catch { return null; } }

  // Скачиваем файл под готовым именем (то же самое, что делает обычная ссылка с download).
  async function downloadPdf() {
    const r = await fetch(pdfUrl());
    if (!r.ok) {
      let m = `не удалось получить PDF (${r.status})`;
      try { const j = await r.json(); if (j?.message) m = j.message; } catch { /* ответ не JSON */ }
      throw new Error(m);
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = pdfName(); a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(`Файл ${pdfName()} — скачивается`);
    return true;
  }

  // Окно «PDF готов»: предпросмотр листа + все способы сохранить файл.
  function showPdfHelp(why) {
    const box = $('#pdfHelp');
    if (!box) return;
    const whyEl = $('#pdfHelpWhy');
    if (whyEl) { whyEl.textContent = why || ''; whyEl.hidden = !why; }
    const img = $('#pdfHelpImg');
    const note = $('#pdfHelpNote');
    if (img) {
      if (pngReady === false) {
        img.hidden = true; img.removeAttribute('src');
        if (note) note.hidden = false;
      } else {
        img.hidden = false;
        if (note) note.hidden = true;
        const src = pngUrl();
        if (img.getAttribute('src') !== src) img.setAttribute('src', src);
      }
    }
    const open = $('#pdfHelpOpen');
    if (open) open.href = pdfUrl('inline');
    box.hidden = false;
  }
  function hidePdfHelp() {
    const box = $('#pdfHelp');
    if (!box) return;
    box.hidden = true;
    $('#pdfHelpImg')?.removeAttribute('src');
  }
  $('#pdfHelpClose')?.addEventListener('click', hidePdfHelp);
  $('#pdfHelp')?.addEventListener('click', (e) => { if (e.target.id === 'pdfHelp') hidePdfHelp(); });
  $('#pdfHelpCopy')?.addEventListener('click', async () => {
    const url = new URL(pdfUrl('inline'), location.href).href;
    try { await navigator.clipboard.writeText(url); toast('Ссылка скопирована: ' + url); }
    catch { toast('Ссылка: ' + url); }
  });
  $('#pdfHelpPrint')?.addEventListener('click', async function () {
    const b = this;
    const label = b.textContent;
    b.disabled = true; b.textContent = 'Готовим лист…';
    try {
      hidePdfHelp();
      await preparePrint();
      window.print();
    } finally {
      b.disabled = false; b.textContent = label;
    }
  });
  $('#pdfHelpSave')?.addEventListener('click', async () => {
    try { await downloadPdf(); }
    catch (e) { fail(`Не удалось скачать PDF: ${e.message}. Используйте «Печать → Сохранить как PDF».`); }
  });

  $('#pdfBtn')?.addEventListener('click', async () => {
    const btn = $('#pdfBtn');
    const label = btn.textContent;
    if (pdfReady === false) {
      return fail('На сервере нет PDF-модуля (python3 + reportlab). Используйте «Печать плана» → «Сохранить как PDF».');
    }
    btn.disabled = true;
    btn.textContent = 'Готовим PDF…';
    try {
      // 1) Панель открыта внутри рамки (предпросмотр): браузеры запрещают и скачивание, и просмотр PDF
      //    в таких окнах — поэтому сразу показываем окно «PDF готов» с картинкой листа и кнопками.
      if (isEmbedded()) {
        showPdfHelp('');
        toast('Лист A4 готов — сохраните его из окна');
        return;
      }
      // 2) Обычное скачивание: забираем файл и отдаём браузеру под готовым именем.
      await downloadPdf();
    } catch (e) {
      // 3) Не вышло скачать — предлагаем вкладку, предпросмотр на месте и печать в PDF.
      const win = openTab(pdfUrl('inline'));
      if (win) { toast('PDF открыт в новой вкладке — сохраните его кнопкой браузера'); return; }
      fail(`Не удалось скачать PDF: ${e.message}`);
      showPdfHelp(`Не удалось скачать файл: ${e.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });

  // ------------------------------------------------------------ карточки, закладки, таблицы
  function planTotals() {
    const merged = (layout.blocks || []).flatMap((b) => (b.merged || []).map((m) => ({
      id: `${b.id}~m`, areaM2: m.w * m.h, status: m.status || 'sold',
    })));
    const all = [...(layout.stands || []), ...merged];
    const by = { free: 0, reserved: 0, sold: 0, blocked: 0 };
    const area = { free: 0, reserved: 0, sold: 0, blocked: 0 };
    for (const s of all) {
      const st = statusOf(s.id);
      by[st] = (by[st] || 0) + 1;
      area[st] = (area[st] || 0) + s.areaM2;
    }
    return {
      by, area,
      total: all.reduce((a, s) => a + s.areaM2, 0),
      places: all.length,
      blocks: (layout.blocks || []).filter((b) => (b.kind || 'grid') !== 'custom').length,
      custom: (layout.blocks || []).filter((b) => b.kind === 'custom').length,
      deals: ExpoGroups.groupBookings(layout.stands || [], items).length,
    };
  }

  function renderStatCards() {
    const box = $('#statCards');
    if (!box || !layout) return;
    const t = planTotals();
    const card = (name, num, unit, note, color) => `
      <div class="card-stat">
        <span class="cs-name">${name}</span>
        <span class="cs-value">${fmtNum(num)}<small>${unit}</small></span>
        <span class="cs-bar"><i style="width:${t.total ? Math.round((num / t.total) * 100) : 0}%;background:${color}"></i></span>
        <span class="cs-note">${note}</span>
      </div>`;
    const note = `Мест: ${fmtNum(t.places)} · блоков: ${fmtNum(t.blocks)}${t.custom ? ` · нестандартных: ${fmtNum(t.custom)}` : ''}`;
    const cnt = $('#dealsCount');
    if (cnt) cnt.textContent = String(t.deals);
    box.innerHTML =
      card('Общая площадь', t.total, 'м²', note, '#90a4ae') +
      card('Доступно для продажи', t.area.free, 'м²', `Свободных мест: ${fmtNum(t.by.free)}`, '#2e7d32') +
      card('Забронировано', t.area.reserved, 'м²', `Забронировано ячеек: ${fmtNum(t.by.reserved)}`, '#f59e0b') +
      card('Продано', t.area.sold, 'м²', `Активных сделок: ${fmtNum(t.deals)}`, '#c62828');
  }

  function setTab(name) {
    $$('#viewTabs .tab').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === name));
    for (const t of ['map', 'deals', 'history', 'source']) {
      const pane = $('#pane-' + t);
      if (pane) pane.hidden = t !== name;
    }
    if (name === 'deals') renderDeals();
    if (name === 'history') renderHistory();
    if (name === 'source') renderSourcePlan();
  }
  $$('#viewTabs .tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  if (CLIENT) $('#viewTabs').hidden = true;

  // Сделки: одна строка — одна компания (даже если она заняла несколько стендов).
  function renderDeals() {
    const box = $('#dealsTable');
    if (!box || !layout) return;
    const units = ExpoGroups.groupBookings(layout.stands || [], items);
    const cnt = $('#dealsCount');
    if (cnt) cnt.textContent = String(units.length);
    if (!units.length) { box.innerHTML = '<p class="muted">Пока нет ни одной брони или продажи.</p>'; return; }
    const price = pricePerM2();
    const rows = units.map((u) => {
      const it = items[u.ids[0]] || {};
      const amount = it.amount || (price ? u.areaM2 * price : 0);
      return `<tr data-ids="${u.ids.join(',')}" data-x="${u.x}" data-y="${u.y}" data-w="${u.w}" data-h="${u.h}">
        <td><b>${u.label || 'Без названия'}</b>${it.buyer && it.company ? `<br><span class="muted">${it.buyer}</span>` : ''}</td>
        <td>${u.ids.join(', ')}</td>
        <td class="num">${fmtNum(u.areaM2)} м²</td>
        <td>${STATUS_LABEL[u.status] || u.status}</td>
        <td>${it.sellerName || '—'}</td>
        <td>${it.phone || '—'}</td>
        <td class="num">${amount ? fmtMoney(amount) : '—'}</td>
        <td>${fmtDate(it.updatedAt)}</td>
      </tr>`;
    }).join('');
    box.innerHTML = `<table class="data"><thead><tr><th>Компания</th><th>Стенды</th><th>Площадь</th><th>Статус</th>
      <th>Продавец</th><th>Телефон</th><th>Сумма</th><th>Обновлено</th></tr></thead><tbody>${rows}</tbody></table>`;
    $$('#dealsTable tr[data-ids]').forEach((tr) => tr.addEventListener('click', () => {
      selection = new Set(tr.dataset.ids.split(','));
      setTab('map');
      zoomToBox(+tr.dataset.x - 4, +tr.dataset.y - 4, +tr.dataset.w + 8, +tr.dataset.h + 8);
      renderSelection();
      paintSelection();
    }));
  }

  // История действий — журнал операций (только администратор).
  async function renderHistory() {
    const box = $('#historyTable');
    if (!box) return;
    if (!isAdmin()) { box.innerHTML = '<p class="muted">История доступна только администратору.</p>'; return; }
    box.innerHTML = '<p class="muted">Загружаем…</p>';
    try {
      const r = await api('/api/audit?limit=200');
      const ACT = { sell: 'Продажа', reserve: 'Бронь', release: 'Освобождение', block: 'Блокировка', expire: 'Снятие брони', login: 'Вход' };
      if (!r.entries.length) { box.innerHTML = '<p class="muted">Записей пока нет.</p>'; return; }
      box.innerHTML = `<table class="data"><thead><tr><th>Время</th><th>Продавец</th><th>Действие</th><th>Стенды</th><th>Клиент</th></tr></thead><tbody>${
        r.entries.map((e) => `<tr><td>${fmtDate(e.ts)}</td><td>${e.sellerName || e.sellerId || '—'}</td>
          <td>${ACT[e.action] || e.action}</td><td>${(e.standIds || []).join(', ') || '—'}</td><td>${e.buyer || '—'}</td></tr>`).join('')}</tbody></table>`;
    } catch (e) {
      box.innerHTML = `<p class="muted">Не удалось загрузить историю: ${e.message}</p>`;
    }
  }

  // Исходный план — чертёж зала. Файл кладётся рядом с панелью: app/plan-source.png (или .jpg/.jpeg).
  function renderSourcePlan() {
    const box = $('#sourcePlan');
    const hint = $('#sourceHint');
    if (!box) return;
    const miss = () => {
      box.innerHTML = '<p class="muted">Исходный чертёж не загружен.</p>';
      if (hint) hint.textContent = 'Пришлите файл чертежа (PNG/JPG) — положите его рядом с панелью как app/plan-source.png, и он появится здесь. Пока посмотрите готовый лист A4.';
    };
    if (hint) hint.textContent = 'Чертёж, по которому собран план зала.';
    box.innerHTML = '<p class="muted">Загружаем…</p>';
    const candidates = ['plan-source.png', 'plan-source.jpg', 'plan-source.jpeg'];
    let i = 0;
    const tryNext = () => {
      if (i >= candidates.length) { miss(); return; }
      const img = new Image();
      img.alt = 'Исходный план зала';
      img.onload = () => {
        box.innerHTML = '';
        box.appendChild(img);
        if (hint) hint.textContent = 'Чертёж, по которому собран план зала.';
      };
      img.onerror = () => { i += 1; tryNext(); };
      img.src = candidates[i];
    };
    tryNext();
    setTimeout(() => { if (!box.querySelector('img')) miss(); }, 1500);
  }
  $('#sourceShowA3')?.addEventListener('click', () => {
    showPdfHelp('Готовый лист A4: так план уходит клиенту. Скачайте файл или сохраните его через печать.');
  });

  // ------------------------------------------------------------ start
  (async () => {
    try {
      if (CLIENT) {
        $('#login').style.display = 'none';
        $('#clientMode').hidden = true;
        $('#logoutBtn').hidden = true;
        $('#formFields').hidden = true;
        await loadAll();
      } else if (token && seller) {
        $('#login').style.display = 'none';
        startSession();
        await loadAll();
      } else {
        await loadAll(); // за экраном входа карта уже готова
      }
      setInterval(() => refreshState().catch(() => {}), 8000);
      setInterval(() => { if (isAdmin()) loadAudit(); }, 30000);
    } catch (e) {
      fail(e.message);
    }
  })();
})();
