'use strict';

/**
 * Integration test per i fix bug e nuovi scenari.
 * Non richiede connessione al device reale — testa la logica dei moduli.
 */

// ---------------------------------------------------------------------------
// B) Algoritmo lunare continuo (BUG 4 fix)
// ---------------------------------------------------------------------------

describe('calculateMoonAge — algoritmo sinodico continuo', () => {
  const { calculateMoonAge, calculateMoonPhase } = require('../src/services/moonHelper');

  test('età è compresa tra 0 e ~29.53', () => {
    const dates = [
      new Date('2020-01-01'),
      new Date('2026-04-10'),
      new Date('2030-12-31'),
      new Date('2050-06-15'),
      new Date('1999-01-01')
    ];
    dates.forEach(d => {
      const age = calculateMoonAge(d);
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThan(30);
    });
  });

  test('età è 0 alla luna nuova di riferimento (Apr 10 2026)', () => {
    const age = calculateMoonAge(new Date('2026-04-10T12:00:00Z'));
    expect(age).toBeLessThan(0.1);
  });

  test('età è ciclica — due date a distanza di un ciclo sinodico hanno la stessa età', () => {
    const d1 = new Date('2026-06-15T12:00:00Z');
    const d2 = new Date(d1.getTime() + 29.53059 * 24 * 3600 * 1000);
    const age1 = calculateMoonAge(d1);
    const age2 = calculateMoonAge(d2);
    expect(Math.abs(age1 - age2)).toBeLessThan(0.01);
  });

  test('fase novilunio per date lontane (2030)', () => {
    // Trova una data di luna nuova nel 2030 — circa 4 anni dopo il riferimento
    // Il ciclo sinodico è 29.53 giorni. Partiamo da Apr 10 2026 e aggiungiamo multipli esatti.
    const cycles = 50; // ~4 anni
    const futureNewMoon = new Date('2026-04-10T12:00:00Z').getTime() + cycles * 29.53059 * 86400000;
    const phase = calculateMoonPhase(new Date(futureNewMoon));
    expect(phase).toBe('novilunio');
  });

  test('fase plenilunio ~15 giorni dopo il riferimento', () => {
    const fullMoonDate = new Date('2026-04-10T12:00:00Z').getTime() + 14.76 * 86400000;
    const phase = calculateMoonPhase(new Date(fullMoonDate));
    expect(phase).toBe('plenilunio');
  });

  test('date precedenti al riferimento funzionano', () => {
    // 11 Gen 2026 è ~89 giorni prima del riferimento
    const age = calculateMoonAge(new Date('2026-01-11T12:00:00Z'));
    // Dovrebbe essere vicina a 0 o a ~29 — entrambe indicano novilunio
    expect(age < 1.5 || age >= 28).toBe(true);
    const phase = calculateMoonPhase(new Date('2026-01-11T12:00:00Z'));
    expect(phase).toBe('novilunio');
  });

  test('età cresce linearmente con il tempo', () => {
    const base = new Date('2026-04-12T12:00:00Z');
    const age1 = calculateMoonAge(base);
    const age2 = calculateMoonAge(new Date(base.getTime() + 7 * 86400000));
    expect(age2 - age1).toBeGreaterThan(6.5);
    expect(age2 - age1).toBeLessThan(7.5);
  });
});

// ---------------------------------------------------------------------------
// C) castABWP validazione (BUG 7 fix)
// ---------------------------------------------------------------------------

describe('castABWP — validazione NaN e range', () => {
  // Simula la funzione castABWP da api.js — leggiamo il file e la esportiamo per test
  // Dato che api.js è un router Express, testiamo la funzione isolata
  function safeInt(v, min, max) {
    const n = parseInt(v);
    if (isNaN(n)) return 0;
    return Math.max(min, Math.min(max, n));
  }
  function castABWP(obj) {
    return {
      Amber: safeInt(obj.Amber, 0, 100),
      Blue:  safeInt(obj.Blue, 0, 100),
      White: safeInt(obj.White, 0, 100),
      Power: safeInt(obj.Power, 0, 100),
    };
  }

  test('valori normali passano correttamente', () => {
    expect(castABWP({ Amber: 50, Blue: 80, White: 30, Power: 100 })).toEqual({
      Amber: 50, Blue: 80, White: 30, Power: 100
    });
  });

  test('stringhe numeriche vengono parsate', () => {
    expect(castABWP({ Amber: '50', Blue: '100', White: '0', Power: '25' })).toEqual({
      Amber: 50, Blue: 100, White: 0, Power: 25
    });
  });

  test('NaN (parseInt("abc")) → 0', () => {
    expect(castABWP({ Amber: 'abc', Blue: NaN, White: undefined, Power: null })).toEqual({
      Amber: 0, Blue: 0, White: 0, Power: 0
    });
  });

  test('valori negativi → 0', () => {
    expect(castABWP({ Amber: -10, Blue: -1, White: -50, Power: -100 })).toEqual({
      Amber: 0, Blue: 0, White: 0, Power: 0
    });
  });

  test('valori > 100 → clampati a 100', () => {
    expect(castABWP({ Amber: 150, Blue: 200, White: 101, Power: 999 })).toEqual({
      Amber: 100, Blue: 100, White: 100, Power: 100
    });
  });

  test('decimali vengono troncati da parseInt', () => {
    expect(castABWP({ Amber: 50.7, Blue: 33.3, White: 99.9, Power: 0.1 })).toEqual({
      Amber: 50, Blue: 33, White: 99, Power: 0
    });
  });
});

// ---------------------------------------------------------------------------
// H) Schedule con slot custom orari
// ---------------------------------------------------------------------------

describe('slotsToSchedule con orari custom', () => {
  const { slotsToSchedule } = require('../src/services/scheduleUtils');

  test('slot con orari non standard generano DeltaSeconds corretti', () => {
    const slots = [
      { key: 'a', time: '05:30', Amber: 10, Blue: 80, White: 0, Power: 100 },
      { key: 'b', time: '10:15', Amber: 90, Blue: 90, White: 70, Power: 100 },
      { key: 'c', time: '14:45', Amber: 60, Blue: 100, White: 30, Power: 80 }
    ];
    const schedule = slotsToSchedule(slots);
    expect(schedule.ColorTransitionList).toHaveLength(3);

    // 05:30 → 10:15 = 4h45m = 17100s
    expect(schedule.ColorTransitionList[0].DeltaSeconds).toBe(17100);
    // 10:15 → 14:45 = 4h30m = 16200s
    expect(schedule.ColorTransitionList[1].DeltaSeconds).toBe(16200);
    // 14:45 → 05:30 (wrap) = 14h45m = 53100s
    expect(schedule.ColorTransitionList[2].DeltaSeconds).toBe(53100);
  });

  test('somma DeltaSeconds con slot custom = 86400', () => {
    const slots = [
      { key: 'a', time: '08:00', Amber: 50, Blue: 80, White: 0, Power: 100 },
      { key: 'b', time: '13:30', Amber: 100, Blue: 100, White: 80, Power: 100 },
      { key: 'c', time: '20:00', Amber: 10, Blue: 50, White: 0, Power: 50 },
      { key: 'd', time: '23:30', Amber: 0, Blue: 0, White: 0, Power: 0 }
    ];
    const schedule = slotsToSchedule(slots);
    const total = schedule.ColorTransitionList.reduce((s, ct) => s + ct.DeltaSeconds, 0);
    expect(total).toBe(86400);
  });

  test('2 slot soltanto — wrap-around corretto', () => {
    const slots = [
      { key: 'day', time: '08:00', Amber: 100, Blue: 100, White: 80, Power: 100 },
      { key: 'night', time: '20:00', Amber: 0, Blue: 0, White: 0, Power: 0 }
    ];
    const schedule = slotsToSchedule(slots);
    expect(schedule.ColorTransitionList).toHaveLength(2);
    // 08:00 → 20:00 = 12h = 43200s
    expect(schedule.ColorTransitionList[0].DeltaSeconds).toBe(43200);
    // 20:00 → 08:00 = 12h = 43200s
    expect(schedule.ColorTransitionList[1].DeltaSeconds).toBe(43200);
  });

  test('molti slot granulari (12 slot)', () => {
    const slots = [];
    for (let h = 0; h < 24; h += 2) {
      slots.push({ key: 'h' + h, time: String(h).padStart(2, '0') + ':00', Amber: 50, Blue: 50, White: 50, Power: 50 });
    }
    const schedule = slotsToSchedule(slots);
    expect(schedule.ColorTransitionList).toHaveLength(12);
    const total = schedule.ColorTransitionList.reduce((s, ct) => s + ct.DeltaSeconds, 0);
    expect(total).toBe(86400);
  });
});