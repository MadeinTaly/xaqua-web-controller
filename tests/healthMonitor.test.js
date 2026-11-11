'use strict';

const { pushSample, evalThermalState } = require('../src/services/healthMonitor');

describe('healthMonitor - pushSample', () => {
  test('aggiunge un campione valido al ring buffer', () => {
    const state = [];
    const sample = { at: Date.now(), tempC: 42.5, fan: 3200 };
    pushSample(state, sample);
    expect(state.length).toBe(1);
    expect(state[0].tempC).toBe(42.5);
    expect(state[0].fan).toBe(3200);
  });

  test('rifiuta campioni con tempC non numero', () => {
    const state = [];
    pushSample(state, { at: Date.now(), tempC: 'invalid', fan: 3200 });
    expect(state.length).toBe(0);
  });

  test('rifiuta campioni con fan non numero', () => {
    const state = [];
    pushSample(state, { at: Date.now(), tempC: 42.5, fan: null });
    expect(state.length).toBe(0);
  });

  test('rifiuta null/undefined', () => {
    const state = [];
    pushSample(state, null);
    expect(state.length).toBe(0);
    pushSample(state, undefined);
    expect(state.length).toBe(0);
  });

  test('mantiene i campioni in ordine FIFO e limita a MAX_SAMPLES', () => {
    const state = [];
    const MAX = 432;

    // Aggiungi MAX+10 campioni
    for (let i = 0; i < MAX + 10; i++) {
      pushSample(state, {
        at: Date.now() + i * 1000,
        tempC: 40 + i * 0.1,
        fan: 3000 + i * 10
      });
    }

    expect(state.length).toBe(MAX);
    // I campioni iniziali (i=0..9) dovrebbero essere stati shiftati
    // I campioni rimasti dovrebbero essere i=10..441
    expect(state[0].tempC).toBeCloseTo(41, 0);
    expect(state[MAX - 1].tempC).toBeCloseTo(40 + 441 * 0.1, 0);
  });

  test('preserva timestamp e dati nei campioni', () => {
    const state = [];
    const now = Date.now();
    const sample = { at: now, tempC: 45.67, fan: 2500 };
    pushSample(state, sample);

    expect(state[0].at).toBe(now);
    expect(state[0].tempC).toBe(45.67);
    expect(state[0].fan).toBe(2500);
  });

  test('aggiunge timestamp automatico se non fornito', () => {
    const state = [];
    const before = Date.now();
    pushSample(state, { tempC: 42, fan: 3000 });
    const after = Date.now();

    expect(state.length).toBe(1);
    expect(state[0].at).toBeGreaterThanOrEqual(before);
    expect(state[0].at).toBeLessThanOrEqual(after);
  });

  test('gestisce campioni multipli in sequenza', () => {
    const state = [];
    for (let i = 0; i < 5; i++) {
      pushSample(state, { at: Date.now() + i * 100, tempC: 40 + i, fan: 3000 + i * 100 });
    }
    expect(state.length).toBe(5);
    expect(state[0].tempC).toBe(40);
    expect(state[4].tempC).toBe(44);
  });
});

describe('healthMonitor - evalThermalState (protezione termica)', () => {
  const freshState = () => ({ warnCount: 0, alertState: false, protection: { active: false, since: null, lockout: false }, cycleTimes: [] });
  const H = 60 * 60 * 1000;

  test('temperatura normale: nessuna azione', () => {
    const st = freshState();
    expect(evalThermalState(st, 42, 0)).toBe('none');
    expect(st.protection.active).toBe(false);
  });

  test('warn dopo 2 valutazioni sopra 55, una sola non basta', () => {
    const st = freshState();
    expect(evalThermalState(st, 56, 0)).toBe('none');
    expect(evalThermalState(st, 57, 1)).toBe('warn');
    expect(st.alertState).toBe(true);
    // rientro sotto 55 → warn-clear
    expect(evalThermalState(st, 50, 2)).toBe('warn-clear');
    expect(st.alertState).toBe(false);
  });

  test('sopra 65: protezione immediata (1 sola rilevazione)', () => {
    const st = freshState();
    expect(evalThermalState(st, 66, 1000)).toBe('protect');
    expect(st.protection.active).toBe(true);
    expect(st.cycleTimes.length).toBe(1);
  });

  test('in protezione: resta spenta finché >= 45, restore sotto 45 (isteresi)', () => {
    const st = freshState();
    evalThermalState(st, 70, 0);
    expect(evalThermalState(st, 55, 1)).toBe('none');   // sceso ma non abbastanza
    expect(evalThermalState(st, 46, 2)).toBe('none');   // ancora sopra isteresi
    expect(evalThermalState(st, 44, 3)).toBe('restore');
    expect(st.protection.active).toBe(false);
  });

  test('lockout al 3° ciclo in 24h, poi nessun restore', () => {
    const st = freshState();
    expect(evalThermalState(st, 70, 0)).toBe('protect');       // ciclo 1
    evalThermalState(st, 40, 1 * H);                            // restore
    expect(evalThermalState(st, 70, 2 * H)).toBe('protect');   // ciclo 2
    evalThermalState(st, 40, 3 * H);                            // restore
    expect(evalThermalState(st, 70, 4 * H)).toBe('lockout');   // ciclo 3 → lockout
    expect(st.protection.lockout).toBe(true);
    // anche freddissima: resta spenta
    expect(evalThermalState(st, 30, 5 * H)).toBe('none');
    expect(evalThermalState(st, 70, 6 * H)).toBe('none');
  });

  test('finestra 24h: cicli vecchi non contano per il lockout', () => {
    const st = freshState();
    evalThermalState(st, 70, 0);            // ciclo 1
    evalThermalState(st, 40, 1 * H);
    evalThermalState(st, 70, 2 * H);        // ciclo 2
    evalThermalState(st, 40, 3 * H);
    // il 3° ciclo arriva DOPO 25h dal primo: il primo è fuori finestra → protect, non lockout
    expect(evalThermalState(st, 70, 26 * H)).toBe('protect');
    expect(st.protection.lockout).toBe(false);
  });
});
