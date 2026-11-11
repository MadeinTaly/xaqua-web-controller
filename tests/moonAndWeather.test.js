'use strict';

/**
 * Test per il nuovo moonHelper (algoritmo sinodico) e fix drizzle.
 * Usa date lunari note per il 2026 come riferimento.
 *
 * Lune nuove 2026 (UTC): Gen 11, Feb 10, Mar 11, Apr 10, Mag 9, Giu 8
 * Lune piene (circa +14.76 giorni): Gen 26, Feb 24, Mar 26, Apr 25, Mag 24, Giu 22
 */

const { calculateMoonAge, calculateMoonPhase, moonPhaseToWeatherColumn } = require('../src/services/moonHelper');
const { weatherCodeToCondition } = require('../src/services/weatherService');

// ---------------------------------------------------------------------------
// Algoritmo sinodico — moon age
// ---------------------------------------------------------------------------

describe('calculateMoonAge (sinodic algorithm)', () => {
  test('fase novilunio in corrispondenza di luna nuova (10 Apr 2026)', () => {
    const age = calculateMoonAge(new Date('2026-04-10T12:00:00Z'));
    // Età può essere ~0 o ~29 (entrambe novilunio)
    expect(age < 1.5 || age >= 29).toBe(true);
  });

  test('fase novilunio per luna nuova (11 Gen 2026) — algoritmo continuo', () => {
    // 11 Gen 2026 è ~89 giorni PRIMA del riferimento (Apr 10 2026)
    // L'età può essere ~29 (quasi novilunio) o ~0 — entrambe mappano a novilunio
    const phase = calculateMoonPhase(new Date('2026-01-11T12:00:00Z'));
    expect(phase).toBe('novilunio');
  });

  test('età ~7.4 al primo quarto (circa 7 giorni dopo luna nuova)', () => {
    // 7 giorni dopo il 10 Apr → 17 Apr
    const age = calculateMoonAge(new Date('2026-04-17T12:00:00Z'));
    expect(age).toBeGreaterThan(5);
    expect(age).toBeLessThan(10);
  });

  test('età ~14.8 alla luna piena (circa 15 giorni dopo luna nuova)', () => {
    // ~15 giorni dopo il 10 Apr → 25 Apr
    const age = calculateMoonAge(new Date('2026-04-25T12:00:00Z'));
    expect(age).toBeGreaterThan(13);
    expect(age).toBeLessThan(17);
  });

  test('età ~22.1 all\'ultimo quarto (circa 22 giorni dopo luna nuova)', () => {
    // 22 giorni dopo il 10 Apr → 2 Mag
    const age = calculateMoonAge(new Date('2026-05-02T12:00:00Z'));
    expect(age).toBeGreaterThan(20);
    expect(age).toBeLessThan(24);
  });

  test('ciclo completo: età torna a ~0 dopo 29.53 giorni', () => {
    // Data 15 giorni dopo la luna nuova (11 Gen)
    const date1 = new Date('2026-01-26T12:00:00Z'); // ~luna piena
    const age1 = calculateMoonAge(date1);

    // Data 15 giorni dopo la luna nuova successiva (10 Feb)
    const date2 = new Date('2026-02-25T12:00:00Z'); // ~prossima luna piena
    const age2 = calculateMoonAge(date2);

    // Entrbe le date dovrebbero avere un'età simile (~15 giorni)
    expect(age1).toBeGreaterThan(10);
    expect(age1).toBeLessThan(20);
    expect(age2).toBeGreaterThan(10);
    expect(age2).toBeLessThan(20);

    // La differenza dovrebbe essere piccola (stessa fase lunare)
    const diff = Math.abs(age2 - age1);
    expect(diff).toBeLessThan(5);
  });

  test('età è sempre tra 0 e 30', () => {
    const dates = [
      new Date('2026-01-11'), // Luna nuova
      new Date('2026-04-10'), // Luna nuova
      new Date('2026-05-09'), // Luna nuova
      new Date('2026-03-15')  // Data nel mezzo
    ];
    dates.forEach(d => {
      const age = calculateMoonAge(d);
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThan(30);
    });
  });
});

// ---------------------------------------------------------------------------
// Moon phase → weather column (illumination-based)
// ---------------------------------------------------------------------------

describe('moonPhaseToWeatherColumn (illumination-based)', () => {
  test('luna nuova → moonless', () => {
    // Apr 10, 2026 = luna nuova
    const phase = calculateMoonPhase(new Date('2026-04-10T12:00:00Z'));
    const col = moonPhaseToWeatherColumn(phase);
    expect(col).toBe('moonless');
  });

  test('luna piena → full', () => {
    // Apr 25, 2026 ≈ luna piena
    const phase = calculateMoonPhase(new Date('2026-04-25T12:00:00Z'));
    const col = moonPhaseToWeatherColumn(phase);
    expect(col).toBe('full');
  });

  test('primo quarto → half (illuminazione ~50%)', () => {
    // 7 giorni dopo luna nuova Apr 10 → Apr 17
    const phase = calculateMoonPhase(new Date('2026-04-17T12:00:00Z'));
    const col = moonPhaseToWeatherColumn(phase);
    // Al primo quarto l\'illuminazione è ~50%, dovrebbe mappare a half o crescent
    expect(['crescent', 'half']).toContain(col);
  });

  test('gibbosa calante → full o half (non crescent/moonless)', () => {
    // 18 giorni dopo luna nuova → gibbosa calante, ancora molta luce
    const phase = calculateMoonPhase(new Date('2026-04-28T12:00:00Z'));
    const col = moonPhaseToWeatherColumn(phase);
    // La gibbosa calante ha illuminazione > 50%, non dovrebbe essere crescent o moonless
    expect(['full', 'half']).toContain(col);
  });
});

// ---------------------------------------------------------------------------
// Fix drizzle: 300-321 → rainy
// ---------------------------------------------------------------------------

describe('weatherCodeToCondition — drizzle fix', () => {
  test('drizzle (300) → rainy', () => {
    expect(weatherCodeToCondition(300)).toBe('rainy');
  });

  test('drizzle (310) → rainy', () => {
    expect(weatherCodeToCondition(310)).toBe('rainy');
  });

  test('drizzle (321) → rainy', () => {
    expect(weatherCodeToCondition(321)).toBe('rainy');
  });

  test('clear (800) rimane clear', () => {
    expect(weatherCodeToCondition(800)).toBe('clear');
  });

  test('clouds (802) rimane cloudy', () => {
    expect(weatherCodeToCondition(802)).toBe('cloudy');
  });
});
