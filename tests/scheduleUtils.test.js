'use strict';

const { slotsToSchedule } = require('../src/services/scheduleUtils');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FULL_SLOTS = [
  { key: 'sunrise',   time: '06:00', Amber:   0, Blue: 100, White:  0, Power: 100 },
  { key: 'morning',   time: '09:00', Amber:   0, Blue: 100, White: 20, Power: 100 },
  { key: 'day',       time: '11:00', Amber: 100, Blue: 100, White: 80, Power: 100 },
  { key: 'afternoon', time: '18:00', Amber:  50, Blue: 100, White: 20, Power: 100 },
  { key: 'sunset',    time: '19:00', Amber:  10, Blue:  50, White:  5, Power: 100 },
  { key: 'evening',   time: '20:00', Amber:  10, Blue:  50, White:  0, Power:  50 },
  { key: 'night',     time: '22:00', Amber:   0, Blue:   0, White:  0, Power:   1 },
  { key: 'latenight', time: '02:00', Amber:   0, Blue:   0, White:  0, Power:   0 },
];

// ---------------------------------------------------------------------------
// slotsToSchedule
// ---------------------------------------------------------------------------

describe('slotsToSchedule', () => {
  test('ordina gli slot cronologicamente anche se latenight (02:00) arriva prima in input', () => {
    const shuffled = [...FULL_SLOTS].reverse(); // latenight diventa il primo
    const { ColorTransitionList } = slotsToSchedule(shuffled);
    // Il primo step deve essere latenight (02:00), poi sunrise (06:00), ...
    expect(ColorTransitionList[0].Time).toContain('02:00');
    expect(ColorTransitionList[1].Time).toContain('06:00');
  });

  test('calcola DeltaSeconds corretto tra slot consecutivi', () => {
    const { ColorTransitionList } = slotsToSchedule(FULL_SLOTS);
    // sunrise(06:00) -> morning(09:00) = 3h = 10800s
    const sunriseStep = ColorTransitionList.find(ct => ct.Time.includes('06:00'));
    expect(sunriseStep.DeltaSeconds).toBe(10800);
    // day(11:00) -> afternoon(18:00) = 7h = 25200s
    const dayStep = ColorTransitionList.find(ct => ct.Time.includes('11:00'));
    expect(dayStep.DeltaSeconds).toBe(25200);
  });

  test('calcola DeltaSeconds corretto per lultimo slot con wrap-around (22:00 -> 02:00 = 4h)', () => {
    const { ColorTransitionList } = slotsToSchedule(FULL_SLOTS);
    const nightStep = ColorTransitionList.find(ct => ct.Time.includes('22:00'));
    expect(nightStep.DeltaSeconds).toBe(4 * 3600); // 4 ore = 14400s
  });

  test('calcola DeltaSeconds corretto per latenight -> sunrise (02:00 -> 06:00 = 4h)', () => {
    const { ColorTransitionList } = slotsToSchedule(FULL_SLOTS);
    const latenightStep = ColorTransitionList.find(ct => ct.Time.includes('02:00'));
    expect(latenightStep.DeltaSeconds).toBe(4 * 3600);
  });

  test('Steps corrisponde al numero di transizioni', () => {
    const result = slotsToSchedule(FULL_SLOTS);
    expect(result.Steps).toBe(FULL_SLOTS.length);
    expect(result.ColorTransitionList).toHaveLength(FULL_SLOTS.length);
  });

  test('restituisce lista vuota per slot vuoti', () => {
    const result = slotsToSchedule([]);
    expect(result.Steps).toBe(0);
    expect(result.ColorTransitionList).toHaveLength(0);
  });

  test('From contiene i valori corretti del slot corrente', () => {
    const { ColorTransitionList } = slotsToSchedule(FULL_SLOTS);
    const dayStep = ColorTransitionList.find(ct => ct.Time.includes('11:00'));
    expect(dayStep.From).toEqual({ Amber: 100, Blue: 100, White: 80, Power: 100 });
  });

  test('To contiene i valori del prossimo slot', () => {
    const { ColorTransitionList } = slotsToSchedule(FULL_SLOTS);
    const dayStep = ColorTransitionList.find(ct => ct.Time.includes('11:00'));
    // day -> afternoon
    expect(dayStep.To).toEqual({ Amber: 50, Blue: 100, White: 20, Power: 100 });
  });
});

// ---------------------------------------------------------------------------
// bandForTime
// ---------------------------------------------------------------------------

describe('bandForTime', () => {
  const { bandForTime } = require('../src/services/scheduleUtils');

  test('mappa 06:00 a sunrise', () => {
    expect(bandForTime('06:00')).toBe('sunrise');
  });

  test('mappa 07:30 a sunrise', () => {
    expect(bandForTime('07:30')).toBe('sunrise');
  });

  test('mappa 09:00 a sunrise e 10:00 a morning (preset app originale)', () => {
    expect(bandForTime('09:00')).toBe('sunrise');
    expect(bandForTime('10:00')).toBe('morning');
  });

  test('mappa 11:00 a day', () => {
    expect(bandForTime('11:00')).toBe('day');
  });

  test('mappa 18:00 a afternoon', () => {
    expect(bandForTime('18:00')).toBe('afternoon');
  });

  test('mappa 19:00 a sunset', () => {
    expect(bandForTime('19:00')).toBe('sunset');
  });

  test('mappa 20:00 a evening', () => {
    expect(bandForTime('20:00')).toBe('evening');
  });

  test('mappa 22:00 a night', () => {
    expect(bandForTime('22:00')).toBe('night');
  });

  test('mappa 02:00 a latenight', () => {
    expect(bandForTime('02:00')).toBe('latenight');
  });

  test('mappa 00:00 (midnight) a night', () => {
    expect(bandForTime('00:00')).toBe('night');
  });

  test('mappa 04:59 a latenight', () => {
    expect(bandForTime('04:59')).toBe('latenight');
  });

  test('ritorna null per input invalido', () => {
    expect(bandForTime('25:00')).toBeNull();
    expect(bandForTime('invalid')).toBeNull();
    expect(bandForTime(null)).toBeNull();
    expect(bandForTime(undefined)).toBeNull();
  });
});

describe('scheduleUtils — tzOffsetMinutes (fuso IANA)', () => {
  const { tzOffsetMinutes } = require('../src/services/scheduleUtils');
  test('Roma: +120 in ora legale, +60 in ora solare (cambio 25/10/2026)', () => {
    expect(tzOffsetMinutes('Europe/Rome', new Date('2026-09-18T12:00:00Z'))).toBe(120);
    expect(tzOffsetMinutes('Europe/Rome', new Date('2026-10-25T00:59:59Z'))).toBe(120);
    expect(tzOffsetMinutes('Europe/Rome', new Date('2026-10-25T01:00:00Z'))).toBe(60);
  });
  test('offset negativi e mezz\'ora', () => {
    expect(tzOffsetMinutes('America/New_York', new Date('2026-01-15T12:00:00Z'))).toBe(-300);
    expect(tzOffsetMinutes('Asia/Kolkata', new Date('2026-01-15T12:00:00Z'))).toBe(330);
  });
  test('fuso inesistente → RangeError', () => {
    expect(() => tzOffsetMinutes('Marte/Olympus')).toThrow(RangeError);
  });
});
