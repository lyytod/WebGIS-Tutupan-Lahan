/**
 * map.js — MapLibre GL JS initialization, GeoJSON rendering,
 *          interactive popups, and statistics display logic.
 */

// ─────────────────────── CONFIG ───────────────────────
const API_BASE = window.location.origin;
const SURAKARTA_CENTER = [110.825, -7.565];
const DEFAULT_ZOOM = 13;

// Land-cover colour palette (vibrant, distinguishable)
const CLASS_COLORS = [
  '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6',
  '#ec4899', '#22c55e', '#f97316', '#06b6d4', '#a855f7',
  '#64748b', '#84cc16', '#e11d48', '#0ea5e9', '#d946ef',
  '#facc15', '#10b981', '#fb923c', '#6366f1', '#f43f5e',
];

// Helper to assign consistent colours to specific classes
function generateColorMapping(classes) {
  const mapping = {};
  let colorIdx = 0;
  classes.forEach(cls => {
    const norm = String(cls).toLowerCase().trim();
    if (norm === 'vegetasi' || norm.includes('vegetasi')) {
      mapping[cls] = '#22c55e'; // Hijau
    } else if (norm === 'badan air' || norm === 'air' || norm.includes('badan air')) {
      mapping[cls] = '#3b82f6'; // Biru
    } else if (norm === 'lahan terbangun' || norm.includes('lahan terbangun')) {
      mapping[cls] = '#ef4444'; // Merah
    } else if (norm === 'lahan kosong' || norm.includes('lahan kosong')) {
      mapping[cls] = '#f59e0b'; // Kuning
    }
  });
  return mapping;
}

let map;
let currentMode = 'single';
let colorMapping = {};  // className → colour
let multiYearData = null;  // cached matrix endpoint response for modal

// ─────────────────────── MAP INIT ───────────────────────
function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      name: 'Dark Basemap',
      sources: {
        'osm-tiles': {
          type: 'raster',
          tiles: [
            'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors',
        },
      },
      layers: [
        {
          id: 'osm-layer',
          type: 'raster',
          source: 'osm-tiles',
          minzoom: 0,
          maxzoom: 19,
        },
      ],
    },
    center: SURAKARTA_CENTER,
    zoom: DEFAULT_ZOOM,
    maxZoom: 18,
    minZoom: 5,
  });

  // Navigation controls
  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

  map.on('load', () => {
    fetchAvailableYears();
  });
}

// ─────────────────────── FETCH YEARS ───────────────────────
async function fetchAvailableYears() {
  try {
    const res = await fetch(`${API_BASE}/api/data/years`);
    const data = await res.json();
    const years = data.years || [];

    populateSelect('select-year', years);
    populateSelect('select-year-a', years);
    populateSelect('select-year-b', years);
  } catch (err) {
    console.error('Failed to fetch years:', err);
  }
}

function populateSelect(selectId, years) {
  const sel = document.getElementById(selectId);
  // Keep the first placeholder option
  const placeholder = sel.options[0];
  sel.innerHTML = '';
  sel.appendChild(placeholder);

  years.forEach(y => {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    sel.appendChild(opt);
  });
}

// ─────────────────────── MODE TOGGLE ───────────────────────
function setMode(mode) {
  currentMode = mode;
  document.getElementById('btn-single').classList.toggle('active', mode === 'single');
  document.getElementById('btn-multi').classList.toggle('active', mode === 'multi');
  document.getElementById('single-year-controls').style.display = mode === 'single' ? '' : 'none';
  document.getElementById('multi-year-controls').style.display = mode === 'multi' ? '' : 'none';

  // Clear map and stats when switching modes
  clearMapLayers();
  resetStats();
  multiYearData = null;
  document.getElementById('btn-matrix').disabled = true;
}

// ─────────────────────── SINGLE YEAR ───────────────────────
async function loadSingleYear() {
  const year = document.getElementById('select-year').value;
  if (!year) return;

  showLoading(true);
  clearMapLayers();

  try {
    const res = await fetch(`${API_BASE}/api/data/geojson/${year}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    renderGeoJSON(data.geojson, 'single');
    renderSingleStats(data.stats, year);
    showToast(`Data tahun ${year} berhasil dimuat.`, 'success');
  } catch (err) {
    console.error(err);
    showToast(`Gagal memuat data tahun ${year}.`, 'error');
    resetStats();
  } finally {
    showLoading(false);
  }
}

// ─────────────────────── MULTI YEAR (CHANGE DETECTION) ────────────────────
async function loadMultiYear() {
  const yearA = document.getElementById('select-year-a').value;
  const yearB = document.getElementById('select-year-b').value;

  if (!yearA || !yearB) {
    showToast('Pilih kedua tahun untuk perbandingan.', 'error');
    return;
  }
  if (yearA === yearB) {
    showToast('Pilih dua tahun yang berbeda.', 'error');
    return;
  }

  showLoading(true);
  clearMapLayers();
  multiYearData = null;
  document.getElementById('btn-matrix').disabled = true;

  try {
    // Use the intersection-based matrix endpoint
    const res = await fetch(`${API_BASE}/api/data/matrix/${yearA}/${yearB}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    multiYearData = data;

    // Build colour mapping from all class_b values for consistent colouring
    const allClasses = [...new Set([...data.classes_a, ...data.classes_b])].sort();
    colorMapping = generateColorMapping(allClasses);

    // Render the intersected GeoJSON with change-aware styling
    renderChangeGeoJSON(data.geojson, 'change', yearA, yearB);

    // Render stats from matrix data
    renderMultiStatsFromMatrix(data, yearA, yearB);

    // Enable the matrix button
    document.getElementById('btn-matrix').disabled = false;

    showToast(`Perbandingan ${yearA} vs ${yearB} berhasil dimuat.`, 'success');
  } catch (err) {
    console.error(err);
    showToast('Gagal memuat data perbandingan.', 'error');
    resetStats();
  } finally {
    showLoading(false);
  }
}

// ─────────────────────── RENDER GEOJSON ───────────────────────
function detectClassProperty(geojson) {
  if (!geojson.features || geojson.features.length === 0) return null;
  const props = geojson.features[0].properties || {};
  const candidates = [
    'Cls_Name', 'cls_name', 'Cls_ID', 'cls_id',
    'class', 'kelas', 'classname', 'class_name', 'nama_kelas',
    'landcover', 'land_cover', 'tutupan', 'Kelas', 'Class',
    'CLASS', 'CLASSNAME', 'KELAS', 'Nama_Kelas', 'GRIDCODE',
    'gridcode', 'DN', 'dn', 'REMARK', 'remark', 'Keterangan', 'keterangan',
    'TUTUPAN', 'tutupan_lahan', 'Name', 'name', 'Desc', 'desc', 'Description'
  ];
  for (const c of candidates) {
    if (c in props) return c;
  }
  // Fallback: first string-valued key
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === 'string') return k;
  }
  return null;
}

function buildColorMapping(geojson, classProp) {
  if (!classProp) return {};
  const classes = [...new Set(geojson.features.map(f => String(f.properties[classProp] || 'Unknown')))];
  classes.sort();
  colorMapping = generateColorMapping(classes);
  return colorMapping;
}

function renderGeoJSON(geojson, layerPrefix, opacity = 0.65) {
  if (!geojson || !geojson.features) return;

  const sourceId = `${layerPrefix}-source`;
  const fillLayerId = `${layerPrefix}-fill`;
  const lineLayerId = `${layerPrefix}-line`;

  const classProp = detectClassProperty(geojson);
  const mapping = buildColorMapping(geojson, classProp);

  // Build paint expression
  let fillColor = '#14b8a6';
  if (classProp && Object.keys(mapping).length > 0) {
    const matchExpr = ['match', ['to-string', ['get', classProp]]];
    for (const [cls, color] of Object.entries(mapping)) {
      matchExpr.push(cls, color);
    }
    matchExpr.push('#64748b'); // fallback
    fillColor = matchExpr;
  }

  map.addSource(sourceId, { type: 'geojson', data: geojson });

  map.addLayer({
    id: fillLayerId,
    type: 'fill',
    source: sourceId,
    paint: {
      'fill-color': fillColor,
      'fill-opacity': opacity,
    },
  });

  map.addLayer({
    id: lineLayerId,
    type: 'line',
    source: sourceId,
    paint: {
      'line-color': '#e2e8f0',
      'line-width': 0.5,
      'line-opacity': 0.4,
    },
  });

  // Click handler for popups
  map.on('click', fillLayerId, (e) => {
    if (!e.features || e.features.length === 0) return;
    const feature = e.features[0];
    const props = feature.properties;

    let html = '<div class="popup-title">Informasi Area</div>';
    for (const [key, val] of Object.entries(props)) {
      if (key.startsWith('_') || key === 'geometry') continue;
      let displayVal = val;
      // If the key looks area-related, format and add "Ha"
      if (/area|luas|hectare/i.test(key) && !isNaN(val)) {
        displayVal = `${parseFloat(val).toFixed(2)} Ha`;
      }
      html += `<div class="popup-row">
        <span class="popup-row__label">${key}</span>
        <span class="popup-row__value">${displayVal}</span>
      </div>`;
    }

    new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
      .setLngLat(e.lngLat)
      .setHTML(html)
      .addTo(map);
  });

  map.on('mouseenter', fillLayerId, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', fillLayerId, () => { map.getCanvas().style.cursor = ''; });

  // Zoom to data bounds
  _fitBoundsToGeoJSON(geojson);
}


/**
 * renderChangeGeoJSON — Multi-year change-aware rendering.
 * Unchanged polygons (class_a === class_b) get transparent fill + gray outline.
 * Changed polygons get filled with the class_b colour.
 */
function renderChangeGeoJSON(geojson, layerPrefix, yearA, yearB) {
  if (!geojson || !geojson.features) return;

  const sourceId = `${layerPrefix}-source`;
  const fillLayerId = `${layerPrefix}-fill`;
  const lineLayerId = `${layerPrefix}-line`;

  // Build fill-color expression: transparent if unchanged, class_b colour if changed
  const matchExpr = ['match', ['to-string', ['get', 'class_b']]];
  for (const [cls, color] of Object.entries(colorMapping)) {
    matchExpr.push(cls, color);
  }
  matchExpr.push('#64748b');

  // fill-opacity: 0.1 for Tetap, 0.7 for Berubah
  const opacityExpr = ['case',
    ['==', ['get', 'status'], 'Tetap'], 0.08,
    0.7
  ];

  // Line colour: gray for unchanged, white for changed
  const lineColorExpr = ['case',
    ['==', ['get', 'status'], 'Tetap'], '#94a3b8',
    '#e2e8f0'
  ];
  const lineWidthExpr = ['case',
    ['==', ['get', 'status'], 'Tetap'], 0.8,
    0.5
  ];

  map.addSource(sourceId, { type: 'geojson', data: geojson });

  map.addLayer({
    id: fillLayerId,
    type: 'fill',
    source: sourceId,
    paint: {
      'fill-color': matchExpr,
      'fill-opacity': opacityExpr,
    },
  });

  map.addLayer({
    id: lineLayerId,
    type: 'line',
    source: sourceId,
    paint: {
      'line-color': lineColorExpr,
      'line-width': lineWidthExpr,
      'line-opacity': 0.6,
    },
  });

  // Click handler — multi-year popup
  map.on('click', fillLayerId, (e) => {
    if (!e.features || e.features.length === 0) return;
    const props = e.features[0].properties;
    const status = props.status || '—';
    const classA = props.class_a || '—';
    const classB = props.class_b || '—';
    const areaHa = props.area_ha ? parseFloat(props.area_ha).toFixed(2) : '—';
    const statusColor = status === 'Berubah' ? '#ef4444' : '#22c55e';

    const html = `
      <div class="popup-title">Analisis Perubahan</div>
      <div class="popup-row">
        <span class="popup-row__label">Status</span>
        <span class="popup-row__value" style="color:${statusColor}; font-weight:700;">${status}</span>
      </div>
      <div class="popup-row">
        <span class="popup-row__label">Kelas ${yearA}</span>
        <span class="popup-row__value">${classA}</span>
      </div>
      <div class="popup-row">
        <span class="popup-row__label">Kelas ${yearB}</span>
        <span class="popup-row__value">${classB}</span>
      </div>
      <div class="popup-row">
        <span class="popup-row__label">Luas</span>
        <span class="popup-row__value">${areaHa} Ha</span>
      </div>
    `;

    new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
      .setLngLat(e.lngLat)
      .setHTML(html)
      .addTo(map);
  });

  map.on('mouseenter', fillLayerId, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', fillLayerId, () => { map.getCanvas().style.cursor = ''; });

  _fitBoundsToGeoJSON(geojson);
}


/** Shared helper: fit map to GeoJSON bounds */
function _fitBoundsToGeoJSON(geojson) {
  try {
    const bounds = new maplibregl.LngLatBounds();
    geojson.features.forEach(f => {
      if (!f.geometry || !f.geometry.coordinates) return;
      const coords = f.geometry.coordinates.flat(Infinity);
      for (let i = 0; i < coords.length - 1; i += 2) {
        if (isFinite(coords[i]) && isFinite(coords[i + 1])) {
          bounds.extend([coords[i], coords[i + 1]]);
        }
      }
    });
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 1200 });
    }
  } catch (e) {
    console.warn('Could not fit bounds:', e);
  }
}

function clearMapLayers() {
  const prefixes = ['single', 'multi-a', 'multi-b', 'change'];
  prefixes.forEach(prefix => {
    [`${prefix}-fill`, `${prefix}-line`].forEach(layerId => {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
    });
    const srcId = `${prefix}-source`;
    if (map.getSource(srcId)) map.removeSource(srcId);
  });
}

// ─────────────────────── STATS RENDERING ───────────────────────
function resetStats() {
  document.getElementById('stats-container').innerHTML = `
    <div class="empty-state">
      <div class="empty-state__icon">🗺️</div>
      <div class="empty-state__text">Belum ada data</div>
      <div class="empty-state__hint">Pilih tahun untuk menampilkan statistik tutupan lahan</div>
    </div>
  `;
}

function renderSingleStats(stats, year) {
  const container = document.getElementById('stats-container');
  if (!stats || Object.keys(stats).length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">📊</div>
        <div class="empty-state__text">Tidak ada statistik tersedia</div>
      </div>
    `;
    return;
  }

  let html = `<div style="font-size:12px; color: var(--color-text-muted); margin-bottom:12px; font-weight:600;">
    Tahun ${year}
  </div>`;

  let total = 0;
  const sorted = Object.entries(stats).sort((a, b) => b[1] - a[1]);

  sorted.forEach(([cls, area]) => {
    total += area;
    const color = colorMapping[cls] || '#64748b';
    html += `
      <div class="stats-card">
        <div class="stats-card__label">
          <span class="stats-card__dot" style="background:${color};"></span>
          ${cls}
        </div>
        <div class="stats-card__value">${formatNumber(area)} Ha</div>
      </div>
    `;
  });

  html += `
    <div class="stats-card stats-total">
      <div class="stats-card__label" style="font-weight:700;">Total Area</div>
      <div class="stats-card__value">${formatNumber(total)} Ha</div>
    </div>
  `;

  container.innerHTML = html;
}

function renderMultiStats(statsA, statsB, changes, yearA, yearB) {
  const container = document.getElementById('stats-container');
  if (!changes || Object.keys(changes).length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">📊</div>
        <div class="empty-state__text">Tidak ada data perbandingan</div>
      </div>
    `;
    return;
  }

  let html = `<div style="font-size:12px; color: var(--color-text-muted); margin-bottom:12px; font-weight:600;">
    Perbandingan ${yearA} → ${yearB}
  </div>`;

  let totalA = 0, totalB = 0;
  const sorted = Object.entries(changes).sort((a, b) => Math.abs(b[1].change_ha) - Math.abs(a[1].change_ha));

  sorted.forEach(([cls, data]) => {
    totalA += data.year_a;
    totalB += data.year_b;
    const color = colorMapping[cls] || '#64748b';
    const changeSign = data.change_ha >= 0 ? '+' : '';
    const changeClass = data.change_ha >= 0 ? 'stats-card__change--positive' : 'stats-card__change--negative';

    html += `
      <div class="stats-card">
        <div class="stats-card__label">
          <span class="stats-card__dot" style="background:${color};"></span>
          ${cls}
        </div>
        <div>
          <span class="stats-card__value">${formatNumber(data.year_b)} Ha</span>
          <span class="stats-card__change ${changeClass}">
            ${changeSign}${formatNumber(data.change_ha)} Ha
          </span>
        </div>
      </div>
    `;
  });

  const totalChange = totalB - totalA;
  const totalSign = totalChange >= 0 ? '+' : '';
  const totalChangeClass = totalChange >= 0 ? 'stats-card__change--positive' : 'stats-card__change--negative';

  html += `
    <div class="stats-card stats-total">
      <div class="stats-card__label" style="font-weight:700;">Total Area</div>
      <div>
        <span class="stats-card__value">${formatNumber(totalB)} Ha</span>
        <span class="stats-card__change ${totalChangeClass}">
          ${totalSign}${formatNumber(totalChange)} Ha
        </span>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

/**
 * renderMultiStatsFromMatrix — build sidebar stats from the matrix endpoint response.
 */
function renderMultiStatsFromMatrix(data, yearA, yearB) {
  const container = document.getElementById('stats-container');
  const { matrix, classes_a, classes_b } = data;

  if (!matrix || Object.keys(matrix).length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">📊</div>
        <div class="empty-state__text">Tidak ada data perbandingan</div>
      </div>
    `;
    return;
  }

  // Compute per-class totals for year_a and year_b
  const totalsA = {};
  const totalsB = {};
  for (const ca of classes_a) {
    const rowSum = Object.values(matrix[ca] || {}).reduce((s, v) => s + v, 0);
    totalsA[ca] = (totalsA[ca] || 0) + rowSum;
  }
  for (const cb of classes_b) {
    let colSum = 0;
    for (const ca of classes_a) {
      colSum += (matrix[ca] || {})[cb] || 0;
    }
    totalsB[cb] = colSum;
  }

  const allClasses = [...new Set([...classes_a, ...classes_b])].sort();
  let html = `<div style="font-size:12px; color: var(--color-text-muted); margin-bottom:12px; font-weight:600;">
    Perbandingan ${yearA} → ${yearB}
  </div>`;

  let totalA = 0, totalB = 0;
  allClasses.forEach(cls => {
    const areaA = totalsA[cls] || 0;
    const areaB = totalsB[cls] || 0;
    totalA += areaA;
    totalB += areaB;
    const changeHa = areaB - areaA;
    const color = colorMapping[cls] || '#64748b';
    const changeSign = changeHa >= 0 ? '+' : '';
    const changeClass = changeHa >= 0 ? 'stats-card__change--positive' : 'stats-card__change--negative';

    html += `
      <div class="stats-card">
        <div class="stats-card__label">
          <span class="stats-card__dot" style="background:${color};"></span>
          ${cls}
        </div>
        <div>
          <span class="stats-card__value">${formatNumber(areaB)} Ha</span>
          <span class="stats-card__change ${changeClass}">
            ${changeSign}${formatNumber(changeHa)} Ha
          </span>
        </div>
      </div>
    `;
  });

  const totalChange = totalB - totalA;
  const totalSign = totalChange >= 0 ? '+' : '';
  const totalChangeClass = totalChange >= 0 ? 'stats-card__change--positive' : 'stats-card__change--negative';

  html += `
    <div class="stats-card stats-total">
      <div class="stats-card__label" style="font-weight:700;">Total Area</div>
      <div>
        <span class="stats-card__value">${formatNumber(totalB)} Ha</span>
        <span class="stats-card__change ${totalChangeClass}">
          ${totalSign}${formatNumber(totalChange)} Ha
        </span>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

// ─────────────────────── UTILS ───────────────────────
function formatNumber(num) {
  return parseFloat(num).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function showLoading(visible) {
  document.getElementById('loading').style.display = visible ? 'flex' : 'none';
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast toast--${type} show`;
  setTimeout(() => toast.classList.remove('show'), 3500);
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ─────────────────────── TRANSITION MATRIX MODAL ───────────────────────
function openTransitionMatrix() {
  if (!multiYearData) {
    showToast('Lakukan perbandingan terlebih dahulu.', 'error');
    return;
  }

  const modal = document.getElementById('matrix-modal');
  modal.classList.remove('hidden');
  document.getElementById('matrix-subtitle').textContent =
    `Tahun ${multiYearData.year_a} → ${multiYearData.year_b}  •  Area dalam Hektar (Ha)`;

  renderMatrixTable(multiYearData);
}

function closeMatrixModal() {
  document.getElementById('matrix-modal').classList.add('hidden');
}

function renderMatrixTable(data) {
  const body = document.getElementById('matrix-body');
  const { matrix, classes_a, classes_b, year_a, year_b } = data;

  if (!matrix || classes_a.length === 0) {
    body.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">📊</div>
        <div class="empty-state__text">Tidak ada data transisi</div>
      </div>
    `;
    return;
  }

  let html = `<div style="overflow-x:auto;">
    <table class="data-table" style="min-width:600px;">
      <thead><tr>
        <th style="position:sticky;left:0;z-index:2;background:var(--color-bg-dark);">Kelas ${year_a} ↓ \ ${year_b} →</th>`;

  classes_b.forEach(cb => {
    const color = colorMapping[cb] || '#64748b';
    html += `<th><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;"></span>${cb}</th>`;
  });
  html += `<th style="font-weight:800;">Total ${year_a}</th></tr></thead><tbody>`;

  const colTotals = {};
  classes_b.forEach(cb => { colTotals[cb] = 0; });
  let grandTotal = 0;

  classes_a.forEach(ca => {
    const color = colorMapping[ca] || '#64748b';
    html += `<tr>
      <td style="position:sticky;left:0;z-index:1;background:var(--color-bg-card);font-weight:600;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;"></span>${ca}
      </td>`;
    let rowTotal = 0;
    classes_b.forEach(cb => {
      const val = (matrix[ca] || {})[cb] || 0;
      rowTotal += val;
      colTotals[cb] += val;
      // Highlight diagonal (unchanged)
      const isDiag = ca === cb;
      const cellStyle = isDiag
        ? 'background:rgba(34,197,94,0.08);color:#22c55e;font-weight:600;'
        : (val > 0 ? 'color:var(--color-text);' : 'color:var(--color-text-muted);opacity:0.4;');
      html += `<td style="text-align:right;${cellStyle}">${val > 0 ? formatNumber(val) : '—'}</td>`;
    });
    grandTotal += rowTotal;
    html += `<td style="text-align:right;font-weight:700;color:var(--color-primary-light);">${formatNumber(rowTotal)}</td></tr>`;
  });

  // Column totals row
  html += `<tr style="border-top:2px solid var(--color-border);">
    <td style="position:sticky;left:0;z-index:1;background:var(--color-bg-card);font-weight:800;">Total ${year_b}</td>`;
  classes_b.forEach(cb => {
    html += `<td style="text-align:right;font-weight:700;color:var(--color-primary-light);">${formatNumber(colTotals[cb])}</td>`;
  });
  html += `<td style="text-align:right;font-weight:800;color:var(--color-accent);">${formatNumber(grandTotal)}</td></tr>`;

  html += '</tbody></table></div>';
  body.innerHTML = html;
}


// ─────────────────────── BOOT ───────────────────────
document.addEventListener('DOMContentLoaded', initMap);
