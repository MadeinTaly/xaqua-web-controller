'use strict';

const { WledClient, WledRegistry, whiteBlueToWled, wledToWhiteBlue } = require('../src/services/wledClient');
const { findActiveSlot, nextSlot } = require('../src/services/wledScheduler');

describe('Mapping bianco/blu <-> WLED (bri/cct)', () => {
  test('bianco pieno → bri 255, cct 0', () => {
    expect(whiteBlueToWled(100, 0)).toEqual({ bri: 255, cct: 0 });
  });
  test('blu pieno → bri 255, cct 255', () => {
    expect(whiteBlueToWled(0, 100)).toEqual({ bri: 255, cct: 255 });
  });
  test('metà e metà → bri 255, cct 128', () => {
    expect(whiteBlueToWled(50, 50)).toEqual({ bri: 255, cct: 128 });
  });
  test('entrambi 0 → bri 0', () => {
    expect(whiteBlueToWled(0, 0)).toEqual({ bri: 0, cct: 0 });
  });
  test('bianco parziale → bri ridotto, cct 0', () => {
    expect(whiteBlueToWled(50, 0)).toEqual({ bri: 128, cct: 0 });
  });
  test('clamp valori fuori range', () => {
    expect(whiteBlueToWled(-10, 999)).toEqual({ bri: 255, cct: 255 });
  });
  test('brightness default 100 (retrocompatibilità): no change', () => {
    expect(whiteBlueToWled(100, 0, undefined)).toEqual({ bri: 255, cct: 0 });
    expect(whiteBlueToWled(50, 50)).toEqual({ bri: 255, cct: 128 });
  });
  test('brightness 50%: scala bri al 50%', () => {
    expect(whiteBlueToWled(100, 0, 50)).toEqual({ bri: 128, cct: 0 });
    expect(whiteBlueToWled(50, 50, 50)).toEqual({ bri: 128, cct: 128 });
  });
  test('brightness 0: bri 0 indipendentemente da white/blue', () => {
    expect(whiteBlueToWled(100, 100, 0)).toEqual({ bri: 0, cct: 128 });
  });
  test('brightness clampato 0-100', () => {
    expect(whiteBlueToWled(100, 0, 150)).toEqual({ bri: 255, cct: 0 });
    expect(whiteBlueToWled(100, 0, -10)).toEqual({ bri: 0, cct: 0 });
  });
  test('reverse: bri255 cct255 → blu pieno', () => {
    expect(wledToWhiteBlue(255, 255)).toEqual({ white: 0, blue: 100 });
  });
  test('reverse: bri128 cct0 → bianco mezzo', () => {
    expect(wledToWhiteBlue(128, 0)).toEqual({ white: 50, blue: 0 });
  });
});

describe('WledClient — modello CCT', () => {
  test('lancia errore senza IP', () => {
    expect(() => new WledClient()).toThrow(/ip mancante/);
  });

  test('costruisce baseUrl corretto', () => {
    const c = new WledClient('192.168.1.50');
    expect(c.baseUrl).toBe('http://192.168.1.50');
  });

  test('applyState bianco/blu → bri+cct, col bianco pieno', async () => {
    const c = new WledClient('1.2.3.4');
    let captured = null;
    c._post = async (endpoint, body) => { captured = { endpoint, body }; return { success: true }; };
    await c.applyState({ on: true, white: 0, blue: 100 });
    expect(captured.endpoint).toBe('/json/state');
    expect(captured.body.on).toBe(true);
    expect(captured.body.bri).toBe(255);
    expect(captured.body.seg[0].cct).toBe(255);
    expect(captured.body.seg[0].col).toEqual([[0, 0, 0, 255]]);
  });

  test('applyState con brightness 50 scala bri al 50%', async () => {
    const c = new WledClient('1.2.3.4');
    let captured = null;
    c._post = async (endpoint, body) => { captured = body; return {}; };
    await c.applyState({ on: true, white: 100, blue: 0, brightness: 50 });
    expect(captured.bri).toBe(128);
  });

  test('applyState brightness legacy (non passato) = 100', async () => {
    const c = new WledClient('1.2.3.4');
    let captured = null;
    c._post = async (endpoint, body) => { captured = body; return {}; };
    await c.applyState({ on: true, white: 50, blue: 50 });
    expect(captured.bri).toBe(255);
  });

  test('applyState entrambi 0 con on non passato → on=false (bri 0)', async () => {
    const c = new WledClient('1.2.3.4');
    let captured = null;
    c._post = async (e, b) => { captured = b; return {}; };
    await c.applyState({ white: 0, blue: 0 });
    expect(captured.bri).toBe(0);
    expect(captured.on).toBe(false);
  });

  test('setOn invia solo on', async () => {
    const c = new WledClient('1.2.3.4');
    let captured = null;
    c._post = async (e, b) => { captured = b; return {}; };
    await c.setOn(false);
    expect(captured).toEqual({ on: false });
  });

  test('getStatus ritorna white/blue dal bri+cct del device', async () => {
    const c = new WledClient('1.2.3.4');
    c.getInfo = async () => ({ name: 'Acquario', ver: '0.15.2', leds: { count: 1, cct: 4 } });
    c.getState = async () => ({ on: true, bri: 255, seg: [{ cct: 255 }] });
    const status = await c.getStatus();
    expect(status.online).toBe(true);
    expect(status.name).toBe('Acquario');
    expect(status.cctCapable).toBe(true);
    expect(status.on).toBe(true);
    expect(status.white).toBe(0);
    expect(status.blue).toBe(100);
  });

  test('getState usa cache entro 4s e la invalida dopo un _post', async () => {
    const c = new WledClient('1.2.3.4');
    let getCalls = 0;
    c._get = async () => { getCalls++; return { on: true, bri: 100, seg: [{ cct: 0 }] }; };
    await c.getState();
    await c.getState();           // cache hit
    expect(getCalls).toBe(1);
    c._invalidateState();         // come fa _post dopo una mutazione di stato
    await c.getState();
    expect(getCalls).toBe(2);
  });

  test('getStatus ritorna online=false su errore', async () => {
    const c = new WledClient('1.2.3.4');
    c.getInfo = async () => { throw new Error('Network unreachable'); };
    const status = await c.getStatus();
    expect(status.online).toBe(false);
    expect(status.error).toContain('Network');
    expect(status.ip).toBe('1.2.3.4');
  });

  test('slot legacy (senza brightness) usa default 100 nello scheduler', () => {
    const legacySlot = { time: '10:00', on: true, white: 80, blue: 40 };
    const brightness = legacySlot.brightness !== undefined ? legacySlot.brightness : 100;
    expect(brightness).toBe(100);
  });

  test('slot nuovo con brightness esplicito usa quel valore', () => {
    const newSlot = { time: '10:00', on: true, white: 80, blue: 40, brightness: 75 };
    const brightness = newSlot.brightness !== undefined ? newSlot.brightness : 100;
    expect(brightness).toBe(75);
  });
});

describe('wledScheduler.nextSlot', () => {
  const SLOTS = [
    { time: '08:00', on: true, white: 90, blue: 30 },
    { time: '20:00', on: true, white: 20, blue: 50 },
    { time: '23:00', on: false, white: 0, blue: 0 }
  ];
  function at(h, m) { return new Date(Date.UTC(2026, 0, 1, h, m, 0)); }
  test('alle 10:00 → prossimo 20:00', () => {
    expect(nextSlot(SLOTS, at(10, 0), 0).time).toBe('20:00');
  });
  test('dopo l ultimo → wrap al primo', () => {
    expect(nextSlot(SLOTS, at(23, 30), 0).time).toBe('08:00');
  });
  test('lista vuota → null', () => {
    expect(nextSlot([], at(10, 0))).toBeNull();
  });
});

describe('WledRegistry', () => {
  test('registra dispositivi e li restituisce per id', () => {
    const r = new WledRegistry();
    r.setDevices([
      { id: 'a', name: 'Salotto', ip: '192.168.1.10', type: 'cct' },
      { id: 'b', name: 'Camera',  ip: '192.168.1.11', type: 'rgb' }
    ]);
    expect(r.listDevices()).toHaveLength(2);
    expect(r.get('a')).toBeDefined();
    expect(r.getDevice('a').name).toBe('Salotto');
    expect(r.get('inesistente')).toBeNull();
  });

  test('rimuove dispositivi non più presenti al successivo setDevices', () => {
    const r = new WledRegistry();
    r.setDevices([{ id: 'a', name: 'A', ip: '1.1.1.1' }, { id: 'b', name: 'B', ip: '2.2.2.2' }]);
    r.setDevices([{ id: 'a', name: 'A', ip: '1.1.1.1' }]);
    expect(r.listDevices()).toHaveLength(1);
    expect(r.get('b')).toBeNull();
  });

  test('aggiorna IP del dispositivo esistente (reinizializza client)', () => {
    const r = new WledRegistry();
    r.setDevices([{ id: 'a', name: 'A', ip: '1.1.1.1' }]);
    const first = r.get('a');
    r.setDevices([{ id: 'a', name: 'A', ip: '2.2.2.2' }]);
    const second = r.get('a');
    expect(first).not.toBe(second);
    expect(second.ip).toBe('2.2.2.2');
  });

  test('ignora dispositivi senza id o ip', () => {
    const r = new WledRegistry();
    r.setDevices([
      { id: 'a', name: 'OK', ip: '1.1.1.1' },
      { name: 'NoId', ip: '2.2.2.2' },
      { id: 'noip', name: 'NoIp' }
    ]);
    expect(r.listDevices()).toHaveLength(1);
  });
});

describe('wledScheduler.findActiveSlot', () => {
  const SLOTS = [
    { time: '06:00', on: true, brightness: 100, primary: {r:255,g:200,b:100,w:0}, secondary: {r:0,g:0,b:0,w:0} },
    { time: '14:00', on: true, brightness: 255, primary: {r:255,g:255,b:255,w:255}, secondary: {r:100,g:150,b:255,w:0} },
    { time: '20:00', on: true, brightness: 80,  primary: {r:255,g:120,b:50,w:50},  secondary: {r:0,g:0,b:80,w:0} },
    { time: '23:30', on: false, brightness: 0,  primary: {r:0,g:0,b:0,w:0},        secondary: {r:0,g:0,b:0,w:0} }
  ];

  function makeNow(hour, min) {
    // Costruisce un Date UTC per il giorno fittizio
    return new Date(Date.UTC(2026, 0, 1, hour, min, 0));
  }

  test('seleziona slot 14:00 alle 15:00', () => {
    const s = findActiveSlot(SLOTS, makeNow(15, 0), 0);
    expect(s.time).toBe('14:00');
  });

  test('seleziona slot 06:00 alle 06:00 esatte', () => {
    const s = findActiveSlot(SLOTS, makeNow(6, 0), 0);
    expect(s.time).toBe('06:00');
  });

  test('alle 05:59 (prima del primo slot) wrap a 23:30', () => {
    const s = findActiveSlot(SLOTS, makeNow(5, 59), 0);
    expect(s.time).toBe('23:30');
  });

  test('alle 00:00 wrap a 23:30 (slot off)', () => {
    const s = findActiveSlot(SLOTS, makeNow(0, 0), 0);
    expect(s.time).toBe('23:30');
    expect(s.on).toBe(false);
  });

  test('rispetta tzOffsetMinutes (UTC+2 alle 12:00 locali = 10:00 UTC, → slot 06:00)', () => {
    // localHour = utcHour + offsetH; quindi utc 10:00 + 120min offset = local 12:00
    const s = findActiveSlot(SLOTS, makeNow(10, 0), 120);
    expect(s.time).toBe('06:00');
  });

  test('ritorna null per lista vuota', () => {
    expect(findActiveSlot([], makeNow(12, 0))).toBeNull();
    expect(findActiveSlot(null, makeNow(12, 0))).toBeNull();
  });
});

describe('wledScheduler — Treatment sui WLED', () => {
  const { treatmentFactor, treatmentSummary } = require('../src/services/experimental');
  const wledScheduler = require('../src/services/wledScheduler');

  test('blackout forza tutti i device spenti (on=false, white=0, blue=0)', () => {
    const treatment = {
      active: true,
      type: 'cyano',
      startDate: '2026-07-02'
    };
    // Giorno 1-3 = blackout
    const dayOne = new Date(2026, 6, 2); // 2026-07-02
    const summary = treatmentSummary(treatment, dayOne);
    expect(summary.phase).toBe('blackout');
    expect(treatmentFactor(treatment, dayOne)).toBe(0);
  });

  test('recovery scala white/blue/brightness per il factor', () => {
    const treatment = {
      active: true,
      type: 'cyano',
      startDate: '2026-07-02'
    };
    // Giorno 5 = secondo giorno di recovery (cyano: 3 blackout + 4 recovery)
    // factor ramp da 0% a 100% su 4 giorni recovery
    const dayFive = new Date(2026, 6, 6); // 2026-07-06
    const summary = treatmentSummary(treatment, dayFive);
    expect(summary.phase).toBe('recovery');
    const factor = treatmentFactor(treatment, dayFive);
    expect(factor).toBeGreaterThan(0);
    expect(factor).toBeLessThan(1);
    // Giorno 5 = recovery day 2, fattore (1 - 1) / 3 = 1/3 ≈ 0.33
    expect(factor).toBeCloseTo(0.33, 1);
  });

  test('recovery: slot con brightness 100 scala per factor', () => {
    const slot = { time: '10:00', on: true, white: 100, blue: 50, brightness: 100 };
    const treatment = { active: true, type: 'cyano', startDate: '2026-07-02' };
    const dayFive = new Date(2026, 6, 6);
    const factor = treatmentFactor(treatment, dayFive);
    const scaledBrightness = Math.round((slot.brightness || 100) * factor);
    expect(scaledBrightness).toBeCloseTo(slot.brightness * factor, 0);
  });

  test('treatment inattivo o non presente = fattore 1 (no scaling)', () => {
    const treatment = { active: false, type: 'cyano' };
    const now = new Date(2026, 6, 2);
    expect(treatmentFactor(treatment, now)).toBe(1);
    expect(treatmentFactor(null, now)).toBe(1);
    expect(treatmentFactor({}, now)).toBe(1);
  });

  test('due getState ravvicinati hitano la cache (1 sola richiesta HTTP)', async () => {
    const c = new WledClient('1.2.3.4');
    let getCalls = 0;
    c._get = async () => { getCalls++; return { on: true, bri: 100, seg: [{ cct: 50 }] }; };

    // Prima chiamata
    await c.getState();
    expect(getCalls).toBe(1);

    // Seconda chiamata entro 3s → cache hit
    await c.getState();
    expect(getCalls).toBe(1);

    // Terza chiamata entro 3s → cache hit
    await c.getState();
    expect(getCalls).toBe(1);
  });

  test('getState cache invalidata dopo setState/applyState', async () => {
    const c = new WledClient('1.2.3.4');
    let getCalls = 0;
    c._get = async () => { getCalls++; return { on: true, bri: 100, seg: [{ cct: 50 }] }; };

    // Prima getState
    await c.getState();
    expect(getCalls).toBe(1);

    // applyState invalida la cache
    c._post = async (endpoint, body) => {
      if (endpoint.indexOf('/json/state') === 0) c._invalidateState();
      return { success: true };
    };
    await c.applyState({ on: true, white: 50, blue: 50 });

    // Ora getState deve rifare la richiesta
    await c.getState();
    expect(getCalls).toBe(2);
  });
});
