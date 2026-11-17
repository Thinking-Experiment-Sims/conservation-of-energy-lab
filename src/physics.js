/**
 * Physics & Linearization Engine for Conservation of Energy Pendulum Lab.
 * Pure ES module used by both the UI and Node unit tests.
 */

export const POINT_LABELS = ['A', 'B', 'C', 'D', 'E'];

/**
 * Compute energy quantities for a single trial row.
 * @param {object} params
 * @param {number} params.massKg - Bob mass (kg)
 * @param {number} params.g - Gravitational acceleration (m/s^2)
 * @param {number|null} params.hTop - Initial drop height (m)
 * @param {number|null} params.vTop - Initial velocity (m/s), typically 0
 * @param {number|null} params.hBottom - Photogate height (m)
 * @param {number|null} params.vBottom - Velocity at photogate (m/s)
 * @returns {object} Computed values or nulls when inputs are incomplete
 */
export function computeTrialMetrics({ massKg, g, hTop, vTop, hBottom, vBottom }) {
  const validMass = Number.isFinite(massKg) && massKg > 0;
  const validG = Number.isFinite(g) && g > 0;

  const hasTop = validMass && validG && Number.isFinite(hTop) && Number.isFinite(vTop);
  const peTop = hasTop ? massKg * g * hTop : null;
  const keTop = hasTop ? 0.5 * massKg * vTop * vTop : null;
  const teTop = hasTop ? peTop + keTop : null;

  const hasBottom = validMass && validG && Number.isFinite(hBottom) && Number.isFinite(vBottom);
  const peBottom = hasBottom ? massKg * g * hBottom : null;
  const keBottom = hasBottom ? 0.5 * massKg * vBottom * vBottom : null;
  const teBottom = hasBottom ? peBottom + keBottom : null;

  const deltaTE = hasTop && hasBottom ? teBottom - teTop : null;
  const deltaH = Number.isFinite(hTop) && Number.isFinite(hBottom) ? hTop - hBottom : null;
  const vSquared = Number.isFinite(vBottom) ? vBottom * vBottom : null;

  return {
    peTop,
    keTop,
    teTop,
    peBottom,
    keBottom,
    teBottom,
    deltaTE,
    deltaH,
    vSquared,
  };
}

/**
 * Compute ordinary least squares linear regression y = slope * x + intercept.
 * @param {Array<{x: number, y: number, label?: string}>} points
 * @returns {{slope: number, intercept: number, r2: number, n: number}|null}
 */
export function computeLinearRegression(points) {
  const valid = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = valid.length;
  if (n < 2) return null;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (const { x, y } of valid) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-12) return null;

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const meanY = sumY / n;
  let ssTot = 0;
  let ssRes = 0;
  for (const { x, y } of valid) {
    const yHat = slope * x + intercept;
    ssTot += (y - meanY) ** 2;
    ssRes += (y - yHat) ** 2;
  }
  const r2 = ssTot < 1e-12 ? 1 : Math.max(0, 1 - ssRes / ssTot);

  return { slope, intercept, r2, n };
}

/**
 * Compute theoretical release angle (rad) from vertical for a given drop height above the lowest point.
 * cos(theta) = 1 - deltaH / L
 * @param {number} deltaH - Height above lowest point (m)
 * @param {number} lengthM - Pendulum length (m)
 * @returns {number} angle in radians in [0, pi/2]
 */
export function angleFromDeltaH(deltaH, lengthM) {
  const ratio = Math.max(0, Math.min(0.98, deltaH / lengthM));
  return Math.acos(1 - ratio);
}

/**
 * Advance nonlinear pendulum state (theta, omega) by dt using 4th-order Runge-Kutta.
 * @param {{theta: number, omega: number}} state
 * @param {number} dt - Time step (s)
 * @param {number} lengthM - Pendulum length (m)
 * @param {number} g - Gravity (m/s^2)
 * @returns {{theta: number, omega: number}}
 */
export function stepPendulumRK4(state, dt, lengthM, g) {
  const k = g / lengthM;
  const accel = (theta) => -k * Math.sin(theta);

  const th1 = state.theta;
  const om1 = state.omega;
  const a1 = accel(th1);

  const th2 = th1 + 0.5 * dt * om1;
  const om2 = om1 + 0.5 * dt * a1;
  const a2 = accel(th2);

  const th3 = th1 + 0.5 * dt * om2;
  const om3 = om1 + 0.5 * dt * a2;
  const a3 = accel(th3);

  const th4 = th1 + dt * om3;
  const om4 = om1 + dt * a3;
  const a4 = accel(th4);

  return {
    theta: th1 + (dt / 6) * (om1 + 2 * om2 + 2 * om3 + om4),
    omega: om1 + (dt / 6) * (a1 + 2 * a2 + 2 * a3 + a4),
  };
}

/**
 * Compute simulated photogate transit time for a bob of diameter d at speed v.
 * Optionally applies realistic Gaussian-like measurement jitter.
 * @param {number} diameterM
 * @param {number} speedMs
 * @param {boolean} realisticNoise
 * @param {number} [randUnit] - Optional uniform [0,1) value for deterministic testing
 * @returns {{deltaT: number, measuredV: number}}
 */
export function simulatePhotogateReading(diameterM, speedMs, realisticNoise = false, randUnit = Math.random()) {
  if (!Number.isFinite(speedMs) || speedMs <= 0 || !Number.isFinite(diameterM) || diameterM <= 0) {
    return { deltaT: 0, measuredV: 0 };
  }
  const idealDt = diameterM / speedMs;
  const jitter = realisticNoise ? 1 + (randUnit - 0.5) * 0.024 : 1; // ±1.2%
  const deltaT = idealDt * jitter;
  const measuredV = diameterM / deltaT;
  return { deltaT, measuredV };
}

export function fmt(val, decimals = 3) {
  if (!Number.isFinite(val)) return '—';
  return val.toFixed(decimals);
}
