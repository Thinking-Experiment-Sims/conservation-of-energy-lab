import { computeLinearRegression, fmt } from './physics.js';

/**
 * Render the Linearization Graph (v^2 vs Δh) into an SVG element and update stats.
 * @param {SVGSVGElement} svgEl
 * @param {Array<{label: string, deltaH: number|null, vSquared: number|null}>} rows
 * @param {number} gKnown
 * @param {object} statsEls - { slopeEl, interceptEl, r2El, gExpEl, errorEl }
 */
export function renderLinearizationGraph(svgEl, rows, gKnown, statsEls) {
  const validPts = rows
    .filter((r) => Number.isFinite(r.deltaH) && Number.isFinite(r.vSquared))
    .map((r) => ({ x: r.deltaH, y: r.vSquared, label: r.label }));

  const reg = computeLinearRegression(validPts);

  if (reg) {
    const gExp = reg.slope / 2;
    const known2g = 2 * gKnown;
    const pctError = (Math.abs(reg.slope - known2g) / known2g) * 100;

    statsEls.slopeEl.textContent = `${fmt(reg.slope, 2)} m/s²`;
    statsEls.interceptEl.textContent = `${fmt(reg.intercept, 3)} m²/s²`;
    statsEls.r2El.textContent = fmt(reg.r2, 4);
    statsEls.gExpEl.textContent = `${fmt(gExp, 2)} m/s²`;
    statsEls.errorEl.textContent = `${fmt(pctError, 1)}%`;
  } else {
    statsEls.slopeEl.textContent = 'Need ≥ 2 points';
    statsEls.interceptEl.textContent = '—';
    statsEls.r2El.textContent = '—';
    statsEls.gExpEl.textContent = '—';
    statsEls.errorEl.textContent = '—';
  }

  // SVG coordinate system
  const W = 560;
  const H = 380;
  const pad = { left: 64, right: 24, top: 24, bottom: 52 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  // Determine clean axis bounds
  let maxX = 0.6;
  let maxY = 12;
  if (validPts.length > 0) {
    const dataMaxX = Math.max(...validPts.map((p) => p.x), 0.1);
    const dataMaxY = Math.max(...validPts.map((p) => p.y), 1);
    maxX = niceCeil(dataMaxX * 1.15);
    maxY = niceCeil(dataMaxY * 1.15);
  }

  const toSvgX = (x) => pad.left + (x / maxX) * plotW;
  const toSvgY = (y) => pad.top + plotH - (y / maxY) * plotH;

  const parts = [];
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff" />`);

  // Minor & Major Gridlines (5 major divisions)
  const majorDivs = 5;
  const minorSub = 4;
  for (let i = 0; i <= majorDivs * minorSub; i++) {
    const frac = i / (majorDivs * minorSub);
    const isMajor = i % minorSub === 0;
    const x = pad.left + frac * plotW;
    const y = pad.top + frac * plotH;

    parts.push(
      `<line x1="${x.toFixed(1)}" y1="${pad.top}" x2="${x.toFixed(1)}" y2="${pad.top + plotH}" stroke="${
        isMajor ? '#c8dbe3' : '#edf4f7'
      }" stroke-width="${isMajor ? 1.2 : 0.8}" ${isMajor ? '' : 'stroke-dasharray="2,2"'} />`
    );
    parts.push(
      `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${pad.left + plotW}" y2="${y.toFixed(1)}" stroke="${
        isMajor ? '#c8dbe3' : '#edf4f7'
      }" stroke-width="${isMajor ? 1.2 : 0.8}" ${isMajor ? '' : 'stroke-dasharray="2,2"'} />`
    );
  }

  // Axes
  parts.push(
    `<line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotH}" stroke="#123140" stroke-width="2" />`
  );
  parts.push(
    `<line x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}" y2="${pad.top + plotH}" stroke="#123140" stroke-width="2" />`
  );

  // Tick labels
  for (let i = 0; i <= majorDivs; i++) {
    const xVal = (i / majorDivs) * maxX;
    const xPos = toSvgX(xVal);
    parts.push(
      `<text x="${xPos.toFixed(1)}" y="${pad.top + plotH + 18}" text-anchor="middle" font-size="11" fill="#47626f">${formatTick(
        xVal
      )}</text>`
    );

    const yVal = (i / majorDivs) * maxY;
    const yPos = toSvgY(yVal);
    parts.push(
      `<text x="${pad.left - 8}" y="${(yPos + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#47626f">${formatTick(
        yVal
      )}</text>`
    );
  }

  // Axis Titles
  parts.push(
    `<text x="${pad.left + plotW / 2}" y="${H - 12}" text-anchor="middle" font-size="12.5" font-weight="600" fill="#123140">Change in Height Δh (m)</text>`
  );
  parts.push(
    `<text x="18" y="${pad.top + plotH / 2}" text-anchor="middle" font-size="12.5" font-weight="600" fill="#123140" transform="rotate(-90 18 ${
      pad.top + plotH / 2
    })">Velocity Squared v² (m²/s²)</text>`
  );

  // Theoretical reference line v² = 2g Δh (subtle dashed teal)
  const yTheoryEnd = 2 * gKnown * maxX;
  const xTheoryEnd = yTheoryEnd > maxY ? maxY / (2 * gKnown) : maxX;
  parts.push(
    `<line x1="${toSvgX(0).toFixed(1)}" y1="${toSvgY(0).toFixed(1)}" x2="${toSvgX(xTheoryEnd).toFixed(
      1
    )}" y2="${toSvgY(2 * gKnown * xTheoryEnd).toFixed(
      1
    )}" stroke="#8fb3c2" stroke-width="1.5" stroke-dasharray="6,4" />`
  );

  // Best-fit regression line (solid Amber)
  if (reg) {
    const x1 = 0;
    const y1 = reg.intercept;
    const x2 = maxX;
    const y2 = reg.slope * x2 + reg.intercept;
    parts.push(
      `<line x1="${toSvgX(x1).toFixed(1)}" y1="${toSvgY(y1).toFixed(1)}" x2="${toSvgX(x2).toFixed(
        1
      )}" y2="${toSvgY(y2).toFixed(1)}" stroke="#d67b19" stroke-width="2.5" />`
    );
  }

  // Data Points A-E
  for (const pt of validPts) {
    const cx = toSvgX(pt.x);
    const cy = toSvgY(pt.y);
    parts.push(
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5.5" fill="#0f7e9b" stroke="#ffffff" stroke-width="2"><title>Point ${
        pt.label
      }: Δh = ${fmt(pt.x, 3)} m, v² = ${fmt(pt.y, 2)} m²/s²</title></circle>`
    );
    parts.push(
      `<text x="${(cx + 8).toFixed(1)}" y="${(cy - 7).toFixed(
        1
      )}" font-size="11.5" font-weight="700" fill="#0a5c72">${pt.label}</text>`
    );
  }

  // Legend
  parts.push(
    `<g transform="translate(${pad.left + 12}, ${pad.top + 10})">
      <rect x="0" y="0" width="182" height="44" rx="6" fill="#ffffff" fill-opacity="0.92" stroke="#c8dbe3" />
      <line x1="10" y1="14" x2="32" y2="14" stroke="#d67b19" stroke-width="2.5" />
      <text x="38" y="18" font-size="10.5" fill="#123140">Best-fit line (slope ≈ 2g)</text>
      <line x1="10" y1="31" x2="32" y2="31" stroke="#8fb3c2" stroke-width="1.5" stroke-dasharray="5,3" />
      <text x="38" y="35" font-size="10.5" fill="#47626f">Theory: v² = ${fmt(2 * gKnown, 1)}·Δh</text>
    </g>`
  );

  svgEl.innerHTML = parts.join('');
}

function niceCeil(val) {
  if (val <= 0) return 1;
  const exp = Math.floor(Math.log10(val));
  const base = 10 ** exp;
  const norm = val / base;
  let niceNorm = 10;
  if (norm <= 1.2) niceNorm = 1.2;
  else if (norm <= 1.5) niceNorm = 1.5;
  else if (norm <= 2) niceNorm = 2;
  else if (norm <= 2.5) niceNorm = 2.5;
  else if (norm <= 3) niceNorm = 3;
  else if (norm <= 4) niceNorm = 4;
  else if (norm <= 5) niceNorm = 5;
  else if (norm <= 6) niceNorm = 6;
  else if (norm <= 8) niceNorm = 8;
  return niceNorm * base;
}

function formatTick(val) {
  if (val === 0) return '0';
  if (val < 1) return val.toFixed(2).replace(/0$/, '');
  if (val < 10) return val.toFixed(1).replace(/\.0$/, '');
  return Math.round(val).toString();
}
