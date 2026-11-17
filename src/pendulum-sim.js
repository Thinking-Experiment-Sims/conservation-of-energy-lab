import { angleFromDeltaH, stepPendulumRK4, simulatePhotogateReading, fmt } from './physics.js';

export class PendulumSimulation {
  constructor(canvas, callbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.callbacks = callbacks; // { onReading, onEnergyFrame, onHeightDrag }

    this.lengthM = 1.0;
    this.massKg = 0.05;
    this.diameterM = 0.025;
    this.g = 9.8;
    this.hBottom = 0.15;
    this.hTop = 0.55;
    this.slowMo = false;
    this.realisticNoise = false;

    this.running = false;
    this.hasRecordedPass = false;
    this.beamBroken = false;
    this.theta = angleFromDeltaH(this.hTop - this.hBottom, this.lengthM);
    this.omega = 0;

    this.rafId = null;
    this.lastTimestamp = null;
    this.isDragging = false;

    this.bindPointerEvents();
    this.resizeCanvas();
    this.draw();
  }

  resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(320, rect.width || 620);
    const h = Math.round(w * 0.72);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.viewW = w;
    this.viewH = h;
    this.draw();
  }

  setParams({ massKg, diameterM, g, hBottom, hTop, slowMo, realisticNoise }) {
    if (massKg !== undefined) this.massKg = massKg;
    if (diameterM !== undefined) this.diameterM = diameterM;
    if (g !== undefined) this.g = g;
    if (hBottom !== undefined) this.hBottom = hBottom;
    if (hTop !== undefined) this.hTop = hTop;
    if (slowMo !== undefined) this.slowMo = slowMo;
    if (realisticNoise !== undefined) this.realisticNoise = realisticNoise;

    if (!this.running) {
      this.theta = angleFromDeltaH(this.hTop - this.hBottom, this.lengthM);
      this.omega = 0;
      this.emitInstantEnergy();
    }
    this.draw();
  }

  release() {
    if (this.running) return;
    this.theta = angleFromDeltaH(this.hTop - this.hBottom, this.lengthM);
    this.omega = 0;
    this.hasRecordedPass = false;
    this.beamBroken = false;
    this.running = true;
    this.lastTimestamp = null;
    this.callbacks.onGateState?.('ready', null);
    this.loop = this.loop.bind(this);
    this.rafId = requestAnimationFrame(this.loop);
  }

  reset() {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.theta = angleFromDeltaH(this.hTop - this.hBottom, this.lengthM);
    this.omega = 0;
    this.hasRecordedPass = false;
    this.beamBroken = false;
    this.callbacks.onGateState?.('ready', null);
    this.emitInstantEnergy();
    this.draw();
  }

  loop(timestamp) {
    if (!this.running) return;
    if (this.lastTimestamp === null) this.lastTimestamp = timestamp;
    const rawDt = Math.min(0.032, (timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestamp;

    const timeScale = this.slowMo ? 0.25 : 1.0;
    const simDt = rawDt * timeScale;
    const substep = 0.001;
    const steps = Math.max(1, Math.round(simDt / substep));
    const h = simDt / steps;

    for (let i = 0; i < steps; i++) {
      const prevTheta = this.theta;
      const next = stepPendulumRK4({ theta: this.theta, omega: this.omega }, h, this.lengthM, this.g);
      this.theta = next.theta;
      this.omega = next.omega;

      // Detect photogate beam break near theta = 0
      const halfAngle = (this.diameterM * 0.5) / this.lengthM;
      const currentlyInBeam = Math.abs(this.theta) <= halfAngle;
      if (currentlyInBeam && !this.beamBroken) {
        this.beamBroken = true;
        this.callbacks.onGateState?.('broken', null);
      } else if (!currentlyInBeam && this.beamBroken) {
        this.beamBroken = false;
      }

      // Trigger first downward pass through bottom (prevTheta > 0 && theta <= 0)
      if (!this.hasRecordedPass && prevTheta > 0 && this.theta <= 0) {
        this.hasRecordedPass = true;
        const deltaH = Math.max(0, this.hTop - this.hBottom);
        const vIdeal = Math.sqrt(2 * this.g * deltaH);
        const reading = simulatePhotogateReading(this.diameterM, vIdeal, this.realisticNoise);
        this.callbacks.onGateState?.('recorded', reading);
      }
    }

    this.emitInstantEnergy();
    this.draw();
    this.rafId = requestAnimationFrame(this.loop);
  }

  emitInstantEnergy() {
    const hInst = this.hBottom + this.lengthM * (1 - Math.cos(this.theta));
    const vInst = Math.abs(this.lengthM * this.omega);
    const pe = this.massKg * this.g * hInst;
    const ke = 0.5 * this.massKg * vInst * vInst;
    const te = pe + ke;
    const teMax = this.massKg * this.g * this.hTop;
    this.callbacks.onEnergyFrame?.({ pe, ke, te, teMax });
  }

  getLayoutMetrics() {
    const w = this.viewW || 620;
    const h = this.viewH || 446;
    const tableY = h - 38;
    const topPad = 28;
    const maxMeterH = 1.45; // meters visible from tabletop to top
    const pxPerM = (tableY - topPad) / maxMeterH;
    const pivotX = w * 0.54;
    const pivotHeightM = this.hBottom + this.lengthM;
    const pivotY = tableY - pivotHeightM * pxPerM;
    return { w, h, tableY, pxPerM, pivotX, pivotY };
  }

  bindPointerEvents() {
    const getPos = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.running) return;
      const { x, y } = getPos(e);
      const { pivotX, pivotY, pxPerM } = this.getLayoutMetrics();
      const Lpx = this.lengthM * pxPerM;
      const bobX = pivotX + Lpx * Math.sin(this.theta);
      const bobY = pivotY + Lpx * Math.cos(this.theta);
      const dist = Math.hypot(x - bobX, y - bobY);
      if (dist <= 34) {
        this.isDragging = true;
        this.canvas.setPointerCapture(e.pointerId);
      }
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.isDragging || this.running) return;
      const { x, y } = getPos(e);
      const { pivotX, pivotY } = this.getLayoutMetrics();
      const dx = Math.max(0.05, x - pivotX);
      const dy = Math.max(0.02, y - pivotY);
      let theta = Math.atan2(dx, dy);
      theta = Math.max(0.15, Math.min(1.45, theta));
      let newHTop = this.hBottom + this.lengthM * (1 - Math.cos(theta));
      newHTop = Math.max(this.hBottom + 0.04, Math.min(1.25, newHTop));
      this.hTop = Number(newHTop.toFixed(2));
      this.theta = angleFromDeltaH(this.hTop - this.hBottom, this.lengthM);
      this.callbacks.onHeightDrag?.(this.hTop);
      this.emitInstantEnergy();
      this.draw();
    });

    const endDrag = () => {
      this.isDragging = false;
    };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);
  }

  draw() {
    const ctx = this.ctx;
    const { w, h, tableY, pxPerM, pivotX, pivotY } = this.getLayoutMetrics();

    ctx.clearRect(0, 0, w, h);

    // Pure white lab backdrop
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    // Subtle tabletop
    ctx.fillStyle = '#e6eff4';
    ctx.fillRect(0, tableY, w, h - tableY);
    ctx.strokeStyle = '#8fb3c2';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, tableY);
    ctx.lineTo(w, tableY);
    ctx.stroke();

    ctx.fillStyle = '#47626f';
    ctx.font = '600 11px Inter, sans-serif';
    ctx.fillText('Reference Datum (h = 0.00 m)', 16, tableY + 22);

    // Vertical Meterstick on the left
    const rulerX = 52;
    const rulerTopY = tableY - 1.3 * pxPerM;
    ctx.fillStyle = '#f7fafc';
    ctx.strokeStyle = '#8fb3c2';
    ctx.lineWidth = 1.2;
    ctx.fillRect(rulerX - 18, rulerTopY, 26, tableY - rulerTopY);
    ctx.strokeRect(rulerX - 18, rulerTopY, 26, tableY - rulerTopY);

    ctx.fillStyle = '#123140';
    ctx.font = '600 10px Inter, sans-serif';
    ctx.textAlign = 'right';
    for (let m = 0; m <= 1.25; m += 0.05) {
      const y = tableY - m * pxPerM;
      const isMajor = Math.round(m * 100) % 20 === 0;
      ctx.strokeStyle = isMajor ? '#123140' : '#8fb3c2';
      ctx.lineWidth = isMajor ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(rulerX + (isMajor ? -8 : -3), y);
      ctx.lineTo(rulerX + 8, y);
      ctx.stroke();
      if (isMajor) {
        ctx.fillText(`${m.toFixed(2)}m`, rulerX - 22, y + 3);
      }
    }
    ctx.textAlign = 'left';

    // Horizontal dashed reference lines for h_top and h_bottom
    const yTop = tableY - this.hTop * pxPerM;
    const yBot = tableY - this.hBottom * pxPerM;

    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#d67b19';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(rulerX + 8, yTop);
    ctx.lineTo(w - 20, yTop);
    ctx.stroke();

    ctx.strokeStyle = '#0f7e9b';
    ctx.beginPath();
    ctx.moveTo(rulerX + 8, yBot);
    ctx.lineTo(w - 20, yBot);
    ctx.stroke();
    ctx.restore();

    ctx.font = '600 11px Inter, sans-serif';
    ctx.fillStyle = '#b3620d';
    ctx.fillText(`h_top = ${fmt(this.hTop, 2)} m`, rulerX + 16, yTop - 6);
    ctx.fillStyle = '#0a5c72';
    ctx.fillText(`h_gate = ${fmt(this.hBottom, 2)} m`, rulerX + 16, yBot - 6);

    // Lab Stand & Pivot Clamp
    const standX = pivotX - 110;
    ctx.fillStyle = '#47626f';
    ctx.fillRect(standX - 35, tableY - 10, 70, 10);
    ctx.fillRect(standX - 4, Math.max(12, pivotY - 14), 8, tableY - 10 - Math.max(12, pivotY - 14));
    // Horizontal arm to pivot
    ctx.fillRect(standX, pivotY - 4, pivotX - standX + 6, 8);

    // Pendulum swing arc guide (subtle)
    const Lpx = this.lengthM * pxPerM;
    ctx.strokeStyle = '#dce8ee';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, Lpx, Math.PI * 0.5 - 1.35, Math.PI * 0.5 + 1.35);
    ctx.stroke();

    // Photogate U-bracket at (pivotX, yBot)
    const gateW = 36;
    const gateH = 38;
    ctx.fillStyle = '#123140';
    ctx.fillRect(pivotX - gateW / 2 - 6, yBot - gateH / 2, 7, gateH);
    ctx.fillRect(pivotX + gateW / 2 - 1, yBot - gateH / 2, 7, gateH);
    ctx.fillRect(pivotX - gateW / 2 - 6, yBot + gateH / 2 - 5, gateW + 12, 6);

    // Infrared beam across photogate
    ctx.strokeStyle = this.beamBroken ? '#d67b19' : '#16a34a';
    ctx.lineWidth = this.beamBroken ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(pivotX - gateW / 2 + 1, yBot);
    ctx.lineTo(pivotX + gateW / 2 - 1, yBot);
    ctx.stroke();

    // Photogate LED indicator
    ctx.fillStyle = this.beamBroken ? '#d67b19' : '#16a34a';
    ctx.beginPath();
    ctx.arc(pivotX + gateW / 2 + 2, yBot - gateH / 2 + 6, 4, 0, Math.PI * 2);
    ctx.fill();

    // Pendulum String
    const bobX = pivotX + Lpx * Math.sin(this.theta);
    const bobY = pivotY + Lpx * Math.cos(this.theta);

    ctx.strokeStyle = '#123140';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pivotX, pivotY);
    ctx.lineTo(bobX, bobY);
    ctx.stroke();

    // Pivot pin
    ctx.fillStyle = '#0f7e9b';
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, 5, 0, Math.PI * 2);
    ctx.fill();

    // Pendulum Bob
    const bobR = Math.max(11, Math.min(18, this.diameterM * pxPerM * 0.55));
    const grad = ctx.createRadialGradient(bobX - 4, bobY - 4, 2, bobX, bobY, bobR);
    grad.addColorStop(0, '#5bb4cb');
    grad.addColorStop(1, '#0a5c72');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(bobX, bobY, bobR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#123140';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}
