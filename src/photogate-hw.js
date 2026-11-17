/**
 * Hardware Photogate Connector
 * Supports Vernier Go Direct Photogates (GDX-VPG via Web Bluetooth / USB WebHID)
 * and USB Serial Photogates (Arduino / micro:bit via Web Serial API).
 */

export function parseVernierEventPacket(dv) {
  if (dv.byteLength < 16 || dv.getUint8(0) !== 0x20) return null;
  const subtype = dv.getUint8(4);
  if (subtype !== 0x0a && subtype !== 0x0b) return null;
  const channel = dv.getUint8(6);
  const count = dv.getUint8(7);
  const samples = [];
  for (let i = 0; i < count && 8 + i * 8 + 8 <= dv.byteLength; i++) {
    const at = 8 + i * 8;
    const value = subtype === 0x0b ? dv.getInt32(at, true) : dv.getFloat32(at, true);
    const tsUs = dv.getUint32(at + 4, true);
    samples.push({ value, tsUs });
  }
  return samples.length ? { subtype, channel, samples } : null;
}

export class PhotogateHardware {
  constructor(callbacks) {
    this.callbacks = callbacks; // { onConnection, onBeamState, onGateDuration }
    this.connectedDevice = null;
    this.serialPort = null;
    this.serialReader = null;
    this.beams = {
      1: { blocked: false, blockPerfMs: 0, blockTsUs: 0, hasHwTs: false },
      2: { blocked: false, blockPerfMs: 0, blockTsUs: 0, hasHwTs: false },
    };
  }

  onBeamEvent(beamNum, isBlocked, hwTsUs = null) {
    const beam = this.beams[beamNum];
    if (!beam) return;
    const nowPerf = performance.now();

    // Deduplicate when both raw packet tap and godirect value-changed fire for the same edge
    if (isBlocked === beam.blocked) {
      if (isBlocked && hwTsUs !== null && !beam.hasHwTs) {
        beam.blockTsUs = hwTsUs;
        beam.hasHwTs = true;
      }
      return;
    }

    if (isBlocked) {
      beam.blocked = true;
      beam.blockPerfMs = nowPerf;
      beam.hasHwTs = hwTsUs !== null;
      if (hwTsUs !== null) beam.blockTsUs = hwTsUs;
      this.callbacks.onBeamState?.(beamNum, true);
    } else {
      beam.blocked = false;
      let durationSec = 0;
      let source = 'Browser Clock';

      if (hwTsUs !== null && beam.hasHwTs && beam.blockTsUs > 0) {
        let diff = hwTsUs - beam.blockTsUs;
        if (diff < 0) diff += 0x100000000;
        durationSec = diff / 1_000_000;
        source = 'Vernier 1 µs Clock';
      } else if (beam.blockPerfMs > 0) {
        durationSec = (nowPerf - beam.blockPerfMs) / 1000;
        source = 'Browser Performance Clock';
      }

      beam.hasHwTs = false;
      this.callbacks.onBeamState?.(beamNum, false);

      if (durationSec > 0.0001 && durationSec < 10.0) {
        this.callbacks.onGateDuration?.(beamNum, durationSec, source);
      }
    }
  }

  async connectVernier(isBle = true) {
    if (typeof window.godirect === 'undefined') {
      throw new Error('Vernier Go Direct library is not loaded.');
    }

    this.callbacks.onConnection?.('connecting', `Connecting via ${isBle ? 'Bluetooth' : 'USB WebHID'}...`);
    const device = await window.godirect.selectDevice(isBle);
    if (!device) {
      this.callbacks.onConnection?.('disconnected', 'Connection cancelled.');
      return;
    }

    this.connectedDevice = device;
    const devName = device.name || 'Vernier Go Direct Photogate';

    // Tap raw 0x20 packets for 1 µs hardware timestamps
    const originalHandle = device._handleResponse?.bind(device);
    if (originalHandle) {
      device._handleResponse = (dataView) => {
        try {
          const packet = parseVernierEventPacket(dataView);
          if (packet) {
            for (const sample of packet.samples) {
              if (packet.channel === 4) this.onBeamEvent(1, sample.value === 1, sample.tsUs);
              else if (packet.channel === 5) this.onBeamEvent(2, sample.value === 1, sample.tsUs);
            }
          }
        } catch {
          // Keep resilient
        }
        originalHandle(dataView);
      };
    }

    const gate1Sensor =
      device.sensors.find((s) => /gate\s*1/i.test(s.name) && /state/i.test(s.name)) || device.getSensor(4);
    const gate2Sensor =
      device.sensors.find((s) => /gate\s*2/i.test(s.name) && /state/i.test(s.name)) || device.getSensor(5);

    if (gate1Sensor) {
      gate1Sensor.setEnabled(true);
      gate1Sensor.on('value-changed', (s) => {
        if (s.value !== null) this.onBeamEvent(1, s.value === 1);
      });
    }

    if (gate2Sensor) {
      gate2Sensor.setEnabled(true);
      gate2Sensor.on('value-changed', (s) => {
        if (s.value !== null) this.onBeamEvent(2, s.value === 1);
      });
    }

    if (typeof device.start === 'function') {
      await device.start(0);
    }

    device.on('device-closed', () => {
      this.disconnect();
    });

    this.callbacks.onConnection?.('connected', `CONNECTED: ${devName}`);
  }

  async connectSerial() {
    if (!('serial' in navigator)) {
      throw new Error('Web Serial API requires Google Chrome or Microsoft Edge.');
    }

    this.callbacks.onConnection?.('connecting', 'Selecting USB Serial port...');
    this.serialPort = await navigator.serial.requestPort();
    await this.serialPort.open({ baudRate: 115200 });
    this.callbacks.onConnection?.('connected', 'CONNECTED: USB Serial Photogate');

    const textDecoder = new TextDecoderStream();
    this.serialPort.readable.pipeTo(textDecoder.writable).catch(() => {});
    this.serialReader = textDecoder.readable.getReader();
    let buffer = '';

    (async () => {
      try {
        while (true) {
          const { value, done } = await this.serialReader.read();
          if (done) break;
          buffer += value;
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            const clean = line.trim().toUpperCase();
            if (!clean) continue;
            if (clean.includes('1') || clean.includes('G1') || clean.includes('BEAM1')) {
              this.onBeamEvent(1, clean.includes('BLOCK') || clean === '1');
            } else if (clean.includes('2') || clean.includes('G2') || clean.includes('BEAM2')) {
              this.onBeamEvent(2, clean.includes('BLOCK') || clean === '2');
            }
          }
        }
      } catch {
        // Stream closed
      }
    })();
  }

  async disconnect() {
    if (this.connectedDevice) {
      try {
        if (typeof this.connectedDevice.close === 'function') {
          await this.connectedDevice.close();
        }
      } catch {
        // Ignore close errors
      }
      this.connectedDevice = null;
    }

    if (this.serialReader) {
      try {
        await this.serialReader.cancel();
      } catch {
        // Ignore
      }
      this.serialReader = null;
    }

    if (this.serialPort) {
      try {
        await this.serialPort.close();
      } catch {
        // Ignore
      }
      this.serialPort = null;
    }

    this.beams[1].blocked = false;
    this.beams[2].blocked = false;
    this.callbacks.onBeamState?.(1, false);
    this.callbacks.onBeamState?.(2, false);
    this.callbacks.onConnection?.('disconnected', 'DISCONNECTED · Click Connect to pair a photogate');
  }
}
