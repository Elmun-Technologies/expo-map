/* Ekspo xaritasi — sotuv paneli (vanilla JS, build yo'q) */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const CLIENT = new URLSearchParams(location.search).get('mode') === 'client';

  let layout = null;          // /api/layout javobi
  let items = {};             // standId -> {status, buyer, ...}  (free bo'lsa kalit yo'q)
  let revision = 0;
  let seller = JSON.parse(localStorage.getItem('expo.seller') || 'null');
  let token = localStorage.getItem('expo.token') || null;
  let selection = new Set();
  let hiddenStatuses = new Set();

  // ------------------------------------------------------------ utils
  const fmtNum = (n) => Number(n || 0).toLocaleString('ru-RU').replace(/\u00A0/g, ' ');
  const fmtMoney = (n) => `${fmtNum(n)} so'm`;
  const fmtMln = (n) => `${(Number(n || 0) / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} mln so'm`;
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const statusOf = (id) => items[id]?.status || 'free';
  const STATUS_LABEL = { free: "Bo'sh", reserved: 'Bron', sold: 'Sotilgan', blocked: 'Bloklangan' };
  const STATUS_COLOR = { free: '#2e7d32', reserved: '#f59e0b', sold: '#c62828', blocked: '#607d8b' };
  const pricePerM2 = () => Number(layout?.meta?.pricePerM2 || 0);
  const ttlDefault = () => Number(layout?.meta?.reserveTtlHours || 72);
  const isAdmin = () => seller?.role === 'admin';

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
    if (res.status === 401 && !CLIENT) { doLogout(true); throw Object.assign(new Error(data.message || 'Sessiya tugadi'), { code: 401 }); }
    if (!res.ok) throw Object.assign(new Error(data.message || 'Xatolik'), { code: res.status, data });
    return data;
  }

  async function loadAll() {
    layout = await api('/api/layout');
    await refreshState();
    renderMap();
    renderStats();
    renderLegend();
    document.title = `${layout.meta.hall} · Ekspo xaritasi`;
    const msgs = [];
    if ((layout.meta.status || 'draft') !== 'approved') {
      msgs.push(`⚠ QORALAMA XARITA (v${layout.meta.version || '?'}) — raqamlar tasdiqlanmagan, mijozga yuborib bo'lmaydi.`);
    }
    const deviants = (layout.blocks || []).filter((b) => b.kind !== 'custom' && Math.abs(b.areaM2 - 72) > 0.01);
    if (deviants.length) {
      const some = deviants.slice(0, 4).map((b) => `${b.label} = ${fmtNum(b.areaM2)} m²`).join(', ');
      msgs.push(`ℹ Bu zaldagi guruhlar 72 m² (8×9) qoidasidan farq qiladi: ${some}${deviants.length > 4 ? ` va yana ${deviants.length - 4} ta` : ''}. Narx va maydon har bir guruh bo'yicha hisoblanadi.`);
    }
    const customCount = (layout.customStands || []).length;
    if (customCount) msgs.push(`ℹ ${customCount} ta nostandart stend (A1–A6 kabi) — maydoni xaritada yozilgan, narxi o'sha maydon bo'yicha.`);
    if (msgs.length) {
      $('#draftBanner').hidden = false;
      $('#draftBanner').className = 'draft-banner' + ((layout.meta.status || 'draft') !== 'approved' ? '' : ' info');
      $('#draftBanner').textContent = msgs.join('  |  ');
    }
    $('#hallTitle').textContent = `${layout.meta.project} — ${layout.meta.hall}`;
    $('#hallSub').textContent = `${layout.blocks.length} blok · ${layout.stands.length} stend · ${fmtNum(layout.stands.length * 9)} m² · layout v${layout.meta.version || '?'}`;
  }

  async function refreshState() {
    const s = await api('/api/state');
    const changed = s.revision !== revision;
    revision = s.revision;
    items = s.items || {};
    if (changed) {
      // tanlovdagi joy band bo'lib qolgan bo'lsa — ogohlantiramiz
      if (selection.size) {
        const taken = [...selection].filter((id) => statusOf(id) !== 'free');
        if (taken.length) {
          taken.forEach((id) => selection.delete(id));
          toast(`Diqqat: ${taken.join(', ')} boshqa sotuvchi tomonidan band qilindi — tanlovdan chiqarildi.`, 'err');
        }
      }
      renderMap(); renderStats(); renderLegend(); renderSelection();
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
    $('#who').innerHTML = `Sotuvchi: <b>${seller.name}</b>${isAdmin() ? ' (menejer)' : ''}`;
    $('#auditCard').hidden = !isAdmin();
    if (isAdmin()) loadAudit();
    renderSelection();
  }

  async function loadAudit() {
    try {
      const r = await api('/api/audit?limit=50');
      $('#auditList').innerHTML = r.entries.map((e) => `<div><b>${fmtDate(e.ts)}</b> — ${e.sellerName || e.sellerId}: ${e.action}${e.standIds?.length ? ' · ' + e.standIds.join(', ') : ''}${e.buyer ? ' · ' + e.buyer : ''}</div>`).join('') || '<div class="muted">Yozuv yo\'q</div>';
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

    // zonalar (asosiy zal, chap qanot, B2B, konferens...)
    const zoneG = el('g');
    for (const z of layout.zones || []) {
      if (!z.w || !z.h) continue;
      zoneG.appendChild(el('rect', { x: z.x, y: z.y, width: z.w, height: z.h, rx: 0.4, fill: z.color || '#f2f5f8', stroke: '#c9d4de', 'stroke-width': 0.14, 'stroke-dasharray': '1.2 .8' }));
      const t = el('text', { x: z.x + 0.6, y: z.y + 1.5, fill: '#7d8b98', 'font-size': 1.15 }, z.label);
      t.setAttribute('class', 'zone-label');
      zoneG.appendChild(t);
    }
    world.appendChild(zoneG);

    // zal
    const hallG = el('g');
    const outline = layout.hall.outline?.length >= 3 ? layout.hall.outline.map((p) => p.join(',')).join(' ') : `0,0 ${W},0 ${W},${H} 0,${H}`;
    hallG.appendChild(el('polygon', { points: outline, class: 'hall-outline' }));
    for (const f of layout.features || []) {
      hallG.appendChild(el('rect', { x: f.x, y: f.y, width: f.w ?? 2, height: f.h ?? 2, class: 'feature ' + (f.type || '') , rx: 0.2 }));
      if (f.label) {
        const t = el('text', { x: (f.x) + (f.w ?? 2) / 2, y: (f.y) + (f.h ?? 2) / 2, class: 'feature-label' }, f.label);
        t.style.fontSize = Math.max(0.9, Math.min(1.4, (f.w || 4) / 7)) + 'px';
        hallG.appendChild(t);
      }
    }
    world.appendChild(hallG);

    const blockG = el('g');
    const standG = el('g');
    for (const b of layout.blocks) {
      blockG.appendChild(el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, class: 'block-outline', rx: 0.3, stroke: b.color || '#90a4b5' }));

      // blok nomi — bosilsa butun blok tanlanadi
      const chip = el('g', { class: 'block-chip', 'data-block': b.id, tabindex: '0' });
      const label = b.label;
      const cw = Math.max(5.4, label.length * 1.15 + 3.4);
      chip.appendChild(el('rect', { x: b.x, y: b.y - 1.95, width: cw, height: 1.5, rx: 0.35, fill: b.color || '#0f2233' }));
      chip.appendChild(el('text', { x: b.x + cw / 2, y: b.y - 1.2 }, `${label} · ${fmtNum(b.areaM2)} m²`));
      chip.appendChild(el('title', {}, `${label} bloki — ${b.stands.length} stend × 9 m² = ${fmtNum(b.areaM2)} m². Bosib butun blokni tanlang.`));
      blockG.appendChild(chip);

      if (b.kind === 'custom') continue; // nostandart stendlar pastda alohida chiziladi
      for (const s of b.stands) standG.appendChild(standNode(s));
    }
    // nostandart o'lchamdagi stendlar (A1–A6 kabi)
    for (const s of layout.customStands || []) standG.appendChild(standNode(s, true));
    world.appendChild(blockG);
    world.appendChild(standG);
    applyView();
    applyFilters();
    applySearch();
  }

  function standNode(s, custom) {
    const st = statusOf(s.id);
    const g = el('g', { class: 'stand' + (custom ? ' custom' : ''), 'data-id': s.id, 'data-status': st, 'data-block': s.blockId });
    g.appendChild(el('rect', { x: s.x, y: s.y, width: s.w, height: s.h, class: 'box', rx: 0.25, stroke: s.color || undefined }));
    if (custom) {
      g.appendChild(el('text', { x: s.x + s.w / 2, y: s.y + s.h / 2 - 0.25, class: 'num' }, s.label || s.id));
      g.appendChild(el('text', { x: s.x + s.w / 2, y: s.y + s.h / 2 + 1.15, class: 'area' }, `${fmtNum(s.areaM2)} m²`));
    } else {
      g.appendChild(el('text', { x: s.x + s.w / 2, y: s.y + s.h / 2, class: 'num' }, s.noLabel));
    }
    g.appendChild(el('title', {}, `${s.id} · ${fmtNum(s.areaM2)} m² · ${STATUS_LABEL[st]}${items[s.id]?.buyer ? ' · ' + items[s.id].buyer : ''}${s.note ? ' · ' + s.note : ''}`));
    return g;
  }

  function applyView() { $('#world').setAttribute('transform', `translate(${view.tx} ${view.ty}) scale(${view.k})`); }
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
    const stand = hit?.closest?.('.stand');
    const chip = hit?.closest?.('.block-chip');
    if (stand) toggleStand(stand.dataset.id);
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
    if (free.length && free.length < 8) toast(`${blockId}: 8 tadan ${free.length} tasi bo'sh — shular tanlandi.`);
    renderSelection(); paintSelection();
  }
  function paintSelection() {
    $$('#world .stand').forEach((g) => g.classList.toggle('selected', selection.has(g.dataset.id)));
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
    const kind = stands.every((s) => s.blockId === blocks[0]) && stands.length === 8 ? 'To\'liq blok (72 m²)' : `${stands.length} stend`;
    $('#selTitle').textContent = `${blocks.join(', ')} · ${kind}`;
    $('#selChips').innerHTML = stands.map((s) => `<span class="chip ${statusOf(s.id)}" data-id="${s.id}" title="${STATUS_LABEL[statusOf(s.id)]}">${s.id.replace(/^.*?-(?=\d+$)/, '')}</span>`).join('');
    $$('#selChips .chip').forEach((c) => c.addEventListener('click', (e) => { e.stopPropagation(); toggleStand(c.dataset.id); }));

    $('#selInfo').innerHTML = `
      <dt>Bo'sh joy</dt><dd><b>${free.length}</b> stend · ${fmtNum(area)} m²</dd>
      ${taken.length ? `<dt>Band</dt><dd>${taken.length} stend (${taken.map((s) => STATUS_LABEL[statusOf(s.id)]).filter((v, i, a) => a.indexOf(v) === i).join(', ')})</dd>` : ''}
      <dt>Narx</dt><dd>${pricePerM2() ? fmtMoney(amount) : '—'}<br><span class="muted">${pricePerM2() ? fmtMln(amount) + ' · ' + fmtMoney(pricePerM2()) + '/m²' : 'narx belgilanmagan'}</span></dd>`;

    const canAct = !CLIENT;
    $('#formFields').hidden = !canAct;
    $('#btnReserve').disabled = !canAct || free.length === 0;
    $('#btnSell').disabled = !canAct || free.length === 0;
    const releasable = stands.filter((s) => statusOf(s.id) !== 'free' && (isAdmin() || items[s.id]?.sellerId === seller?.id || statusOf(s.id) === 'blocked'));
    $('#btnRelease').disabled = !canAct || releasable.length === 0;
    $('#btnRelease').textContent = `Bo'shatish${releasable.length && releasable.length < stands.length ? ` (${releasable.length})` : ''}`;
    $('#btnReserve').textContent = free.length ? `Bron qilish (${fmtNum(free.length * 9)} m²)` : 'Bron qilish';
    $('#btnSell').textContent = free.length ? `Sotish (${fmtNum(free.length * 9)} m²)` : 'Sotish';
    if (!$('#ttl').value) $('#ttl').value = ttlDefault();

    // tanlangan joylarning tafsiloti
    const rows = stands.map((s) => {
      const it = items[s.id];
      return `<div style="margin:5px 0">
        <b>${s.id}</b> — ${STATUS_LABEL[statusOf(s.id)]}${it ? `<br><span class="muted">${it.buyer || ''}${it.phone ? ' · ' + it.phone : ''} · ${it.sellerName || ''} · ${fmtDate(it.updatedAt)}${it.reservedUntil ? ' · bron ' + fmtDate(it.reservedUntil) + ' gacha' : ''}</span>` : ''}
      </div>`;
    }).join('');
    $('#details').innerHTML = (isAdmin() || !CLIENT ? rows : '');
  }

  function renderStats() {
    const by = { free: 0, reserved: 0, sold: 0, blocked: 0 };
    const area = { free: 0, reserved: 0, sold: 0, blocked: 0 };
    let revenue = 0;
    for (const s of layout.stands) {
      const st = statusOf(s.id);
      by[st] = (by[st] || 0) + 1;
      area[st] = (area[st] || 0) + s.areaM2;
      if (st === 'sold') revenue += items[s.id]?.amount || 0;
    }
    const totalArea = layout.stands.reduce((a, s) => a + s.areaM2, 0);
    $('#stats').innerHTML = `
      <div class="stat"><b>${by.free}</b><span>bo'sh stend · ${fmtNum(area.free)} m²</span></div>
      <div class="stat"><b>${by.reserved}</b><span>bron · ${fmtNum(area.reserved)} m²</span></div>
      <div class="stat"><b>${by.sold}</b><span>sotilgan · ${fmtNum(area.sold)} m²</span></div>
      <div class="stat"><b>${fmtNum(totalArea)}</b><span>jami m² (${by.sold + by.reserved} band)</span></div>
      <div class="stat" style="grid-column:1/-1"><b>${fmtNum(revenue)}</b><span>so'm sotuv · ${fmtMln(revenue)}</span></div>`;
  }

  function renderLegend() {
    const counts = { free: 0, reserved: 0, sold: 0, blocked: 0 };
    for (const s of layout.stands) counts[statusOf(s.id)] = (counts[statusOf(s.id)] || 0) + 1;
    $('#legend').innerHTML = Object.keys(STATUS_LABEL).filter((k) => counts[k] || k !== 'blocked').map((k) => `
      <div class="row">
        <span class="sw" style="background:${k === 'free' ? '#eaf6ec' : k === 'reserved' ? '#fff8e1' : k === 'sold' ? '#fdecea' : '#eceff1'};border-color:${STATUS_COLOR[k]}"></span>
        <label><input type="checkbox" data-st="${k}" ${hiddenStatuses.has(k) ? '' : 'checked'}/> ${STATUS_LABEL[k]} (${counts[k] || 0})</label>
      </div>`).join('') + `<div class="row muted" style="font-size:11.5px">1 stend = 3×3 m = 9 m² · 1 blok = 8 stend = 72 m²`
      + (layout.customStands?.length ? `<br>${layout.customStands.length} ta nostandart stend (maydoni o'zida yozilgan)` : '') + `</div>`;
    $$('#legend input[data-st]').forEach((cb) => cb.addEventListener('change', () => {
      cb.checked ? hiddenStatuses.delete(cb.dataset.st) : hiddenStatuses.add(cb.dataset.st);
      applyFilters();
    }));
  }
  function applyFilters() {
    $$('#world .stand').forEach((g) => { g.style.display = hiddenStatuses.has(g.dataset.status) ? 'none' : ''; });
  }

  // ------------------------------------------------------------ search
  let searchTerm = '';
  $('#search').addEventListener('input', (e) => { searchTerm = e.target.value.trim().toUpperCase(); applySearch(); });
  function applySearch() {
    if (!layout) return;
    const q = searchTerm;
    $$('#world .stand').forEach((g) => g.classList.toggle('dim', !!q && !g.dataset.id.includes(q) && !g.dataset.block.includes(q)));
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
      revision = r.revision;
      await refreshState();
      renderStats(); renderLegend();
      const ids = standIds;
      if (action === 'sell') showReceipt(ids, extra, r.items);
      toast(`${action === 'sell' ? 'Sotildi' : action === 'reserve' ? 'Bron qilindi' : action === 'release' ? "Bo'shatildi" : 'Bloklandi'}: ${ids.join(', ')}`, 'ok');
      selection = new Set();
      renderSelection(); paintSelection();
      if (isAdmin()) loadAudit();
    } catch (err) {
      if (err.code === 409 && err.data?.conflicts) {
        const c = err.data.conflicts.map((x) => `${x.standId} (${STATUS_LABEL[x.status] || x.status}${x.sellerName ? ', ' + x.sellerName : ''})`);
        fail(`Band qilingan: ${c.join(', ')}. Sahifa yangilandi — qaytadan tanlang.`);
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
    if (!buyer) return fail('Mijoz ismini kiriting');
    const ttl = Number($('#ttl').value || ttlDefault());
    const ok = await confirmDialog('Bron qilishni tasdiqlang', `
      <p>${free.length} stend (${fmtNum(area)} m²) ${ttl} soatga bron qilinadi:</p>
      <p><b>${free.map((s) => s.id).join(', ')}</b></p>
      <table>
        <tr><td>Blok(lar)</td><td>${blocks.join(', ')}</td></tr>
        <tr><td>Mijoz</td><td>${buyer}</td></tr>
        <tr><td>Summa (kelishuv narxi)</td><td>${fmtMoney(amount)}</td></tr>
      </table>
      <p class="muted">Bron ${fmtDate(new Date(Date.now() + ttl * 3600e3).toISOString())} gacha amal qiladi, keyin avtomatik bo'shaydi.</p>`);
    if (!ok) return;
    await doAction('reserve', free.map((s) => s.id), { buyer, phone: $('#phone').value, company: $('#company').value, note: $('#note').value, ttlHours: ttl }).catch(() => {});
  });

  $('#btnSell').addEventListener('click', async () => {
    const { free, area, amount, blocks, taken } = selectionInfo();
    if (!free.length) return;
    const buyer = $('#buyer').value.trim();
    if (!buyer) return fail('Mijoz ismini kiriting');
    const ok = await confirmDialog('SOTISHNI tasdiqlang', `
      <p style="margin-top:0">Quyidagi joylar <b>sotilgan</b> deb belgilanadi. Mijozga aynan shu ID'lar aytiladi:</p>
      <p style="font-size:15px"><b>${free.map((s) => s.id).join(', ')}</b></p>
      <table>
        <tr><td>Blok(lar)</td><td>${blocks.join(', ')}</td></tr>
        <tr><td>Maydon</td><td>${free.length} × 9 = ${fmtNum(area)} m²</td></tr>
        <tr><td>Mijoz</td><td>${buyer} ${$('#phone').value ? '· ' + $('#phone').value : ''}</td></tr>
        <tr><td><b>Summa</b></td><td><b>${fmtMoney(amount)}</b></td></tr>
      </table>
      ${taken.length ? `<p class="muted">Eslatma: tanlangan ${taken.length} stend band, faqat bo'sh joylar sotiladi.</p>` : ''}
      <p class="muted">Amal jurnalga yoziladi: kim, qachon, qaysi joyni sotdi.</p>`);
    if (!ok) return;
    await doAction('sell', free.map((s) => s.id), { buyer, phone: $('#phone').value, company: $('#company').value, note: $('#note').value }).catch(() => {});
  });

  $('#btnRelease').addEventListener('click', async () => {
    const { stands } = selectionInfo();
    const releasable = stands.filter((s) => statusOf(s.id) !== 'free');
    if (!releasable.length) return;
    const ok = await confirmDialog('Bo\'shatishni tasdiqlang', `
      <p>Bu joylardagi bron/sotuv yozuvi o'chiriladi va ular yana <b>bo'sh</b> bo'ladi:</p>
      <p><b>${releasable.map((s) => s.id).join(', ')}</b></p>
      <p class="muted">Sotilgan joyni faqat menejer bo'shata oladi. Amal jurnalga yoziladi.</p>`);
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
      <h2>Sotuv kvitansiyasi ✓</h2>
      <div>Sotilgan joy(lar): <b>${standIds.join(', ')}</b></div>
      <div>Guruh(lar): ${blockIds.join(', ')} · Maydon: ${standIds.length} stend = <b>${fmtNum(area)} m²</b></div>
      <div>Mijoz: <b>${extra.buyer || ''}</b> ${extra.phone || ''} ${extra.company ? '· ' + extra.company : ''}</div>
      <div>Summa: <b>${fmtMoney(amount)}</b> (${fmtMln(amount)})</div>
      <div class="muted">Sotuvchi: ${seller?.name || ''} · ${fmtDate(new Date().toISOString())} · ${layout.meta.project}, ${layout.meta.hall} · layout v${layout.meta.version}</div>
      <div class="actions"><button class="btn" id="printReceipt">Kvitansiyani chop etish</button></div>`;
    $('#printReceipt').onclick = () => { document.body.classList.add('print-receipt'); window.print(); };
    window.onafterprint = () => document.body.classList.remove('print-receipt');
  }

  function showClientInfo(id) {
    const s = layout.stands.find((x) => x.id === id);
    const st = statusOf(id);
    toast(`${s.id} · ${STATUS_LABEL[st]} · 9 m²`);
  }

  // ------------------------------------------------------------ mijoz rejimi / print / share
  $('#clientMode').addEventListener('click', async () => {
    if ((layout?.meta?.status || 'draft') !== 'approved') {
      return fail('Bu xarita hali QORALAMA — mijozga havola yuborishdan oldin raqamlarni tasdiqlash kerak (meta.status = "approved").');
    }
    const url = new URL(location.href);
    url.searchParams.set('mode', 'client');
    try { await navigator.clipboard.writeText(url.toString()); toast('Mijoz uchun havola nusxalandi: ' + url.toString()); }
    catch { window.open(url.toString(), '_blank'); }
  });

  function buildPrintSheet() {
    let sheet = $('#printSheet');
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.id = 'printSheet';
      sheet.className = 'print-only';
      $('.map-wrap').appendChild(sheet);
    }
    const freeIds = layout.stands.filter((s) => statusOf(s.id) === 'free').map((s) => s.id);
    const rows = layout.blocks.filter((b) => b.kind !== 'custom').map((b) => {
      const cnt = { free: 0, reserved: 0, sold: 0, blocked: 0 };
      b.stands.forEach((s) => cnt[statusOf(s.id)]++);
      return `<tr><td>${b.id}</td><td>${b.stands.length} × 9 = ${fmtNum(b.areaM2)} m²</td><td>${cnt.free}</td><td>${cnt.reserved}</td><td>${cnt.sold}</td><td>${cnt.free ? b.stands.filter((s) => statusOf(s.id) === 'free').map((s) => s.id).join(', ') : '—'}</td></tr>`;
    }).join('');
    sheet.innerHTML = `
      <h2>${layout.meta.project} — ${layout.meta.hall} · joylashuv xaritasi (v${layout.meta.version})</h2>
      <p>1 stend = 3×3 m = 9 m² · 1 blok = 8 stend = 72 m² · Narx: ${layout.meta.pricePerM2 ? fmtMoney(layout.meta.pricePerM2) + '/m²' : '—'} · Sana: ${fmtDate(new Date().toISOString())}</p>
      <p><b>Bo'sh joylar (${freeIds.length} ta stend = ${fmtNum(freeIds.length * 9)} m²):</b> ${freeIds.join(', ') || '—'}</p>
      <table>
        <thead><tr><th>Blok</th><th>Maydon</th><th>Bo'sh</th><th>Bron</th><th>Sotilgan</th><th>Bo'sh stend ID'lari</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:6mm">Mijoz uchun izoh: sotib olingan joylar xaritada ID bo'yicha ko'rsatilgan. Shartnomada ko'rsatilgan stend ID'si bilan xaritadagi joy bir xil.</p>`;
  }
  $('#printBtn').addEventListener('click', () => { buildPrintSheet(); window.print(); });

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
        await loadAll(); // login ekrani orqasida xarita tayyor tursin
      }
      setInterval(() => refreshState().catch(() => {}), 8000);
      setInterval(() => { if (isAdmin()) loadAudit(); }, 30000);
    } catch (e) {
      fail(e.message);
    }
  })();
})();
