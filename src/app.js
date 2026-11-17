import { POINT_LABELS, computeTrialMetrics, fmt } from './physics.js';
import { renderLinearizationGraph } from './graph.js';
import { PendulumSimulation } from './pendulum-sim.js';

function createEmptyRows() {
  return POINT_LABELS.map((label) => ({
    label,
    hTop: null,
    vTop: 0,
    hBottom: null,
    deltaT: null,
    vBottom: null,
  }));
}

const state = {
  recorder: {
    massKg: 0.05,
    diameterM: 0.025,
    g: 9.8,
    velocityMode: 'photogate', // 'photogate' | 'direct'
    rows: createEmptyRows(),
    calcPoint: 'A',
    calcPos: 'bottom',
  },
  virtual: {
    massKg: 0.05,
    diameterM: 0.025,
    g: 9.8,
    hBottom: 0.15,
    hTop: 0.55,
    slowMo: false,
    realisticNoise: false,
    lastReading: null,
    targetPointIdx: 0,
    rows: createEmptyRows(),
    calcPoint: 'A',
    calcPos: 'bottom',
  },
};

/* =========================================================
 * Accessible Tablist Controller
 * =======================================================*/
function initTabs() {
  const tablist = document.querySelector('[role="tablist"]');
  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
  const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));

  function selectTab(selectedTab, moveFocus = false) {
    tabs.forEach((tab) => {
      const isSelected = tab === selectedTab;
      tab.setAttribute('aria-selected', String(isSelected));
      tab.tabIndex = isSelected ? 0 : -1;
    });

    panels.forEach((panel) => {
      const matches = panel.getAttribute('aria-labelledby') === selectedTab.id;
      if (matches) {
        panel.removeAttribute('hidden');
        panel.tabIndex = 0;
      } else {
        panel.setAttribute('hidden', 'until-found');
        panel.removeAttribute('tabindex');
      }
    });

    if (moveFocus) selectedTab.focus();

    if (selectedTab.id === 'tab-virtual' && sim) {
      requestAnimationFrame(() => sim.resizeCanvas());
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => selectTab(tab, false));
    tab.addEventListener('keydown', (e) => {
      const idx = tabs.indexOf(tab);
      let nextIdx = null;
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = tabs.length - 1;

      if (nextIdx !== null) {
        e.preventDefault();
        selectTab(tabs[nextIdx], true);
      }
    });
  });

  // Sync tab state when browser find-in-page reveals a hidden="until-found" panel
  panels.forEach((panel) => {
    panel.addEventListener('beforematch', () => {
      const tabId = panel.getAttribute('aria-labelledby');
      const tab = document.getElementById(tabId);
      if (tab) selectTab(tab, false);
    });
  });
}

/* =========================================================
 * Shared Lab Report Renderer (Page 1 + Sample Calc + Page 2)
 * =======================================================*/
function renderLabReport(prefix, dataState, { editable }) {
  const tbody1 = document.getElementById(`${prefix}-table1-body`);
  const tbody2 = document.getElementById(`${prefix}-table2-body`);
  const { massKg, g, diameterM, velocityMode, rows } = dataState;

  const computedRows = rows.map((row) => {
    let vBot = row.vBottom;
    if (editable && velocityMode === 'photogate') {
      vBot = Number.isFinite(row.deltaT) && row.deltaT > 0 ? diameterM / row.deltaT : null;
    }
    const metrics = computeTrialMetrics({
      massKg,
      g,
      hTop: row.hTop,
      vTop: row.vTop,
      hBottom: row.hBottom,
      vBottom: vBot,
    });
    return { ...row, vBottom: vBot, ...metrics };
  });

  // Render Page 1 Table
  if (editable) {
    // Update computed cells in-place if inputs already exist, or build rows once
    if (tbody1.children.length === 0) {
      buildEditableRows(tbody1, prefix, dataState);
    }
    computedRows.forEach((r, idx) => {
      const tr = tbody1.children[idx];
      const vModeCell = tr.querySelector('[data-col="vbot-cell"]');
      if (velocityMode === 'photogate') {
        vModeCell.innerHTML = `<span class="computed-v">${fmt(r.vBottom, 3)}</span>`;
        tr.querySelector('.input-dt-wrap').hidden = false;
        tr.querySelector('.input-v-wrap').hidden = true;
      } else {
        tr.querySelector('.input-dt-wrap').hidden = true;
        tr.querySelector('.input-v-wrap').hidden = false;
      }

      tr.querySelector('[data-col="peTop"]').textContent = fmt(r.peTop, 4);
      tr.querySelector('[data-col="keTop"]').textContent = fmt(r.keTop, 4);
      tr.querySelector('[data-col="teTop"]').textContent = fmt(r.teTop, 4);
      tr.querySelector('[data-col="peBot"]').textContent = fmt(r.peBottom, 4);
      tr.querySelector('[data-col="keBot"]').textContent = fmt(r.keBottom, 4);
      tr.querySelector('[data-col="teBot"]').textContent = fmt(r.teBottom, 4);
      tr.querySelector('[data-col="deltaTE"]').textContent =
        r.deltaTE === null ? '—' : `${r.deltaTE >= 0 ? '+' : ''}${fmt(r.deltaTE, 4)}`;
    });
  } else {
    tbody1.innerHTML = computedRows
      .map(
        (r) => `
      <tr>
        <th scope="row">${r.label}</th>
        <td class="computed">${fmt(r.hTop, 3)}</td>
        <td class="computed">${fmt(r.vTop, 2)}</td>
        <td class="computed">${fmt(r.peTop, 4)}</td>
        <td class="computed">${fmt(r.keTop, 4)}</td>
        <td class="computed highlight-te">${fmt(r.teTop, 4)}</td>
        <td class="computed">${fmt(r.hBottom, 3)}</td>
        <td class="computed">${fmt(r.vBottom, 3)}</td>
        <td class="computed">${fmt(r.peBottom, 4)}</td>
        <td class="computed">${fmt(r.keBottom, 4)}</td>
        <td class="computed highlight-te">${fmt(r.teBottom, 4)}</td>
        <td class="computed delta-cell">${
          r.deltaTE === null ? '—' : `${r.deltaTE >= 0 ? '+' : ''}${fmt(r.deltaTE, 4)}`
        }</td>
      </tr>`
      )
      .join('');
  }

  // Render Page 2 Linearization Table
  tbody2.innerHTML = computedRows
    .map(
      (r) => `
    <tr>
      <th scope="row">${r.label}</th>
      <td class="computed">${fmt(r.deltaH, 3)}</td>
      <td class="computed">${fmt(r.vSquared, 3)}</td>
    </tr>`
    )
    .join('');

  // Render Sample Calculation Box
  renderSampleCalculation(prefix, dataState, computedRows);

  // Render Linearization Graph
  const svgEl = document.getElementById(`${prefix}-graph`);
  const statsEls = {
    slopeEl: document.getElementById(`${prefix}-stat-slope`),
    interceptEl: document.getElementById(`${prefix}-stat-intercept`),
    r2El: document.getElementById(`${prefix}-stat-r2`),
    gExpEl: document.getElementById(`${prefix}-stat-g`),
    errorEl: document.getElementById(`${prefix}-stat-error`),
  };
  renderLinearizationGraph(svgEl, computedRows, g, statsEls);
}

function buildEditableRows(tbody, prefix, dataState) {
  tbody.innerHTML = '';
  dataState.rows.forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <th scope="row">${row.label}</th>
      <td>
        <input type="number" step="0.001" min="0" class="table-input" aria-label="Point ${row.label} Top Height (m)" data-field="hTop" placeholder="0.000">
      </td>
      <td>
        <input type="number" step="0.01" min="0" class="table-input" aria-label="Point ${row.label} Top Velocity (m/s)" data-field="vTop" value="0.00">
      </td>
      <td class="computed" data-col="peTop">—</td>
      <td class="computed" data-col="keTop">—</td>
      <td class="computed highlight-te" data-col="teTop">—</td>
      <td>
        <input type="number" step="0.001" min="0" class="table-input" aria-label="Point ${row.label} Bottom Height (m)" data-field="hBottom" placeholder="0.000">
      </td>
      <td>
        <div class="input-dt-wrap">
          <input type="number" step="0.0001" min="0.0001" class="table-input" aria-label="Point ${row.label} Photogate Time Δt (s)" data-field="deltaT" placeholder="Δt (s)">
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">v = <span data-col="vbot-cell">—</span> m/s</div>
        </div>
        <div class="input-v-wrap" hidden>
          <input type="number" step="0.001" min="0" class="table-input" aria-label="Point ${row.label} Bottom Velocity (m/s)" data-field="vBottom" placeholder="0.000">
        </div>
      </td>
      <td class="computed" data-col="peBot">—</td>
      <td class="computed" data-col="keBot">—</td>
      <td class="computed highlight-te" data-col="teBot">—</td>
      <td class="computed delta-cell" data-col="deltaTE">—</td>
    `;

    tr.querySelectorAll('input').forEach((input) => {
      input.addEventListener('input', () => {
        const field = input.dataset.field;
        const val = input.value === '' ? null : parseFloat(input.value);
        dataState.rows[idx][field] = Number.isFinite(val) ? val : null;
        renderLabReport(prefix, dataState, { editable: true });
      });
    });

    tbody.appendChild(tr);
  });
}

function syncEditableInputs(prefix, dataState) {
  const tbody = document.getElementById(`${prefix}-table1-body`);
  dataState.rows.forEach((row, idx) => {
    const tr = tbody.children[idx];
    if (!tr) return;
    ['hTop', 'vTop', 'hBottom', 'deltaT', 'vBottom'].forEach((f) => {
      const inp = tr.querySelector(`[data-field="${f}"]`);
      if (inp) inp.value = row[f] === null ? '' : row[f];
    });
  });
}

function renderSampleCalculation(prefix, dataState, computedRows) {
  const container = document.getElementById(`${prefix}-calc-output`);
  const r = computedRows.find((row) => row.label === dataState.calcPoint);
  if (!r) return;

  const isTop = dataState.calcPos === 'top';
  const h = isTop ? r.hTop : r.hBottom;
  const v = isTop ? r.vTop : r.vBottom;
  const pe = isTop ? r.peTop : r.peBottom;
  const ke = isTop ? r.keTop : r.keBottom;
  const te = isTop ? r.teTop : r.teBottom;
  const { massKg, g, diameterM, velocityMode } = dataState;

  let velHtml = '';
  if (isTop) {
    velHtml = `Released from rest:<br>v = ${fmt(v, 2)} m/s`;
  } else if (prefix === 'rec' && velocityMode === 'direct') {
    velHtml = `Measured by photogate:<br>v = ${fmt(v, 3)} m/s`;
  } else {
    velHtml = `v = d / Δt = ${fmt(diameterM, 3)} m / ${fmt(r.deltaT, 4)} s<br><span class="calc-result">v = ${fmt(
      v,
      3
    )} m/s</span>`;
  }

  container.innerHTML = `
    <div class="calc-step">
      <div class="calc-step-label">1. Velocity (${isTop ? 'Top' : 'Bottom'})</div>
      <div class="calc-formula">${velHtml}</div>
    </div>
    <div class="calc-step">
      <div class="calc-step-label">2. Potential Energy (PE)</div>
      <div class="calc-formula">
        PE = m · g · h<br>
        PE = (${fmt(massKg, 3)} kg)(${fmt(g, 2)} m/s²)(${fmt(h, 3)} m)
        <div class="calc-result">PE = ${fmt(pe, 4)} J</div>
      </div>
    </div>
    <div class="calc-step">
      <div class="calc-step-label">3. Kinetic Energy (KE)</div>
      <div class="calc-formula">
        KE = ½ · m · v²<br>
        KE = 0.5 · (${fmt(massKg, 3)} kg)(${fmt(v, 3)} m/s)²
        <div class="calc-result">KE = ${fmt(ke, 4)} J</div>
      </div>
    </div>
    <div class="calc-step">
      <div class="calc-step-label">4. Total Energy (TE)</div>
      <div class="calc-formula">
        TE = PE + KE<br>
        TE = ${fmt(pe, 4)} J + ${fmt(ke, 4)} J
        <div class="calc-result">TE = ${fmt(te, 4)} J</div>
      </div>
    </div>
  `;
}

/* =========================================================
 * Tab 1: Physical Lab Data Recorder Wiring
 * =======================================================*/
function initRecorderTab() {
  const massInp = document.getElementById('rec-mass');
  const diamInp = document.getElementById('rec-diameter');
  const gSel = document.getElementById('rec-g');
  const modeRadios = document.querySelectorAll('input[name="rec-vel-mode"]');
  const diamField = document.getElementById('rec-diameter-field');
  const calcPtSel = document.getElementById('rec-calc-point');
  const calcPosSel = document.getElementById('rec-calc-pos');

  const update = () => renderLabReport('rec', state.recorder, { editable: true });

  massInp.addEventListener('input', () => {
    const v = parseFloat(massInp.value);
    if (Number.isFinite(v) && v > 0) {
      state.recorder.massKg = v;
      update();
    }
  });

  diamInp.addEventListener('input', () => {
    const v = parseFloat(diamInp.value);
    if (Number.isFinite(v) && v > 0) {
      state.recorder.diameterM = v / 100; // cm -> m
      update();
    }
  });

  gSel.addEventListener('change', () => {
    state.recorder.g = parseFloat(gSel.value);
    update();
  });

  modeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      state.recorder.velocityMode = radio.value;
      diamField.hidden = radio.value !== 'photogate';
      update();
    });
  });

  calcPtSel.addEventListener('change', () => {
    state.recorder.calcPoint = calcPtSel.value;
    update();
  });
  calcPosSel.addEventListener('change', () => {
    state.recorder.calcPos = calcPosSel.value;
    update();
  });

  document.getElementById('rec-sample-btn').addEventListener('click', () => {
    state.recorder.massKg = 0.05;
    state.recorder.diameterM = 0.025;
    state.recorder.g = 9.8;
    massInp.value = '0.050';
    diamInp.value = '2.50';
    gSel.value = '9.8';
    // Realistic sample student data
    const sample = [
      { label: 'A', hTop: 0.25, vTop: 0, hBottom: 0.15, deltaT: 0.0178, vBottom: 1.404 },
      { label: 'B', hTop: 0.35, vTop: 0, hBottom: 0.15, deltaT: 0.0126, vBottom: 1.984 },
      { label: 'C', hTop: 0.45, vTop: 0, hBottom: 0.15, deltaT: 0.0103, vBottom: 2.427 },
      { label: 'D', hTop: 0.55, vTop: 0, hBottom: 0.15, deltaT: 0.0089, vBottom: 2.809 },
      { label: 'E', hTop: 0.65, vTop: 0, hBottom: 0.15, deltaT: 0.0080, vBottom: 3.125 },
    ];
    state.recorder.rows = sample;
    update();
    syncEditableInputs('rec', state.recorder);
  });

  document.getElementById('rec-clear-btn').addEventListener('click', () => {
    state.recorder.rows = createEmptyRows();
    update();
    syncEditableInputs('rec', state.recorder);
  });

  document.getElementById('rec-csv-btn').addEventListener('click', () => exportCSV(state.recorder, 'physical-lab-data.csv'));

  update();
}

/* =========================================================
 * Tab 2: Virtual Pendulum Lab Wiring
 * =======================================================*/
let sim = null;

function initVirtualTab() {
  const canvas = document.getElementById('pendulumCanvas');
  const hTopSlider = document.getElementById('sim-htop');
  const hTopVal = document.getElementById('sim-htop-val');
  const hBotSlider = document.getElementById('sim-hbot');
  const hBotVal = document.getElementById('sim-hbot-val');
  const massInp = document.getElementById('sim-mass');
  const diamInp = document.getElementById('sim-diameter');
  const slowMoChk = document.getElementById('sim-slowmo');
  const noiseChk = document.getElementById('sim-noise');

  const releaseBtn = document.getElementById('sim-release-btn');
  const resetBtn = document.getElementById('sim-reset-btn');
  const recordBtn = document.getElementById('sim-record-btn');
  const targetSel = document.getElementById('sim-target-point');

  const gateStatusEl = document.getElementById('sim-gate-status');
  const lcdDtEl = document.getElementById('sim-lcd-dt');
  const lcdVEl = document.getElementById('sim-lcd-v');

  const barPe = document.getElementById('bar-pe');
  const barKe = document.getElementById('bar-ke');
  const barTe = document.getElementById('bar-te');
  const valPe = document.getElementById('val-pe');
  const valKe = document.getElementById('val-ke');
  const valTe = document.getElementById('val-te');

  sim = new PendulumSimulation(canvas, {
    onGateState: (gateState, reading) => {
      if (gateState === 'ready') {
        gateStatusEl.dataset.state = 'ready';
        gateStatusEl.textContent = '● READY';
        if (!reading) {
          lcdDtEl.textContent = '— s';
          lcdVEl.textContent = '— m/s';
          state.virtual.lastReading = null;
          recordBtn.disabled = true;
        }
      } else if (gateState === 'broken') {
        gateStatusEl.dataset.state = 'broken';
        gateStatusEl.textContent = '◆ BEAM BROKEN';
      } else if (gateState === 'recorded' && reading) {
        gateStatusEl.dataset.state = 'recorded';
        gateStatusEl.textContent = '✓ RECORDED';
        lcdDtEl.textContent = `${fmt(reading.deltaT, 4)} s`;
        lcdVEl.textContent = `${fmt(reading.measuredV, 3)} m/s`;
        state.virtual.lastReading = {
          hTop: state.virtual.hTop,
          hBottom: state.virtual.hBottom,
          deltaT: reading.deltaT,
          vBottom: reading.measuredV,
        };
        recordBtn.disabled = false;
      }
    },
    onEnergyFrame: ({ pe, ke, te, teMax }) => {
      const maxE = Math.max(teMax, 0.01);
      barPe.style.width = `${Math.min(100, (pe / maxE) * 100).toFixed(1)}%`;
      barKe.style.width = `${Math.min(100, (ke / maxE) * 100).toFixed(1)}%`;
      barTe.style.width = `${Math.min(100, (te / maxE) * 100).toFixed(1)}%`;
      valPe.textContent = `${fmt(pe, 3)} J`;
      valKe.textContent = `${fmt(ke, 3)} J`;
      valTe.textContent = `${fmt(te, 3)} J`;
    },
    onHeightDrag: (newHTop) => {
      state.virtual.hTop = newHTop;
      hTopSlider.value = newHTop.toFixed(2);
      hTopVal.textContent = `${newHTop.toFixed(2)} m`;
    },
  });

  function syncSimParams() {
    if (state.virtual.hTop <= state.virtual.hBottom + 0.04) {
      state.virtual.hTop = Number((state.virtual.hBottom + 0.05).toFixed(2));
      hTopSlider.value = state.virtual.hTop;
    }
    hTopSlider.min = (state.virtual.hBottom + 0.05).toFixed(2);
    hTopVal.textContent = `${state.virtual.hTop.toFixed(2)} m`;
    hBotVal.textContent = `${state.virtual.hBottom.toFixed(2)} m`;
    sim.setParams(state.virtual);
    renderLabReport('sim', state.virtual, { editable: false });
  }

  hTopSlider.addEventListener('input', () => {
    state.virtual.hTop = parseFloat(hTopSlider.value);
    syncSimParams();
  });

  hBotSlider.addEventListener('input', () => {
    state.virtual.hBottom = parseFloat(hBotSlider.value);
    syncSimParams();
  });

  massInp.addEventListener('input', () => {
    const v = parseFloat(massInp.value);
    if (Number.isFinite(v) && v > 0) {
      state.virtual.massKg = v;
      syncSimParams();
    }
  });

  diamInp.addEventListener('input', () => {
    const v = parseFloat(diamInp.value);
    if (Number.isFinite(v) && v > 0) {
      state.virtual.diameterM = v / 100;
      syncSimParams();
    }
  });

  slowMoChk.addEventListener('change', () => {
    state.virtual.slowMo = slowMoChk.checked;
    sim.setParams({ slowMo: state.virtual.slowMo });
  });

  noiseChk.addEventListener('change', () => {
    state.virtual.realisticNoise = noiseChk.checked;
    sim.setParams({ realisticNoise: state.virtual.realisticNoise });
  });

  releaseBtn.addEventListener('click', () => {
    sim.release();
  });

  resetBtn.addEventListener('click', () => {
    sim.reset();
  });

  targetSel.addEventListener('change', () => {
    const idx = POINT_LABELS.indexOf(targetSel.value);
    if (idx >= 0) {
      state.virtual.targetPointIdx = idx;
      recordBtn.textContent = `Record as Point ${POINT_LABELS[idx]}`;
    }
  });

  recordBtn.addEventListener('click', () => {
    const rd = state.virtual.lastReading;
    if (!rd) return;
    const idx = state.virtual.targetPointIdx;
    state.virtual.rows[idx] = {
      label: POINT_LABELS[idx],
      hTop: rd.hTop,
      vTop: 0,
      hBottom: rd.hBottom,
      deltaT: rd.deltaT,
      vBottom: rd.vBottom,
    };
    const nextIdx = (idx + 1) % POINT_LABELS.length;
    state.virtual.targetPointIdx = nextIdx;
    targetSel.value = POINT_LABELS[nextIdx];
    recordBtn.textContent = `Record as Point ${POINT_LABELS[nextIdx]}`;
    renderLabReport('sim', state.virtual, { editable: false });
  });

  document.getElementById('sim-calc-point').addEventListener('change', (e) => {
    state.virtual.calcPoint = e.target.value;
    renderLabReport('sim', state.virtual, { editable: false });
  });
  document.getElementById('sim-calc-pos').addEventListener('change', (e) => {
    state.virtual.calcPos = e.target.value;
    renderLabReport('sim', state.virtual, { editable: false });
  });

  document.getElementById('sim-clear-btn').addEventListener('click', () => {
    state.virtual.rows = createEmptyRows();
    state.virtual.targetPointIdx = 0;
    targetSel.value = 'A';
    recordBtn.textContent = 'Record as Point A';
    renderLabReport('sim', state.virtual, { editable: false });
  });

  document.getElementById('sim-csv-btn').addEventListener('click', () => exportCSV(state.virtual, 'virtual-lab-data.csv'));

  window.addEventListener('resize', () => sim.resizeCanvas());
  syncSimParams();
}

/* =========================================================
 * CSV Export
 * =======================================================*/
function exportCSV(dataState, filename) {
  const header = [
    'Point',
    'Top Height (m)',
    'Top Velocity (m/s)',
    'Top PE (J)',
    'Top KE (J)',
    'Top TE (J)',
    'Bottom Height (m)',
    'Bottom Velocity (m/s)',
    'Bottom PE (J)',
    'Bottom KE (J)',
    'Bottom TE (J)',
    'Change in TE (J)',
    'Delta h (m)',
    'v^2 (m^2/s^2)',
  ];
  const lines = [header.join(',')];

  for (const row of dataState.rows) {
    let vBot = row.vBottom;
    if (dataState.velocityMode === 'photogate' && Number.isFinite(row.deltaT) && row.deltaT > 0) {
      vBot = dataState.diameterM / row.deltaT;
    }
    const m = computeTrialMetrics({
      massKg: dataState.massKg,
      g: dataState.g,
      hTop: row.hTop,
      vTop: row.vTop,
      hBottom: row.hBottom,
      vBottom: vBot,
    });
    lines.push(
      [
        row.label,
        fmt(row.hTop, 4),
        fmt(row.vTop, 3),
        fmt(m.peTop, 4),
        fmt(m.keTop, 4),
        fmt(m.teTop, 4),
        fmt(row.hBottom, 4),
        fmt(vBot, 4),
        fmt(m.peBottom, 4),
        fmt(m.keBottom, 4),
        fmt(m.teBottom, 4),
        fmt(m.deltaTE, 4),
        fmt(m.deltaH, 4),
        fmt(m.vSquared, 4),
      ].join(',')
    );
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* =========================================================
 * Bootstrap
 * =======================================================*/
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initRecorderTab();
  initVirtualTab();

  document.getElementById('print-btn').addEventListener('click', () => window.print());
});
