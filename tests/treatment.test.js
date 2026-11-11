'use strict';

/**
 * Test per i cicli di trattamento (dinoflagellati e cianobatteri).
 * Valida treatmentFactor, treatmentSummary e la logica delle fasi.
 */

const experimental = require('../src/services/experimental');

describe('Treatment: Dinoflagellati e Cianobatteri', () => {
  describe('treatmentFactor', () => {
    test('giorno 1-3 (blackout): fattore = 0', () => {
      const tr = { active: true, type: 'cyano', startDate: '2026-07-02' };
      const d1 = new Date('2026-07-02');
      const d2 = new Date('2026-07-03');
      const d3 = new Date('2026-07-04');
      expect(experimental.treatmentFactor(tr, d1)).toBe(0);
      expect(experimental.treatmentFactor(tr, d2)).toBe(0);
      expect(experimental.treatmentFactor(tr, d3)).toBe(0);
    });

    test('cyano: giorno 4 (primo recovery): fattore = 0 (recoveryStartPct 0%)', () => {
      const tr = { active: true, type: 'cyano', startDate: '2026-07-02' };
      const d4 = new Date('2026-07-05');
      expect(experimental.treatmentFactor(tr, d4)).toBe(0);
    });

    test('cyano: giorno 5-7 (recovery in corso): fattore cresce linearmente da 0 a 1', () => {
      const tr = { active: true, type: 'cyano', startDate: '2026-07-02' };
      const d5 = new Date('2026-07-06');
      const d6 = new Date('2026-07-07');
      const d7 = new Date('2026-07-08');
      const f5 = experimental.treatmentFactor(tr, d5);
      const f6 = experimental.treatmentFactor(tr, d6);
      const f7 = experimental.treatmentFactor(tr, d7);
      expect(f5).toBeGreaterThan(0);
      expect(f5).toBeLessThan(f6);
      expect(f6).toBeLessThan(f7);
      expect(f7).toBeCloseTo(1, 1);
    });

    test('cyano: giorno 8+ (dopo ciclo): fattore = 1', () => {
      const tr = { active: true, type: 'cyano', startDate: '2026-07-02' };
      const d8 = new Date('2026-07-09');
      const d10 = new Date('2026-07-11');
      expect(experimental.treatmentFactor(tr, d8)).toBeCloseTo(1, 1);
      expect(experimental.treatmentFactor(tr, d10)).toBeCloseTo(1, 1);
    });

    test('dino: giorno 1-3 (blackout): fattore = 0', () => {
      const tr = { active: true, type: 'dino', startDate: '2026-07-02' };
      const d1 = new Date('2026-07-02');
      const d3 = new Date('2026-07-04');
      expect(experimental.treatmentFactor(tr, d1)).toBe(0);
      expect(experimental.treatmentFactor(tr, d3)).toBe(0);
    });

    test('dino: giorno 4 (primo recovery): fattore = 0.5 (recoveryStartPct 50%)', () => {
      const tr = { active: true, type: 'dino', startDate: '2026-07-02' };
      const d4 = new Date('2026-07-05');
      expect(experimental.treatmentFactor(tr, d4)).toBeCloseTo(0.5, 1);
    });

    test('dino: giorno 5-10 (recovery): fattore cresce da 0.5 a 1 su 7 giorni', () => {
      const tr = { active: true, type: 'dino', startDate: '2026-07-02' };
      const d4 = new Date('2026-07-05');
      const d10 = new Date('2026-07-11');
      const f4 = experimental.treatmentFactor(tr, d4);
      const f10 = experimental.treatmentFactor(tr, d10);
      expect(f4).toBeCloseTo(0.5, 1);
      expect(f10).toBeCloseTo(1, 1);
    });

    test('dino: giorno 11+ (dopo ciclo): fattore = 1', () => {
      const tr = { active: true, type: 'dino', startDate: '2026-07-02' };
      const d11 = new Date('2026-07-12');
      const d15 = new Date('2026-07-16');
      expect(experimental.treatmentFactor(tr, d11)).toBeCloseTo(1, 1);
      expect(experimental.treatmentFactor(tr, d15)).toBeCloseTo(1, 1);
    });

    test('inattivo o null: fattore sempre 1', () => {
      const trInactive = { active: false, type: 'cyano', startDate: '2026-07-02' };
      const trNull = null;
      const d = new Date('2026-07-05');
      expect(experimental.treatmentFactor(trInactive, d)).toBe(1);
      expect(experimental.treatmentFactor(trNull, d)).toBe(1);
    });
  });

  describe('treatmentSummary', () => {
    test('fase blackout (giorni 1-3 cyano)', () => {
      const tr = { active: true, type: 'cyano', startDate: '2026-07-02' };
      const d1 = new Date('2026-07-02');
      const d3 = new Date('2026-07-04');
      const s1 = experimental.treatmentSummary(tr, d1);
      const s3 = experimental.treatmentSummary(tr, d3);
      expect(s1.phase).toBe('blackout');
      expect(s3.phase).toBe('blackout');
      expect(s1.factorPct).toBe(0);
      expect(s3.factorPct).toBe(0);
    });

    test('fase recovery (giorni 4-7 cyano)', () => {
      const tr = { active: true, type: 'cyano', startDate: '2026-07-02' };
      const d5 = new Date('2026-07-06');
      const s5 = experimental.treatmentSummary(tr, d5);
      expect(s5.phase).toBe('recovery');
      expect(s5.factorPct).toBeGreaterThan(0);
      expect(s5.factorPct).toBeLessThan(100);
    });

    test('fase done (giorno 8+)', () => {
      const tr = { active: true, type: 'cyano', startDate: '2026-07-02' };
      const d8 = new Date('2026-07-09');
      const s8 = experimental.treatmentSummary(tr, d8);
      expect(s8.phase).toBe('done');
      expect(s8.factorPct).toBeCloseTo(100, 0);
    });

    test('include type, startDate, currentDay, totalDays', () => {
      const tr = { active: true, type: 'dino', startDate: '2026-07-02' };
      const d = new Date('2026-07-05');
      const s = experimental.treatmentSummary(tr, d);
      expect(s.type).toBe('dino');
      expect(s.startDate).toBe('2026-07-02');
      expect(s.currentDay).toBe(4);
      expect(s.totalDays).toBe(10);
    });

    test('null per type non valido', () => {
      const tr = { active: true, type: 'invalid', startDate: '2026-07-02' };
      const s = experimental.treatmentSummary(tr, new Date());
      expect(s).toBeNull();
    });
  });

  describe('Precedenza treatment > acclimation', () => {
    test('scalePower(list, 0) azzera il Power (luce spenta)', () => {
      const list = [
        { From: { Power: 100 }, To: { Power: 100 } },
        { From: { Power: 50 }, To: { Power: 75 } }
      ];
      experimental.scalePower(list, 0);
      expect(list[0].From.Power).toBe(0);
      expect(list[0].To.Power).toBe(0);
      expect(list[1].From.Power).toBe(0);
      expect(list[1].To.Power).toBe(0);
    });

    test('scalePower(list, 1) preserva Power', () => {
      const list = [
        { From: { Power: 100 }, To: { Power: 100 } },
        { From: { Power: 50 }, To: { Power: 75 } }
      ];
      experimental.scalePower(list, 1);
      expect(list[0].From.Power).toBe(100);
      expect(list[0].To.Power).toBe(100);
      expect(list[1].From.Power).toBe(50);
      expect(list[1].To.Power).toBe(75);
    });

    test('scalePower(list, 0.5) scala a metà', () => {
      const list = [
        { From: { Power: 100 }, To: { Power: 100 } },
        { From: { Power: 80 }, To: { Power: 60 } }
      ];
      experimental.scalePower(list, 0.5);
      expect(list[0].From.Power).toBe(50);
      expect(list[0].To.Power).toBe(50);
      expect(list[1].From.Power).toBe(40);
      expect(list[1].To.Power).toBe(30);
    });
  });

  describe('Fotoperiodo ridotto durante recovery (T1)', () => {
    test('adjustPhotoperiod ritorna copia della selection originale', () => {
      const selection = [
        { fascia: 'alba', modelId: 'sereno', time: '07:30' },
        { fascia: 'mattina', modelId: 'sereno', time: '09:00' },
        { fascia: 'picco', modelId: 'sereno', time: '12:30' },
        { fascia: 'notte', modelId: 'novilunio', time: '22:00' }
      ];
      const treatment = { active: true, type: 'cyano', startDate: '2026-07-02' };
      const d4 = new Date('2026-07-05'); // giorno 4 = primo recovery per cyano
      const adjusted = experimental.adjustPhotoperiod(selection, treatment, d4);
      // La selezione originale non è mutata
      expect(selection[0].time).toBe('07:30');
      expect(selection[selection.length - 1].time).toBe('22:00');
      // adjusted è diverso
      expect(adjusted).not.toBe(selection);
      expect(adjusted.length).toBeGreaterThan(0);
    });

    test('photoperiodCutAtDay: cyano giorno 4 = 2 ore taglio', () => {
      const tr = { active: true, type: 'cyano', startDate: '2026-07-02' };
      const d4 = new Date('2026-07-05');
      expect(experimental.photoperiodCutAtDay(tr, d4)).toBe(2);
    });

    test('photoperiodCutAtDay: cyano giorno 7 = 0 ore taglio (fine recovery)', () => {
      const tr = { active: true, type: 'cyano', startDate: '2026-07-02' };
      const d7 = new Date('2026-07-08');
      expect(experimental.photoperiodCutAtDay(tr, d7)).toBe(0);
    });

    test('photoperiodCutAtDay: cyano giorno 5-6 = taglio lineare decrescente', () => {
      const tr = { active: true, type: 'cyano', startDate: '2026-07-02' };
      const d5 = new Date('2026-07-06');
      const d6 = new Date('2026-07-07');
      const cut5 = experimental.photoperiodCutAtDay(tr, d5);
      const cut6 = experimental.photoperiodCutAtDay(tr, d6);
      expect(cut5).toBeGreaterThan(0);
      expect(cut5).toBeLessThan(2);
      expect(cut6).toBeGreaterThan(0);
      expect(cut6).toBeLessThan(cut5);
    });

    test('photoperiodCutAtDay: dino giorno 4 = 4 ore taglio', () => {
      const tr = { active: true, type: 'dino', startDate: '2026-07-02' };
      const d4 = new Date('2026-07-05');
      expect(experimental.photoperiodCutAtDay(tr, d4)).toBe(4);
    });

    test('adjustPhotoperiod: conserva l\'ordine e non crea duplicati', () => {
      const selection = [
        { fascia: 'alba', modelId: 'sereno', time: '07:30' },
        { fascia: 'mattina', modelId: 'sereno', time: '09:00' },
        { fascia: 'picco', modelId: 'sereno', time: '12:30' },
        { fascia: 'pomeriggio', modelId: 'sereno', time: '16:30' },
        { fascia: 'tramonto', modelId: 'sereno', time: '19:00' },
        { fascia: 'notte', modelId: 'novilunio', time: '22:00' }
      ];
      const treatment = { active: true, type: 'cyano', startDate: '2026-07-02' };
      const d4 = new Date('2026-07-05');
      const adjusted = experimental.adjustPhotoperiod(selection, treatment, d4);

      // Check orari ordinati
      for (let i = 1; i < adjusted.length; i++) {
        const prevMin = parseInt(adjusted[i - 1].time.split(':')[0]) * 60 + parseInt(adjusted[i - 1].time.split(':')[1]);
        const currMin = parseInt(adjusted[i].time.split(':')[0]) * 60 + parseInt(adjusted[i].time.split(':')[1]);
        expect(currMin).toBeGreaterThan(prevMin);
      }

      // Nessun orario duplicato
      const times = new Set(adjusted.map(s => s.time));
      expect(times.size).toBe(adjusted.length);
    });

    test('adjustPhotoperiod con cut=0 ritorna la selection invariata', () => {
      const selection = [
        { fascia: 'alba', modelId: 'sereno', time: '07:30' },
        { fascia: 'notte', modelId: 'novilunio', time: '22:00' }
      ];
      const treatment = { active: true, type: 'cyano', startDate: '2026-07-02' };
      const d8 = new Date('2026-07-09'); // giorno 8 = dopo recovery, cut = 0
      const adjusted = experimental.adjustPhotoperiod(selection, treatment, d8);

      expect(adjusted.length).toBe(selection.length);
      adjusted.forEach((s, i) => {
        expect(s.time).toBe(selection[i].time);
      });
    });
  });
});

describe('composeForToday', () => {
  const { defaultSelection, composeSchedule } = require('../src/services/slotModels');
  const sel = defaultSelection();
  const now = new Date(2026, 6, 10, 12);
  const maxPower = (sch) => Math.max(...sch.ColorTransitionList.map(ct => ct.From.Power));
  const base = composeSchedule(sel, 'SemiDeep');

  test('nessun ciclo attivo = composeSchedule', () => {
    expect(experimental.composeForToday(sel, 'SemiDeep', {}, now)).toEqual(base);
  });

  test('acclimatazione scala il Power', () => {
    const acc = { active: true, weeks: 4, startPct: 50, startDate: experimental.startDateForDay(1, now) };
    expect(maxPower(experimental.composeForToday(sel, 'SemiDeep', { acclimation: acc }, now)))
      .toBe(Math.round(maxPower(base) * 0.5));
  });

  test('trattamento sovrascrive acclimatazione: blackout = Power 0, orari invariati', () => {
    const acc = { active: true, weeks: 4, startPct: 50, startDate: experimental.startDateForDay(1, now) };
    const tr = { active: true, type: 'cyano', startDate: experimental.startDateForDay(1, now) };
    const sch = experimental.composeForToday(sel, 'SemiDeep', { acclimation: acc, treatment: tr }, now);
    expect(maxPower(sch)).toBe(0);
    expect(sch.ColorTransitionList.map(c => c.Time)).toEqual(base.ColorTransitionList.map(c => c.Time));
  });

  test('recovery: fotoperiodo ridotto', () => {
    const tr = { active: true, type: 'dino', startDate: experimental.startDateForDay(4, now) };
    const sch = experimental.composeForToday(sel, 'SemiDeep', { treatment: tr }, now);
    expect(sch.ColorTransitionList.map(c => c.Time)).not.toEqual(base.ColorTransitionList.map(c => c.Time));
  });
});
