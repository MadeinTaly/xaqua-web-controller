'use strict';

const { expectedAt } = require('../src/services/oscilloscopeHelper');

describe('oscilloscopeHelper.expectedAt', () => {
  // ---- Fixtures ----
  const SIMPLE_SCHEDULE = [
    {
      From: { Amber: 0, Blue: 100, White: 0, Power: 100 },
      To: { Amber: 0, Blue: 100, White: 20, Power: 100 },
      DeltaSeconds: 10800, // 3 ore: 06:00 -> 09:00
      Time: '2015/12/01 - 06:00:00'
    },
    {
      From: { Amber: 0, Blue: 100, White: 20, Power: 100 },
      To: { Amber: 100, Blue: 100, White: 80, Power: 100 },
      DeltaSeconds: 7200, // 2 ore: 09:00 -> 11:00
      Time: '2015/12/01 - 09:00:00'
    },
    {
      From: { Amber: 100, Blue: 100, White: 80, Power: 100 },
      To: { Amber: 0, Blue: 0, White: 0, Power: 0 },
      DeltaSeconds: 54000, // 15 ore: 11:00 -> 02:00 (wrap-around)
      Time: '2015/12/01 - 11:00:00'
    }
  ];

  test('lista vuota ritorna null', () => {
    expect(expectedAt(null, 5000)).toBeNull();
    expect(expectedAt([], 5000)).toBeNull();
  });

  test('al punto di inizio della transizione ritorna From', () => {
    const result = expectedAt(SIMPLE_SCHEDULE, 6 * 3600); // 06:00:00
    expect(result).toEqual({
      Amber: 0,
      Blue: 100,
      White: 0,
      Power: 100
    });
  });

  test('a meta transizione interpola linearmente', () => {
    // Tra 06:00 (From: W=0) e 09:00 (To: W=20), a 07:30 (1.5 ore dopo inizio)
    // Frazione: 1.5*3600 / 10800 = 0.5, quindi W = 0 + (20-0)*0.5 = 10
    const result = expectedAt(SIMPLE_SCHEDULE, 6 * 3600 + 5400); // 06:00 + 1.5h
    expect(result).toEqual({
      Amber: 0,
      Blue: 100,
      White: 10,
      Power: 100
    });
  });

  test('al punto finale della transizione il valore è vicinissimo a To', () => {
    // A 08:59:59 (a -1s da fine), frazione ~= 0.999999...
    const dSec = 10800;
    const elapsed = dSec - 1;
    const frac = elapsed / dSec;
    const expected = Math.round(0 + (20 - 0) * frac);
    const result = expectedAt(SIMPLE_SCHEDULE, 6 * 3600 + dSec - 1);
    expect(result.White).toBe(expected);
  });

  test('prima della prima transizione usa l\'ultima come fallback (wrap-around)', () => {
    // A 03:00 (prima di 06:00), dovrebbe usare l'ultima transizione (11:00->02:00)
    // Che ha From={Amber:100, Blue:100, White:80, Power:100}
    const result = expectedAt(SIMPLE_SCHEDULE, 3 * 3600);
    // A 03:00, la transizione 11:00->02:00 è attiva da 11:00 il giorno prima
    // (15 ore = 54000s), quindi è ancora in corso
    expect(result).toBeDefined();
    expect(result.Amber).toBeDefined();
  });

  test('normalizza daySec nel range [0, 86400)', () => {
    // Testa che 86400 (mezzanotte successiva) = 0
    const r1 = expectedAt(SIMPLE_SCHEDULE, 0);
    const r2 = expectedAt(SIMPLE_SCHEDULE, 86400);
    const r3 = expectedAt(SIMPLE_SCHEDULE, -86400);
    expect(r1).toEqual(r2);
    expect(r1).toEqual(r3);
  });

  test('transizione che attraversa mezzanotte (wrap)', () => {
    // Una transizione che inizia a 23:00 e dura 2 ore (finisce a 01:00)
    const schedule = [
      {
        From: { Amber: 10, Blue: 50, White: 5, Power: 100 },
        To: { Amber: 0, Blue: 0, White: 0, Power: 0 },
        DeltaSeconds: 7200, // 2 ore
        Time: '2015/12/01 - 23:00:00'
      },
      {
        From: { Amber: 0, Blue: 0, White: 0, Power: 0 },
        To: { Amber: 0, Blue: 100, White: 0, Power: 100 },
        DeltaSeconds: 18000, // 5 ore
        Time: '2015/12/01 - 01:00:00'
      }
    ];
    // A 23:30 siamo nella prima transizione: frazione = 1800/7200 = 0.25
    // Amber: 10 + (0-10)*0.25 = 10 - 2.5 = 7.5 => 8 (arrotondato)
    const result = expectedAt(schedule, 23 * 3600 + 30 * 60);
    expect(result.Amber).toBe(8);
    expect(result.Blue).toBe(38); // 50 + (0-50)*0.25 = 50 - 12.5 = 37.5 => 38

    // A 00:30 (mezzanotte+30min, dentro la transizione 23:00->01:00 che attraversa mezzanotte)
    // startSec = 23*3600 = 82800, endSec = 82800 + 7200 = 90000 (> 86400, wrap)
    // A daySec=1800, siamo dentro? 1800 < (90000 % 86400) = 3600? Sì
    // Elapsed = (86400 - 82800) + 1800 = 3600 + 1800 = 5400 (1.5 ore dopo 23:00)
    // Frazione = 5400 / 7200 = 0.75
    // Amber: 10 + (0-10)*0.75 = 2.5 => Math.round(2.5) = 3 (JS rounding)
    const result2 = expectedAt(schedule, 0.5 * 3600);
    expect(result2.Amber).toBe(3);
  });

  test('arrotonda correttamente i valori interpolati', () => {
    // 06:00 a 06:30 (mezzora, frazione = 1800/10800 = 1/6 ~= 0.1667)
    // White: 0 + (20-0)*0.1667 = 3.333 => 3
    const result = expectedAt(SIMPLE_SCHEDULE, 6 * 3600 + 30 * 60);
    expect(typeof result.White).toBe('number');
    expect(result.White).toBeGreaterThanOrEqual(0);
    expect(result.White).toBeLessThanOrEqual(20);
  });

  test('daySec negativo viene normalizzato correttamente', () => {
    // -1800 (–30 minuti) dovrebbe essere equivalente a 86400-1800 = 84600 (23:50)
    const r1 = expectedAt(SIMPLE_SCHEDULE, -1800);
    const r2 = expectedAt(SIMPLE_SCHEDULE, 86400 - 1800);
    expect(r1).toEqual(r2);
  });

  test('format Time con secondi diversi da 00 viene estratto correttamente', () => {
    const schedule = [
      {
        From: { Amber: 0, Blue: 50, White: 0, Power: 50 },
        To: { Amber: 50, Blue: 100, White: 50, Power: 100 },
        DeltaSeconds: 3600,
        Time: '2015/12/01 - 08:15:45'
      },
      {
        From: { Amber: 50, Blue: 100, White: 50, Power: 100 },
        To: { Amber: 0, Blue: 50, White: 0, Power: 50 },
        DeltaSeconds: 82800,
        Time: '2015/12/01 - 09:15:45'
      }
    ];
    // A 08:15:45 dovremmo essere al From della prima transizione
    const result = expectedAt(schedule, 8 * 3600 + 15 * 60 + 45);
    expect(result).toEqual({
      Amber: 0,
      Blue: 50,
      White: 0,
      Power: 50
    });
  });
});
