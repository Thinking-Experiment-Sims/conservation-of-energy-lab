import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTrialMetrics,
  computeLinearRegression,
  angleFromDeltaH,
  stepPendulumRK4,
  simulatePhotogateReading,
} from '../src/physics.js';
import { parseVernierEventPacket } from '../src/photogate-hw.js';

test('computeTrialMetrics computes exact conservation of energy values', () => {
  // m = 0.050 kg, g = 9.8 m/s^2, hTop = 0.60 m, hBottom = 0.15 m => dh = 0.45 m
  // vBottom = sqrt(2 * 9.8 * 0.45) = sqrt(8.82) = 2.96984848...
  const vBottom = Math.sqrt(2 * 9.8 * 0.45);
  const res = computeTrialMetrics({
    massKg: 0.05,
    g: 9.8,
    hTop: 0.6,
    vTop: 0,
    hBottom: 0.15,
    vBottom,
  });

  assert.ok(Math.abs(res.peTop - 0.294) < 1e-9);
  assert.equal(res.keTop, 0);
  assert.ok(Math.abs(res.teTop - 0.294) < 1e-9);
  assert.ok(Math.abs(res.peBottom - 0.0735) < 1e-9);
  assert.ok(Math.abs(res.keBottom - 0.2205) < 1e-9);
  assert.ok(Math.abs(res.teBottom - 0.294) < 1e-9);
  assert.ok(Math.abs(res.deltaTE) < 1e-9);
  assert.ok(Math.abs(res.deltaH - 0.45) < 1e-9);
  assert.ok(Math.abs(res.vSquared - 8.82) < 1e-9);
});

test('computeLinearRegression recovers slope = 2g for ideal data', () => {
  const g = 9.8;
  const pts = [0.1, 0.2, 0.3, 0.4, 0.5].map((dh) => ({
    x: dh,
    y: 2 * g * dh,
  }));
  const reg = computeLinearRegression(pts);
  assert.ok(reg);
  assert.equal(reg.n, 5);
  assert.ok(Math.abs(reg.slope - 19.6) < 1e-9);
  assert.ok(Math.abs(reg.intercept) < 1e-9);
  assert.ok(Math.abs(reg.r2 - 1) < 1e-9);
});

test('stepPendulumRK4 conserves mechanical energy over a full swing', () => {
  const L = 1.0;
  const g = 9.8;
  const dh = 0.35;
  const theta0 = angleFromDeltaH(dh, L);
  let state = { theta: theta0, omega: 0 };

  const e0 = g * L * (1 - Math.cos(state.theta));
  const dt = 0.002;
  for (let i = 0; i < 1000; i++) {
    state = stepPendulumRK4(state, dt, L, g);
  }
  const e1 = g * L * (1 - Math.cos(state.theta)) + 0.5 * (L * state.omega) ** 2;
  assert.ok(Math.abs(e1 - e0) < 1e-7);
});

test('simulatePhotogateReading returns exact d/v when noise is off', () => {
  const { deltaT, measuredV } = simulatePhotogateReading(0.025, 2.5, false);
  assert.ok(Math.abs(deltaT - 0.01) < 1e-12);
  assert.ok(Math.abs(measuredV - 2.5) < 1e-12);
});

test('parseVernierEventPacket decodes 1 us timestamps from 0x20 packet', () => {
  const buf = new ArrayBuffer(16);
  const dv = new DataView(buf);
  dv.setUint8(0, 0x20);
  dv.setUint8(4, 0x0b); // int32 subtype
  dv.setUint8(6, 4); // channel 4 (Gate 1)
  dv.setUint8(7, 1); // 1 sample
  dv.setInt32(8, 1, true); // blocked
  dv.setUint32(12, 1_234_567, true); // 1,234,567 us

  const parsed = parseVernierEventPacket(dv);
  assert.ok(parsed);
  assert.equal(parsed.channel, 4);
  assert.equal(parsed.samples[0].value, 1);
  assert.equal(parsed.samples[0].tsUs, 1_234_567);
});
