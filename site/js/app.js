// SBMM OU1 XRF Field Data Viewer
// All views, routing, table rendering, CSV export.

const STATE = {
  data: null,
  selectedElements: new Set(),
  allElementsExpanded: false,
  bouldersById: new Map(),
  surfaceByBoulder: new Map(),
  depthByBoulder: new Map(),
  powderByBoulder: new Map(),
  labByBoulder: new Map(),
  csvCache: new Map(),         // filename -> parsed rows
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === false || v == null) continue;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
};

// ---------- Number formatting ----------
function fmtNum(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'string') return v;
  const n = Number(v);
  if (!isFinite(n)) return '';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 10000) return n.toFixed(0);
  if (abs >= 100) return n.toFixed(1);
  if (abs >= 1) return n.toFixed(2);
  if (abs >= 0.01) return n.toFixed(3);
  return n.toExponential(2);
}

function fmtDate(s) {
  if (!s) return '';
  if (typeof s !== 'string') return String(s);
  if (s.length >= 10 && s[4] === '-') return s.slice(0, 10);
  return s;
}

// ---------- Boot ----------
async function boot() {
  try {
    const res = await fetch('data/data.json');
    if (!res.ok) throw new Error('failed to load data.json');
    STATE.data = await res.json();
    indexData();
    STATE.data.meta.defaultElements.forEach(e => STATE.selectedElements.add(e));
    renderElementBar();
    setupSearch();
    window.addEventListener('hashchange', route);
    route();
    $('#metaInfo').textContent =
      `${STATE.data.meta.counts.boulders} boulders · ${STATE.data.meta.counts.surfaceReadings + STATE.data.meta.counts.depthReadings + STATE.data.meta.counts.powderReadings} readings · built ${fmtDate(STATE.data.meta.builtAt)}`;
    $('#loading').classList.add('hidden');
  } catch (err) {
    $('#loading').innerHTML = `<div style="color:#f85149">Error loading data: ${err.message}</div>`;
    console.error(err);
  }
}

function indexData() {
  const d = STATE.data;
  d.boulders.forEach(b => STATE.bouldersById.set(b['Sample ID'], b));
  for (const r of d.surfaceReadings) {
    const sid = r['Sample ID'];
    if (!STATE.surfaceByBoulder.has(sid)) STATE.surfaceByBoulder.set(sid, []);
    STATE.surfaceByBoulder.get(sid).push(r);
  }
  for (const r of d.depthReadings) {
    const sid = r['Sample ID'];
    if (!STATE.depthByBoulder.has(sid)) STATE.depthByBoulder.set(sid, []);
    STATE.depthByBoulder.get(sid).push(r);
  }
  for (const r of d.powderReadings) {
    const parent = r['Parent Boulder'] || r['Sample ID'];
    if (!STATE.powderByBoulder.has(parent)) STATE.powderByBoulder.set(parent, []);
    STATE.powderByBoulder.get(parent).push(r);
  }
  for (const l of d.labSamples) {
    const parent = l['Parent Boulder ID (auto)'] || l['Parent Boulder'];
    if (parent) {
      if (!STATE.labByBoulder.has(parent)) STATE.labByBoulder.set(parent, []);
      STATE.labByBoulder.get(parent).push(l);
    }
  }
}

// ---------- Element bar ----------
function renderElementBar() {
  const bar = $('#elementBar');
  bar.innerHTML = '';
  bar.appendChild(el('span', { class: 'label' }, 'Elements:'));
  const defaults = STATE.data.meta.defaultElements;
  const all = STATE.data.meta.elements;
  const visible = STATE.allElementsExpanded ? all : defaults;
  for (const sym of visible) {
    const chip = el('span', {
      class: 'elem-chip' + (STATE.selectedElements.has(sym) ? ' active' : ''),
      onclick: () => toggleElement(sym),
    }, sym);
    bar.appendChild(chip);
  }

  bar.appendChild(el('span', { class: 'elem-divider' }));

  bar.appendChild(el('span', {
    class: 'elem-chip elem-action',
    title: 'Select every element in the data',
    onclick: () => setElements(all),
  }, 'All'));
  bar.appendChild(el('span', {
    class: 'elem-chip elem-action',
    title: 'Deselect every element',
    onclick: () => setElements([]),
  }, 'None'));
  bar.appendChild(el('span', {
    class: 'elem-chip elem-action',
    title: 'Reset to the extended-metals default (As, Pb, Hg, Sb, Cu, Zn, Fe, Mn)',
    onclick: () => setElements(defaults),
  }, 'Defaults'));

  bar.appendChild(el('span', {
    class: 'elem-chip toggle-all',
    onclick: () => {
      STATE.allElementsExpanded = !STATE.allElementsExpanded;
      renderElementBar();
    },
  }, STATE.allElementsExpanded ? '− show defaults' : '+ all elements'));
}

function setElements(syms) {
  STATE.selectedElements = new Set(syms);
  renderElementBar();
  route();
}

function toggleElement(sym) {
  if (STATE.selectedElements.has(sym)) STATE.selectedElements.delete(sym);
  else STATE.selectedElements.add(sym);
  renderElementBar();
  route(); // re-render current view
}

// ---------- Router ----------
function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const v = $('#view');
  v.innerHTML = '';
  // Mark active nav
  $$('.topnav a').forEach(a => a.classList.remove('active'));
  let m;
  if (hash === '/' || hash === '') {
    $('.topnav a[data-route="home"]')?.classList.add('active');
    renderHome(v);
  } else if ((m = hash.match(/^\/area\/([A-Za-z]+)$/))) {
    renderArea(v, m[1]);
  } else if ((m = hash.match(/^\/grid\/([A-Za-z]+)\/(\d+)$/))) {
    renderGrid(v, m[1], +m[2]);
  } else if ((m = hash.match(/^\/boulder\/(.+)$/))) {
    renderBoulder(v, decodeURIComponent(m[1]));
  } else if (hash === '/verification') {
    $('.topnav a[data-route="verification"]')?.classList.add('active');
    renderVerification(v);
  } else if (hash === '/field-log') {
    $('.topnav a[data-route="field-log"]')?.classList.add('active');
    renderFieldLog(v);
  } else if (hash === '/reconcile') {
    $('.topnav a[data-route="reconcile"]')?.classList.add('active');
    renderReconcile(v);
  } else if (hash === '/export') {
    $('.topnav a[data-route="export"]')?.classList.add('active');
    renderExport(v);
  } else {
    v.appendChild(el('div', { class: 'empty' }, 'Page not found. ', el('a', { href: '#/' }, 'Go home')));
  }
}

// ---------- Home ----------
function renderHome(v) {
  const m = STATE.data.meta;
  const c = m.counts;
  v.appendChild(el('h1', {}, 'SBMM OU1 — XRF Field Campaign'));
  v.appendChild(el('div', { class: 'subtitle' },
    `Tasks 2.1.6 & 2.1.7 · Surface XRF + Boulder Crushing + Depth + Powder · Guns: ${m.guns.join(', ')}`));

  const statRow = el('div', { class: 'stat-row' });
  for (const [label, val] of [
    ['Boulders', c.boulders],
    ['Surface rdgs', c.surfaceReadings],
    ['Depth rdgs', c.depthReadings],
    ['Powder rdgs', c.powderReadings],
    ['Lab samples', c.labSamples],
    ['CSV readings', c.csvReadingsTotal],
    ['Orphan rdgs', c.orphans],
  ]) {
    statRow.appendChild(el('div', { class: 'stat' },
      el('div', { class: 'v' }, String(val)),
      el('div', { class: 'l' }, label),
    ));
  }
  v.appendChild(statRow);

  v.appendChild(el('h2', {}, 'Areas'));
  const grid = el('div', { class: 'area-grid' });
  for (const area of STATE.data.areas) {
    const code = area.code;
    const bouldersInArea = STATE.data.boulders.filter(b => b['Area Code'] === code);
    const statuses = Object.values(area.gridsStatus || {});
    const fullCount = statuses.filter(s => s === '✓').length;
    const halfCount = statuses.filter(s => s === '½').length;
    const total = 15;
    const pct = ((fullCount + halfCount * 0.5) / total) * 100;
    const doneStr = area.done || `${fullCount}/${total}`;
    const partial = halfCount ? ` · ${halfCount} partial` : '';
    const card = el('a', { class: 'area-card', href: `#/area/${code}` },
      el('div', { class: 'code' }, code),
      el('div', { class: 'done' }, `${doneStr} grids complete${partial}`),
      el('div', { class: 'bar' }, el('div', { class: 'fill', style: `width:${pct}%` })),
      el('div', { class: 'meta' },
        el('span', {}, `${bouldersInArea.length} boulders`),
        el('span', {}, `${countReadingsForArea(code)} rdgs`),
      ),
    );
    grid.appendChild(card);
  }
  v.appendChild(grid);
}

function countReadingsForArea(area) {
  let n = 0;
  for (const r of STATE.data.surfaceReadings) {
    const sid = r['Sample ID'];
    const b = STATE.bouldersById.get(sid);
    if (b && b['Area Code'] === area) n++;
  }
  return n;
}

// ---------- Area view ----------
function renderArea(v, code) {
  const area = STATE.data.areas.find(a => a.code === code);
  if (!area) {
    v.appendChild(el('div', { class: 'empty' }, `Area ${code} not found.`));
    return;
  }
  v.appendChild(crumbs([['Areas', '#/'], [code, null]]));
  v.appendChild(el('h1', {}, code, el('span', { class: 'pill' }, area.done || '')));
  v.appendChild(el('div', { class: 'subtitle' }, area.notes || ''));

  // Grid map: 15 grids
  const bouldersInArea = STATE.data.boulders.filter(b => b['Area Code'] === code);
  const byGrid = new Map();
  for (const b of bouldersInArea) {
    const g = b['Grid #'];
    if (!byGrid.has(g)) byGrid.set(g, []);
    byGrid.get(g).push(b);
  }

  v.appendChild(el('h2', {}, 'Grid completion'));
  const tbl = el('table', { class: 'grid-table' });
  const head = el('tr', {},
    el('th', {}, 'Grid'),
    el('th', {}, 'H (Hard)'),
    el('th', {}, 'F (Friable)'),
    el('th', {}, '# Rdgs'),
    el('th', {}, 'Status'),
  );
  tbl.appendChild(el('thead', {}, head));
  const tbody = el('tbody');
  for (let g = 1; g <= 15; g++) {
    const boulders = byGrid.get(g) || [];
    const status = area.gridsStatus?.[g];
    const cls = status === '✓' ? 'status-full' : status === '½' ? 'status-half' : 'status-empty';
    const findBy = (type) => boulders.find(b => b['Type (H/F)'] === type);
    const bH = findBy('H'); const bF = findBy('F');
    let rdgCount = 0;
    for (const b of boulders) {
      rdgCount += (STATE.surfaceByBoulder.get(b['Sample ID']) || []).length;
    }
    tbody.appendChild(el('tr', {},
      el('td', {},
        boulders.length ? el('a', { href: `#/grid/${code}/${g}` }, `G${String(g).padStart(2, '0')}`) : `G${String(g).padStart(2, '0')}`,
      ),
      el('td', {},
        bH ? el('a', { href: `#/boulder/${encodeURIComponent(bH['Sample ID'])}` }, bH['Sample ID']) : '—',
      ),
      el('td', {},
        bF ? el('a', { href: `#/boulder/${encodeURIComponent(bF['Sample ID'])}` }, bF['Sample ID']) : '—',
      ),
      el('td', { class: 'num' }, rdgCount ? String(rdgCount) : ''),
      el('td', { class: cls }, status || '—'),
    ));
  }
  tbl.appendChild(tbody);
  v.appendChild(el('div', { class: 'dt-wrap' }, tbl));
}

// ---------- Grid view ----------
function renderGrid(v, code, grid) {
  const boulders = STATE.data.boulders.filter(b => b['Area Code'] === code && b['Grid #'] === grid);
  v.appendChild(crumbs([['Areas', '#/'], [code, `#/area/${code}`], [`G${String(grid).padStart(2, '0')}`, null]]));
  v.appendChild(el('h1', {}, `${code} — G${String(grid).padStart(2, '0')}`));
  if (!boulders.length) {
    v.appendChild(el('div', { class: 'empty' }, 'No boulders logged for this grid.'));
    return;
  }
  const grid_ = el('div', { class: 'boulder-grid' });
  for (const b of boulders) {
    const sid = b['Sample ID'];
    const rdgs = STATE.surfaceByBoulder.get(sid) || [];
    const card = el('a', { class: 'boulder-card', href: `#/boulder/${encodeURIComponent(sid)}` },
      el('div', {},
        el('span', { class: 'id' }, sid),
        el('span', { class: 'type' }, b['Type (H/F)'] === 'H' ? 'Hard' : 'Friable'),
      ),
      el('div', { class: 'stats' },
        el('span', {}, '# rdgs: ', el('b', {}, String(rdgs.length))),
        el('span', {}, 'Hg avg: ', el('b', {}, fmtNum(b['Avg Hg (ppm)']))),
        el('span', {}, 'As avg: ', el('b', {}, fmtNum(b['Avg As (ppm)']))),
        el('span', {}, 'Sb avg: ', el('b', {}, fmtNum(b['Avg Sb (ppm)']))),
      ),
    );
    grid_.appendChild(card);
  }
  v.appendChild(grid_);
}

// ---------- Boulder detail ----------
function renderBoulder(v, sid) {
  const b = STATE.bouldersById.get(sid);
  if (!b) {
    v.appendChild(el('div', { class: 'empty' }, `Boulder ${sid} not found.`));
    return;
  }
  const code = b['Area Code'];
  const grid = b['Grid #'];
  v.appendChild(crumbs([
    ['Areas', '#/'],
    [code, `#/area/${code}`],
    [`G${String(grid).padStart(2, '0')}`, `#/grid/${code}/${grid}`],
    [sid, null],
  ]));

  // Header card
  const header = el('div', { class: 'boulder-header' },
    el('h1', {}, sid, el('span', { class: 'pill' }, b['Type (H/F)'] === 'H' ? 'Hard' : 'Friable')),
    el('div', { class: 'bh-meta' },
      metaItem('Date', fmtDate(b['Date'])),
      metaItem('Area', code),
      metaItem('Grid', `G${String(grid).padStart(2, '0')} · B${b['Boulder #']?.replace?.('B', '') || b['Boulder #']}`),
      metaItem('Northing', fmtNum(b['Northing'])),
      metaItem('Easting', fmtNum(b['Easting'])),
      metaItem('Elevation', b['Elev (ft)'] ? fmtNum(b['Elev (ft)']) + ' ft' : ''),
      metaItem('Rind', b['Rind? (Y/N)'] || '—'),
      metaItem('Rind thick (in)', fmtNum(b['Rind Thick (in)'])),
      metaItem('Surface rdgs', `${b['Surface Rdg # Start'] || '?'}–${b['Surface Rdg # End'] || '?'}`),
      metaItem('Powder rdgs', b['Powder (Y/N)'] === 'Y' ? `${b['Powder Rdg # Start'] || '?'}–${b['Powder Rdg # End'] || '?'}` : '—'),
      metaItem('Avg Hg (ppm)', fmtNum(b['Avg Hg (ppm)'])),
      metaItem('Avg As (ppm)', fmtNum(b['Avg As (ppm)'])),
      metaItem('Avg Sb (ppm)', fmtNum(b['Avg Sb (ppm)'])),
      metaItem('NCD file', b['NCD Filename']),
    ),
    b['Notes'] ? el('div', { style: 'margin-top:10px; color:var(--text-dim); font-size:13px;' }, 'Notes: ', el('span', { style: 'color:var(--text)' }, b['Notes'])) : null,
  );
  v.appendChild(header);

  // Tabs
  const tabState = { current: 'surface' };
  const surface = STATE.surfaceByBoulder.get(sid) || [];
  const depth = STATE.depthByBoulder.get(sid) || [];
  const powder = STATE.powderByBoulder.get(sid) || [];
  const lab = STATE.labByBoulder.get(sid) || [];

  const tabs = el('div', { class: 'tabs' });
  const tabBody = el('div');
  const makeTab = (key, label, count) => {
    const t = el('div', { class: 'tab', onclick: () => switchTab(key) },
      label, count > 0 ? el('span', { class: 'pill' }, String(count)) : null);
    tabs.appendChild(t);
    return t;
  };
  const surfTab = makeTab('surface', 'Surface', surface.length);
  const depthTab = makeTab('depth', 'Depth', depth.length);
  const powderTab = makeTab('powder', 'Powder & Lab', powder.length + lab.length);
  const qcTab = makeTab('qc', 'QC', 0);
  const tabMap = { surface: surfTab, depth: depthTab, powder: powderTab, qc: qcTab };

  function switchTab(key) {
    tabState.current = key;
    for (const t of Object.values(tabMap)) t.classList.remove('active');
    tabMap[key].classList.add('active');
    tabBody.innerHTML = '';
    if (key === 'surface') tabBody.appendChild(renderReadingTable(surface, { type: 'surface', boulderId: sid }));
    else if (key === 'depth') tabBody.appendChild(renderDepthView(depth, sid));
    else if (key === 'powder') tabBody.appendChild(renderPowderLab(powder, lab));
    else if (key === 'qc') tabBody.appendChild(renderQC(b, surface, depth, powder));
  }
  v.appendChild(tabs);
  v.appendChild(tabBody);
  switchTab('surface');
}

function metaItem(label, value) {
  return el('div', { class: 'item' },
    el('div', { class: 'l' }, label),
    el('div', { class: 'v' }, value == null || value === '' ? '—' : String(value)),
  );
}

// ---------- Reading table ----------
function renderReadingTable(readings, { type, boulderId }) {
  const wrap = el('div');
  if (!readings.length) {
    wrap.appendChild(el('div', { class: 'empty' }, 'No readings.'));
    return wrap;
  }
  const elems = Array.from(STATE.selectedElements);
  const baseCols = type === 'depth'
    ? [['Rdg #', r => r['XRF Rdg #'], 'num'], ['Depth (in)', r => r['Depth (in)'], 'num'], ['Replicate', r => r['Replicate #'], 'num'], ['Gun', r => r['XRF S/N'] || r._csv?.gun]]
    : type === 'powder'
    ? [['Rdg #', r => r['XRF Rdg #'], 'num'], ['Shot', r => r['Shot #'], 'num'], ['Mode', r => r['Mode'] || r._csv?.mode], ['Gun', r => r['XRF S/N'] || r._csv?.gun]]
    : [['Rdg #', r => r['XRF Rdg #'], 'num'], ['Spot', r => r['Spot #'], 'num'], ['Type', r => r['Reading Type']], ['Gun', r => r['XRF S/N'] || r._csv?.gun]];

  // Toolbar
  const toolbar = el('div', { class: 'toolbar' },
    el('span', { style: 'color:var(--text-dim); font-size:12px;' }, `${readings.length} readings`),
    el('button', { class: 'secondary',
      onclick: () => exportReadingsCSV(readings, type, boulderId) }, 'Export selected CSV'),
  );
  wrap.appendChild(toolbar);

  // Build table
  const tbl = el('table', { class: 'dt' });
  const thead = el('thead');
  const headRow = el('tr');
  for (const [label] of baseCols) headRow.appendChild(el('th', { class: 'sortable' }, label));
  for (const sym of elems) headRow.appendChild(el('th', { class: 'sortable num' }, `${sym} (ppm)`));
  thead.appendChild(headRow);
  tbl.appendChild(thead);

  const tbody = el('tbody');
  for (const r of readings) {
    const tr = el('tr');
    for (const [, getter, cls] of baseCols) {
      const v = getter(r);
      tr.appendChild(el('td', { class: cls || '' }, v == null ? '' : String(v)));
    }
    const csv = r._csv;
    for (const sym of elems) {
      let val = '', cls = 'num';
      if (csv) {
        if (csv.elements && csv.elements[sym] != null) {
          val = fmtNum(csv.elements[sym]);
        } else if (csv.lod && csv.lod[sym]) {
          val = '<LOD'; cls = 'num lod';
        }
      } else {
        // Fallback to tracker fields
        if (r[`${sym} (ppm)`] != null) {
          const tv = r[`${sym} (ppm)`];
          if (tv === '<LOD') { val = '<LOD'; cls = 'num lod'; }
          else val = fmtNum(tv);
        }
      }
      tr.appendChild(el('td', { class: cls }, val));
    }
    tbody.appendChild(tr);
  }
  tbl.appendChild(tbody);
  wrap.appendChild(el('div', { class: 'dt-wrap' }, tbl));

  // Make sortable
  $$('th.sortable', tbl).forEach((th, idx) => {
    th.addEventListener('click', () => sortTable(tbl, idx, th));
    th.appendChild(el('span', { class: 'arrow' }, '▾'));
  });

  return wrap;
}

function sortTable(tbl, colIdx, th) {
  const ths = $$('thead th', tbl);
  const dir = th.classList.contains('sort-asc') ? 'desc' : 'asc';
  ths.forEach(x => x.classList.remove('sort-asc', 'sort-desc'));
  th.classList.add(dir === 'asc' ? 'sort-asc' : 'sort-desc');
  const tbody = $('tbody', tbl);
  const rows = Array.from(tbody.rows);
  rows.sort((a, b) => {
    const av = a.cells[colIdx].textContent.trim();
    const bv = b.cells[colIdx].textContent.trim();
    const an = parseFloat(av), bn = parseFloat(bv);
    if (!isNaN(an) && !isNaN(bn)) return dir === 'asc' ? an - bn : bn - an;
    return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  });
  rows.forEach(r => tbody.appendChild(r));
}

// ---------- Depth view: table + chart ----------
function renderDepthView(readings, sid) {
  const wrap = el('div');
  if (!readings.length) {
    wrap.appendChild(el('div', { class: 'empty' }, 'No depth readings for this boulder.'));
    return wrap;
  }

  // Compute depth-vs-element profile for first selected element
  const elems = Array.from(STATE.selectedElements);
  const elemSel = el('select', {
    onchange: (ev) => drawProfile(ev.target.value),
  }, ...elems.map(e => el('option', { value: e }, `${e} (ppm)`)));
  const toolbar = el('div', { class: 'toolbar' },
    el('span', { style: 'color:var(--text-dim); font-size:12px;' }, 'Plot element:'),
    elemSel,
    el('span', { style: 'color:var(--text-dim); font-size:12px; margin-left:auto;' }, `${readings.length} readings`),
  );
  wrap.appendChild(toolbar);

  const chartBox = el('div', { class: 'chart-wrap' },
    el('canvas', { id: 'depthChart', style: 'width:100%;max-height:340px;' }),
  );
  wrap.appendChild(chartBox);
  wrap.appendChild(renderReadingTable(readings, { type: 'depth', boulderId: sid }));

  function drawProfile(sym) {
    const canvas = $('#depthChart', wrap);
    const ctx = canvas.getContext('2d');
    const W = canvas.width = canvas.offsetWidth * (window.devicePixelRatio || 1);
    const H = canvas.height = 340 * (window.devicePixelRatio || 1);
    const pad = { l: 60, r: 20, t: 20, b: 40 };
    ctx.clearRect(0, 0, W, H);
    // Aggregate: depth -> values
    const points = [];
    for (const r of readings) {
      const d = parseFloat(r['Depth (in)']);
      const csv = r._csv;
      let v = null;
      if (csv?.elements?.[sym] != null) v = csv.elements[sym];
      if (v != null && isFinite(d)) points.push({ d, v });
    }
    if (!points.length) {
      ctx.fillStyle = '#8b96a3';
      ctx.font = '13px sans-serif';
      ctx.fillText('No detected values for this element.', 20, 30);
      return;
    }
    const maxV = Math.max(...points.map(p => p.v));
    const minV = 0;
    const maxD = Math.max(4, ...points.map(p => p.d));
    const minD = 0;
    const x = v => pad.l + (v - minV) / (maxV - minV || 1) * (W - pad.l - pad.r);
    const y = d => pad.t + (d - minD) / (maxD - minD) * (H - pad.t - pad.b);
    // axes
    ctx.strokeStyle = '#3a4555'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, H - pad.b); ctx.lineTo(W - pad.r, H - pad.b); ctx.stroke();
    // y ticks (depth)
    ctx.fillStyle = '#8b96a3'; ctx.font = `${12 * (window.devicePixelRatio || 1)}px sans-serif`;
    for (let d = 0; d <= maxD; d += 0.5) {
      const yp = y(d);
      ctx.fillText(d.toFixed(1) + '"', 6 * (window.devicePixelRatio || 1), yp + 4);
      ctx.strokeStyle = '#2a3441';
      ctx.beginPath(); ctx.moveTo(pad.l, yp); ctx.lineTo(W - pad.r, yp); ctx.stroke();
    }
    // x ticks
    const xticks = 5;
    for (let i = 0; i <= xticks; i++) {
      const vv = minV + (i / xticks) * (maxV - minV);
      const xp = x(vv);
      ctx.fillStyle = '#8b96a3';
      ctx.fillText(fmtNum(vv), xp - 12, H - pad.b + 16);
    }
    // Points
    ctx.fillStyle = '#4a9eff';
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(x(p.v), y(p.d), 4 * (window.devicePixelRatio || 1), 0, Math.PI * 2);
      ctx.fill();
    }
    // Connect mean per depth
    const byDepth = new Map();
    for (const p of points) {
      if (!byDepth.has(p.d)) byDepth.set(p.d, []);
      byDepth.get(p.d).push(p.v);
    }
    const means = Array.from(byDepth.entries()).map(([d, vs]) => ({ d, v: vs.reduce((a,b)=>a+b,0)/vs.length })).sort((a,b)=>a.d-b.d);
    ctx.strokeStyle = '#4a9eff'; ctx.lineWidth = 2 * (window.devicePixelRatio || 1);
    ctx.beginPath();
    means.forEach((m, i) => { (i ? ctx.lineTo : ctx.moveTo).call(ctx, x(m.v), y(m.d)); });
    ctx.stroke();
    // Axis labels
    ctx.fillStyle = '#e6edf3';
    ctx.fillText(`${sym} (ppm)`, W / 2 - 30, H - 8);
    ctx.save();
    ctx.translate(14 * (window.devicePixelRatio || 1), H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Depth (in)', -30, 0);
    ctx.restore();
  }
  setTimeout(() => drawProfile(elems[0]), 0);
  return wrap;
}

// ---------- Powder + Lab ----------
function renderPowderLab(powder, lab) {
  const wrap = el('div');
  wrap.appendChild(el('h3', {}, 'Powder XRF readings'));
  if (powder.length) {
    wrap.appendChild(renderReadingTable(powder, { type: 'powder' }));
  } else {
    wrap.appendChild(el('div', { class: 'empty' }, 'No powder XRF readings.'));
  }
  wrap.appendChild(el('h3', {}, 'Lab samples'));
  if (lab.length) {
    const tbl = el('table', { class: 'list-table' });
    tbl.appendChild(el('thead', {}, el('tr', {},
      el('th', {}, 'Powder Sample ID'),
      el('th', {}, 'Date Collected'),
      el('th', {}, 'Type'),
      el('th', {}, 'Lab'),
      el('th', {}, 'COC/Lab ID'),
      el('th', {}, 'Lab Hg'),
      el('th', {}, 'Lab As'),
      el('th', {}, 'Lab Pb'),
      el('th', {}, 'Notes'),
    )));
    const tbody = el('tbody');
    for (const l of lab) {
      tbody.appendChild(el('tr', {},
        el('td', {}, l['Powder Sample ID'] || ''),
        el('td', {}, fmtDate(l['Date Collected (auto)'])),
        el('td', {}, l['Sample Type'] || ''),
        el('td', {}, l['Lab Name'] || ''),
        el('td', {}, l['COC / Lab ID'] || ''),
        el('td', {}, fmtNum(l['Lab Hg (ppm)'])),
        el('td', {}, fmtNum(l['Lab As (ppm)'])),
        el('td', {}, fmtNum(l['Lab Pb (ppm)'])),
        el('td', {}, l['Notes'] || ''),
      ));
    }
    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
  } else {
    wrap.appendChild(el('div', { class: 'empty' }, 'No lab samples linked.'));
  }
  return wrap;
}

// ---------- QC ----------
function renderQC(boulder, surface, depth, powder) {
  const wrap = el('div');
  // For each reading, show: rdg, gun, mode, duration, sigma, notes
  const all = [
    ...surface.map(r => ({ ...r, _kind: 'Surface' })),
    ...depth.map(r => ({ ...r, _kind: 'Depth' })),
    ...powder.map(r => ({ ...r, _kind: 'Powder' })),
  ];
  if (!all.length) {
    wrap.appendChild(el('div', { class: 'empty' }, 'No readings linked.'));
    return wrap;
  }
  const tbl = el('table', { class: 'list-table' });
  tbl.appendChild(el('thead', {}, el('tr', {},
    el('th', {}, 'Kind'),
    el('th', {}, 'Rdg #'),
    el('th', {}, 'Gun'),
    el('th', {}, 'Mode'),
    el('th', {}, 'Time'),
    el('th', {}, 'Duration (s)'),
    el('th', {}, 'CSV match'),
    el('th', {}, 'Notes'),
  )));
  const tbody = el('tbody');
  for (const r of all) {
    const csv = r._csv;
    tbody.appendChild(el('tr', {},
      el('td', {}, r._kind),
      el('td', {}, String(r['XRF Rdg #'])),
      el('td', {}, r['XRF S/N'] || csv?.gun || ''),
      el('td', {}, csv?.mode || r['Mode'] || ''),
      el('td', {}, csv?.time || ''),
      el('td', {}, fmtNum(csv?.duration || r['Duration (sec)'])),
      el('td', { class: csv ? 'pass' : 'fail' }, csv ? '✓' : '✗ not found'),
      el('td', {}, r['Notes'] || r['Note'] || csv?.note || ''),
    ));
  }
  tbl.appendChild(tbody);
  wrap.appendChild(tbl);
  return wrap;
}

// ---------- Daily Verification ----------
function renderVerification(v) {
  v.appendChild(el('h1', {}, 'Daily Verification — IARM 35NN CRM'));
  v.appendChild(el('div', { class: 'subtitle' }, 'AM & PM system checks. ±20% RPD against certified values.'));
  const cert = STATE.data.verificationCert;
  v.appendChild(el('div', { style: 'font-size:13px;color:var(--text-dim);margin-bottom:10px;' },
    'Certified: ', cert.slice(4, 10).filter(Boolean).join(' · ')));
  const ver = STATE.data.verifications;
  const tbl = el('table', { class: 'list-table' });
  tbl.appendChild(el('thead', {}, el('tr', {},
    el('th', {}, 'Date'),
    el('th', {}, 'AM/PM'),
    el('th', {}, 'Gun'),
    el('th', {}, 'Rdg #'),
    el('th', {}, 'Fe %'),
    el('th', {}, 'Cr ppm'),
    el('th', {}, 'Mo ppm'),
    el('th', {}, 'Mn ppm'),
    el('th', {}, 'Cu ppm'),
    el('th', {}, 'Ni ppm'),
    el('th', {}, 'Result'),
    el('th', {}, 'Notes'),
  )));
  const tbody = el('tbody');
  for (const r of ver) {
    const result = r['Pass / Fail'];
    tbody.appendChild(el('tr', {},
      el('td', {}, fmtDate(r['Date'])),
      el('td', {}, r['Time (AM/PM)'] || ''),
      el('td', {}, r['XRF S/N'] || ''),
      el('td', {}, String(r['XRF Rdg #'] ?? '')),
      el('td', {}, fmtNum(r['Measured Fe (%)'])),
      el('td', {}, fmtNum(r['Measured Cr (ppm)'])),
      el('td', {}, fmtNum(r['Measured Mo (ppm)'])),
      el('td', {}, fmtNum(r['Measured Mn (ppm)'])),
      el('td', {}, fmtNum(r['Measured Cu (ppm)'])),
      el('td', {}, fmtNum(r['Measured Ni (ppm)'])),
      el('td', { class: result === 'Pass' ? 'pass' : result === 'Fail' ? 'fail' : '' }, result || ''),
      el('td', {}, r['Notes'] || ''),
    ));
  }
  tbl.appendChild(tbody);
  v.appendChild(tbl);
}

// ---------- Field Log ----------
function renderFieldLog(v) {
  v.appendChild(el('h1', {}, 'Daily Field Log'));
  const log = STATE.data.fieldLog;
  const tbl = el('table', { class: 'list-table' });
  tbl.appendChild(el('thead', {}, el('tr', {},
    el('th', {}, 'Date'),
    el('th', {}, 'Weather'),
    el('th', {}, 'Areas'),
    el('th', {}, '# Boulders'),
    el('th', {}, '# Rdgs'),
    el('th', {}, '# Powder'),
    el('th', {}, 'Equipment Issues'),
    el('th', {}, 'Verification'),
    el('th', {}, 'Notes'),
  )));
  const tbody = el('tbody');
  for (const r of log) {
    tbody.appendChild(el('tr', {},
      el('td', {}, fmtDate(r['Date'])),
      el('td', {}, r['Weather'] || ''),
      el('td', {}, r['Area(s) Worked'] || ''),
      el('td', {}, fmtNum(r['# Boulders (auto)'])),
      el('td', {}, fmtNum(r['# XRF Rdgs (auto)'])),
      el('td', {}, fmtNum(r['# Powder (auto)'])),
      el('td', {}, r['Equipment Issues'] || ''),
      el('td', { class: r['Verification Pass?'] === 'Pass' ? 'pass' : '' }, r['Verification Pass?'] || ''),
      el('td', {}, r['Notes / Summary'] || ''),
    ));
  }
  tbl.appendChild(tbody);
  v.appendChild(tbl);
}

// ---------- Reconcile ----------
function renderReconcile(v) {
  v.appendChild(el('h1', {}, 'Reconciliation'));
  v.appendChild(el('div', { class: 'subtitle' },
    'Gun-CSV readings that are not linked to any boulder/depth/powder/verification entry in the tracker.'));

  const orphans = STATE.data.orphans;
  const c = STATE.data.meta.counts;
  v.appendChild(el('div', { class: 'stat-row' },
    statBox('Matched (tracker)', c.surfaceReadings + c.depthReadings + c.powderReadings),
    statBox('Total CSV rdgs', c.csvReadingsTotal),
    statBox('Orphans', orphans.length),
  ));

  // Group orphans by mode
  const byMode = new Map();
  for (const o of orphans) {
    const m = o.mode || o.readingType || 'Unknown';
    if (!byMode.has(m)) byMode.set(m, []);
    byMode.get(m).push(o);
  }
  for (const [mode, list] of [...byMode.entries()].sort((a, b) => b[1].length - a[1].length)) {
    v.appendChild(el('h3', {}, `${mode} `, el('span', { class: 'pill' }, String(list.length))));
    const tbl = el('table', { class: 'list-table' });
    tbl.appendChild(el('thead', {}, el('tr', {},
      el('th', {}, 'Gun'),
      el('th', {}, 'Rdg #'),
      el('th', {}, 'Time'),
      el('th', {}, 'Mode'),
      el('th', {}, 'Sample (CSV)'),
      el('th', {}, 'Pass/Fail'),
      el('th', {}, 'Note'),
    )));
    const tbody = el('tbody');
    for (const o of list.slice(0, 200)) {
      tbody.appendChild(el('tr', {},
        el('td', {}, o.gun),
        el('td', {}, String(o.rdgNo)),
        el('td', {}, o.time || ''),
        el('td', {}, o.mode || ''),
        el('td', {}, o.sampleField || ''),
        el('td', { class: o.passFail === 'Pass' ? 'pass' : o.passFail === 'Fail' ? 'fail' : '' }, o.passFail || ''),
        el('td', {}, o.note || ''),
      ));
    }
    tbl.appendChild(tbody);
    v.appendChild(tbl);
    if (list.length > 200) {
      v.appendChild(el('div', { style: 'color:var(--text-dim);font-size:12px;margin-top:6px;' }, `(${list.length - 200} more rows omitted)`));
    }
  }
}

function statBox(label, val) {
  return el('div', { class: 'stat' },
    el('div', { class: 'v' }, String(val)),
    el('div', { class: 'l' }, label),
  );
}

// ---------- Export view (advanced; pull from source CSVs) ----------
function renderExport(v) {
  v.appendChild(el('h1', {}, 'CSV Export'));
  v.appendChild(el('div', { class: 'subtitle' },
    'Pull rows directly from the master gun CSVs by reading number, with the full column set the gun produced.'));

  const meta = STATE.data.meta;
  const form = el('div', { style: 'background:var(--bg-elev);border:1px solid var(--border);padding:16px;border-radius:6px;max-width:780px;' });

  form.appendChild(el('div', { style: 'margin-bottom:10px;' },
    el('label', { style: 'display:block;font-size:12px;color:var(--text-dim);margin-bottom:4px;' }, 'Gun'),
    (() => {
      const sel = el('select', { id: 'expGun' });
      for (const g of meta.guns) sel.appendChild(el('option', { value: g }, g));
      return sel;
    })(),
  ));

  form.appendChild(el('div', { style: 'margin-bottom:10px;' },
    el('label', { style: 'display:block;font-size:12px;color:var(--text-dim);margin-bottom:4px;' }, 'Source file (within selected gun)'),
    (() => {
      const sel = el('select', { id: 'expFile' });
      const refresh = () => {
        sel.innerHTML = '';
        const gun = $('#expGun').value;
        sel.appendChild(el('option', { value: '__ALL__' }, '(all files)'));
        for (const f of meta.csvFiles.filter(f => f.gun === gun)) {
          sel.appendChild(el('option', { value: f.file }, `${f.file} · ${f.label}`));
        }
      };
      $('#expGun', form).addEventListener('change', refresh);
      setTimeout(refresh, 0);
      return sel;
    })(),
  ));

  form.appendChild(el('div', { style: 'margin-bottom:10px;' },
    el('label', { style: 'display:block;font-size:12px;color:var(--text-dim);margin-bottom:4px;' },
      'Reading numbers (comma-sep, ranges like 5-12 OK, or blank for ALL rows in selected file)'),
    el('input', { id: 'expRdgs', type: 'text', style: 'width:100%;', placeholder: 'e.g. 2-16, 17-19, 47' }),
  ));

  const outputDiv = el('div', { style: 'margin-top:12px;color:var(--text-dim);font-size:12px;' });

  const actions = el('div', { class: 'toolbar' },
    el('button', { class: 'btn', onclick: () => runExport(outputDiv) }, 'Build & download CSV'),
    el('button', { class: 'secondary', onclick: () => previewExport(outputDiv) }, 'Preview first 10 rows'),
  );
  form.appendChild(actions);
  form.appendChild(outputDiv);
  v.appendChild(form);

  // Also offer quick boulder-based export
  v.appendChild(el('h2', { style: 'margin-top:30px;' }, 'Quick export by Sample ID'));
  v.appendChild(el('div', { class: 'subtitle' }, 'Pull all readings (surface + depth + powder) for one or more boulders.'));
  const qform = el('div', { style: 'background:var(--bg-elev);border:1px solid var(--border);padding:16px;border-radius:6px;max-width:780px;' });
  qform.appendChild(el('div', { style: 'margin-bottom:10px;' },
    el('label', { style: 'display:block;font-size:12px;color:var(--text-dim);margin-bottom:4px;' }, 'Sample IDs (one per line or comma-sep)'),
    el('textarea', { id: 'expSids', rows: '4', style: 'width:100%;background:var(--bg);color:var(--text);border:1px solid var(--border-strong);border-radius:4px;padding:6px;font-family:ui-monospace,Menlo,monospace;', placeholder: 'SBM-SWRP-G12-B1\nSBM-WWRP-G02-B2' }),
  ));
  qform.appendChild(el('div', { class: 'toolbar' },
    el('button', { class: 'btn', onclick: () => exportBySampleId() }, 'Download'),
  ));
  v.appendChild(qform);
}

function parseRdgList(s) {
  if (!s.trim()) return null; // null = all
  const out = new Set();
  for (const part of s.split(/[,\s]+/)) {
    if (!part) continue;
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) {
      const [a, b] = [+m[1], +m[2]];
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i);
    } else if (/^\d+$/.test(part)) {
      out.add(+part);
    }
  }
  return out;
}

async function loadCsvFile(fname) {
  if (STATE.csvCache.has(fname)) return STATE.csvCache.get(fname);
  const res = await fetch(`data/${fname}`);
  const text = await res.text();
  const parsed = parseCsv(text);
  STATE.csvCache.set(fname, parsed);
  return parsed;
}

// Minimal CSV parser that handles quoted fields with commas
function parseCsv(text) {
  const rows = [];
  let cur = [], field = '', inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuote = false;
      else field += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ',') { cur.push(field); field = ''; }
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field !== '' || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}

function rowsToCsv(rows) {
  return rows.map(row => row.map(v => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }).join(',')).join('\n');
}

async function gatherExportRows() {
  const gun = $('#expGun').value;
  const file = $('#expFile').value;
  const rdgFilter = parseRdgList($('#expRdgs').value);
  const files = file === '__ALL__'
    ? STATE.data.meta.csvFiles.filter(f => f.gun === gun).map(f => f.file)
    : [file];
  const result = { header: null, rows: [] };
  for (const f of files) {
    const rows = await loadCsvFile(f);
    if (!rows.length) continue;
    const header = rows[0];
    if (!result.header) result.header = header;
    const rdgIdx = header.indexOf('Reading No');
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r.length || !r[rdgIdx]) continue;
      const rdg = parseInt(r[rdgIdx]);
      if (rdgFilter && !rdgFilter.has(rdg)) continue;
      // Align row to result.header if columns differ
      const aligned = result.header.map(h => {
        const idx = header.indexOf(h);
        return idx >= 0 ? r[idx] : '';
      });
      result.rows.push(aligned);
    }
  }
  return result;
}

async function runExport(outputDiv) {
  outputDiv.textContent = 'Building…';
  const { header, rows } = await gatherExportRows();
  if (!header) { outputDiv.textContent = 'No data.'; return; }
  const gun = $('#expGun').value;
  const csv = rowsToCsv([header, ...rows]);
  downloadCsv(`xrf_export_${gun}_${rows.length}rdgs.csv`, csv);
  outputDiv.innerHTML = `Downloaded <b>${rows.length}</b> readings (${header.length} columns).`;
}

async function previewExport(outputDiv) {
  outputDiv.textContent = 'Loading preview…';
  const { header, rows } = await gatherExportRows();
  if (!header) { outputDiv.textContent = 'No data.'; return; }
  outputDiv.innerHTML = '';
  outputDiv.appendChild(el('div', { style: 'margin-bottom:6px;color:var(--text);' },
    `Preview: ${rows.length} matching readings, ${header.length} columns. First 10:`));
  const wrap = el('div', { class: 'dt-wrap' });
  const tbl = el('table', { class: 'dt' });
  tbl.appendChild(el('thead', {}, el('tr', {}, ...header.slice(0, 16).map(h => el('th', {}, h)))));
  const tbody = el('tbody');
  for (const r of rows.slice(0, 10)) {
    tbody.appendChild(el('tr', {}, ...r.slice(0, 16).map(c => el('td', {}, c || ''))));
  }
  tbl.appendChild(tbody);
  wrap.appendChild(tbl);
  outputDiv.appendChild(wrap);
  if (header.length > 16) {
    outputDiv.appendChild(el('div', { style: 'font-size:11px;color:var(--text-dim);margin-top:4px;' },
      `(${header.length - 16} additional columns omitted from preview — full set in download)`));
  }
}

async function exportBySampleId() {
  const text = $('#expSids').value;
  const sids = text.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
  if (!sids.length) { alert('Enter at least one Sample ID'); return; }
  // Collect rdgs by gun
  const byGun = new Map();
  const allReadings = [
    ...STATE.data.surfaceReadings,
    ...STATE.data.depthReadings,
    ...STATE.data.powderReadings,
  ];
  for (const r of allReadings) {
    const sid = r['Sample ID'] || r['Parent Boulder'];
    if (!sids.includes(sid)) continue;
    const gun = r['XRF S/N'] || r._csv?.gun;
    if (!gun) continue;
    if (!byGun.has(gun)) byGun.set(gun, new Set());
    byGun.get(gun).add(parseInt(r['XRF Rdg #']));
  }
  if (!byGun.size) { alert('No readings found for those sample IDs.'); return; }
  // Pull from CSVs
  let combinedHeader = null;
  const combinedRows = [];
  for (const [gun, rdgs] of byGun) {
    for (const f of STATE.data.meta.csvFiles.filter(f => f.gun === gun)) {
      const rows = await loadCsvFile(f.file);
      if (!rows.length) continue;
      const header = rows[0];
      if (!combinedHeader) combinedHeader = header;
      const rdgIdx = header.indexOf('Reading No');
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r[rdgIdx]) continue;
        const rdg = parseInt(r[rdgIdx]);
        if (!rdgs.has(rdg)) continue;
        const aligned = combinedHeader.map(h => {
          const idx = header.indexOf(h);
          return idx >= 0 ? r[idx] : '';
        });
        combinedRows.push(aligned);
      }
    }
  }
  const csv = rowsToCsv([combinedHeader, ...combinedRows]);
  downloadCsv(`xrf_export_${sids.length}boulders_${combinedRows.length}rdgs.csv`, csv);
}

function exportReadingsCSV(readings, type, boulderId) {
  // Use joined CSV rows when available
  // Group by gun & rdg
  const byGun = new Map();
  for (const r of readings) {
    const gun = r['XRF S/N'] || r._csv?.gun;
    const rdg = parseInt(r['XRF Rdg #']);
    if (!gun || !rdg) continue;
    if (!byGun.has(gun)) byGun.set(gun, new Set());
    byGun.get(gun).add(rdg);
  }
  (async () => {
    let header = null;
    const all = [];
    for (const [gun, rdgs] of byGun) {
      for (const f of STATE.data.meta.csvFiles.filter(f => f.gun === gun)) {
        const rows = await loadCsvFile(f.file);
        if (!rows.length) continue;
        if (!header) header = rows[0];
        const rdgIdx = rows[0].indexOf('Reading No');
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (!r[rdgIdx]) continue;
          if (!rdgs.has(parseInt(r[rdgIdx]))) continue;
          const aligned = header.map(h => {
            const idx = rows[0].indexOf(h);
            return idx >= 0 ? r[idx] : '';
          });
          all.push(aligned);
        }
      }
    }
    const csv = rowsToCsv([header, ...all]);
    const tag = boulderId ? boulderId : type;
    downloadCsv(`xrf_${tag}_${type}_${all.length}rdgs.csv`, csv);
  })();
}

function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Search ----------
function setupSearch() {
  const inp = $('#globalSearch');
  const results = $('#searchResults');
  inp.addEventListener('input', () => doSearch(inp.value));
  inp.addEventListener('focus', () => doSearch(inp.value));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search')) results.classList.remove('open');
  });
}

// Build searchable haystack tokens for a boulder.
// Includes the raw ID, area, grid (as "g12", "12", "g012"), boulder ("b1", "1"),
// and all spaced/de-prefixed forms. Used as a single concatenated lowercase string.
function boulderHaystack(b) {
  const sid = (b['Sample ID'] || '').toLowerCase();
  const area = (b['Area Code'] || '').toLowerCase();
  const grid = b['Grid #'];
  const num = String(b['Boulder #'] || '').toLowerCase();
  const numDigits = num.replace(/[^0-9]/g, '');
  const gridPadded = grid != null ? String(grid).padStart(2, '0') : '';
  const parts = [
    sid,
    sid.replace(/-/g, ' '),
    sid.replace(/^sbm-/, ''),
    area,
    `g${grid}`, `g${gridPadded}`, String(grid ?? ''),
    num, numDigits,
    `${area} g${grid} ${num}`,
    `${area}-g${grid}-${num}`,
    `${area} ${grid} ${numDigits}`,
    b['Type (H/F)'] === 'H' ? 'hard h' : b['Type (H/F)'] === 'F' ? 'friable f' : '',
  ];
  return parts.join(' ').toLowerCase();
}

function tokenize(q) {
  return q.toLowerCase().split(/[\s\-\/,_]+/).filter(Boolean);
}

function scoreBoulder(b, tokens, haystack) {
  // Higher = better. Every token must be present.
  let score = 0;
  for (const t of tokens) {
    if (!haystack.includes(t)) return -1;
    // Bonus for matching specific fields
    if ((b['Area Code'] || '').toLowerCase() === t) score += 10;
    if (String(b['Grid #']) === t || `g${b['Grid #']}` === t) score += 6;
    if (String(b['Boulder #'] || '').toLowerCase() === t) score += 6;
    if ((b['Sample ID'] || '').toLowerCase().includes(t)) score += 1;
  }
  // Shorter IDs sort earlier when scores tie
  score -= (b['Sample ID'] || '').length * 0.01;
  return score;
}

function doSearch(q) {
  const results = $('#searchResults');
  q = q.trim();
  results.innerHTML = '';
  if (!q || q.length < 1) { results.classList.remove('open'); return; }
  const tokens = tokenize(q);
  if (!tokens.length) { results.classList.remove('open'); return; }

  // Boulder fuzzy match
  const boulderHits = [];
  for (const b of STATE.data.boulders) {
    const hay = boulderHaystack(b);
    const s = scoreBoulder(b, tokens, hay);
    if (s >= 0) boulderHits.push({ b, score: s });
  }
  boulderHits.sort((a, b) => b.score - a.score);

  // Area fuzzy: any token that is the area code (case-insensitive)
  const areaHits = [];
  for (const a of STATE.data.areas) {
    const al = a.code.toLowerCase();
    if (tokens.some(t => al.startsWith(t) || t.startsWith(al) || al.includes(t))) {
      areaHits.push(a);
    }
  }

  // Reading number: any pure-numeric token can target a reading
  const rdgHits = [];
  const numTokens = tokens.filter(t => /^\d+$/.test(t)).map(Number);
  if (numTokens.length && rdgHits.length < 10) {
    const wantedRdgs = new Set(numTokens);
    for (const r of STATE.data.surfaceReadings) {
      if (wantedRdgs.has(parseInt(r['XRF Rdg #']))) {
        rdgHits.push({ kind: 'Surface', r });
        if (rdgHits.length >= 10) break;
      }
    }
    if (rdgHits.length < 10) {
      for (const r of STATE.data.depthReadings) {
        if (wantedRdgs.has(parseInt(r['XRF Rdg #']))) {
          rdgHits.push({ kind: 'Depth', r });
          if (rdgHits.length >= 10) break;
        }
      }
    }
    if (rdgHits.length < 10) {
      for (const r of STATE.data.powderReadings) {
        if (wantedRdgs.has(parseInt(r['XRF Rdg #']))) {
          rdgHits.push({ kind: 'Powder', r });
          if (rdgHits.length >= 10) break;
        }
      }
    }
  }

  const append = (h) => {
    results.appendChild(el('div', { class: 'search-result', onclick: () => {
      location.hash = h.href.replace(/^#/, '');
      $('#globalSearch').value = '';
      results.classList.remove('open');
    } },
      el('span', { class: 'sr-type' }, h.type),
      h.label,
      h.sub ? el('div', { class: 'sr-sub' }, h.sub) : null,
    ));
  };

  let any = false;
  for (const a of areaHits) {
    append({ type: 'Area', label: a.code, sub: a.done || '', href: `#/area/${a.code}` });
    any = true;
  }
  for (const { b } of boulderHits.slice(0, 25)) {
    append({
      type: 'Boulder',
      label: b['Sample ID'],
      sub: `${b['Area Code']} · G${String(b['Grid #']).padStart(2, '0')} · ${b['Type (H/F)'] === 'H' ? 'Hard' : 'Friable'}`,
      href: `#/boulder/${encodeURIComponent(b['Sample ID'])}`,
    });
    any = true;
  }
  if (boulderHits.length > 25) {
    results.appendChild(el('div', { class: 'search-result', style: 'color:var(--text-dim);font-style:italic;' },
      `+${boulderHits.length - 25} more boulders match — keep typing to narrow…`));
  }
  for (const { kind, r } of rdgHits) {
    append({
      type: `Rdg ${r['XRF Rdg #']}`,
      label: r['Sample ID'] || '(orphan)',
      sub: `${kind} · ${r['XRF S/N'] || ''}`,
      href: r['Sample ID'] ? `#/boulder/${encodeURIComponent(r['Sample ID'])}` : '#/reconcile',
    });
    any = true;
  }

  if (!any) {
    results.appendChild(el('div', { class: 'search-result' },
      el('span', { class: 'sr-sub' }, `No matches for "${q}"`)));
  }
  results.classList.add('open');
}

// ---------- Helpers ----------
function crumbs(items) {
  const c = el('div', { class: 'crumbs' });
  items.forEach(([label, href], i) => {
    if (i) c.appendChild(el('span', {}, '›'));
    c.appendChild(href ? el('a', { href }, label) : el('span', { style: 'color:var(--text);' }, label));
  });
  return c;
}

boot();
