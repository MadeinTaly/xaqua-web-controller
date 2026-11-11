'use strict';

const {
  FASCE, ASSETS, PRESETS,
  resolveColor, composeSchedule, defaultSelection, normalizeSelection, assetById, generateTropicalDay
} = require('../src/services/slotModels');

const sumDelta = (sch) => sch.ColorTransitionList.reduce((a, ct) => a + ct.DeltaSeconds, 0);
const fromAt = (sch, hhmm) => sch.ColorTransitionList.find((ct) => ct.Time.endsWith(hhmm + ':00')).From;

describe('slotModels — asset', () => {
  test('id unici', () => {
    expect(new Set(ASSETS.map((a) => a.id)).size).toBe(ASSETS.length);
  });

  test('ogni preset usa asset esistenti, con un orario per ogni fascia usata', () => {
    PRESETS.forEach((p) => Object.keys(p.sel).forEach((k) => {
      expect(assetById(p.sel[k])).not.toBeNull();
      expect(p.times[k]).toMatch(/^\d{2}:\d{2}$/);
    }));
  });

  test('ogni preset compone una giornata chiusa (86400s)', () => {
    PRESETS.forEach((p) => {
      const sel = Object.keys(p.sel).map((k) => ({ fascia: k, modelId: p.sel[k], time: p.times[k] }));
      expect(sumDelta(composeSchedule(sel, p.depth || 'SemiDeep'))).toBe(86400);
    });
  });

  test('coralli molli (SoftReef): buio piatto dalle 20:00 all\'alba, picco moderato', () => {
    const p = PRESETS.find((x) => x.id === 'molli');
    const sch = composeSchedule(Object.keys(p.sel).map((k) => ({ fascia: k, modelId: p.sel[k], time: p.times[k] })), p.depth);
    const night = sch.ColorTransitionList.find((ct) => ct.Time.endsWith('20:00:00'));
    expect(night.From.Power).toBe(0);
    expect(night.To.Power).toBe(0);
    expect(fromAt(sch, '11:30').Power).toBeLessThanOrEqual(70);
  });

  test('giornata tropicale: asset validi, 6 slot, notte con fase lunare', () => {
    ['reef', 'atoll'].forEach((v) => {
      const { selection } = generateTropicalDay(v);
      expect(selection).toHaveLength(6);
      selection.forEach((s) => expect(assetById(s.modelId)).not.toBeNull());
      expect(assetById(selection[5].modelId).band).toBe('night');
      expect(sumDelta(composeSchedule(selection, 'SemiDeep'))).toBe(86400);
    });
  });

  test('ogni asset non spento ha una cella in ogni tabella', () => {
    ['Deep', 'SemiDeep', 'VeryDeep'].forEach((d) => ASSETS.filter((a) => !a.off).forEach((a) => {
      expect(resolveColor(d, a)).not.toEqual({ Amber: 0, Blue: 0, White: 0, Power: 0 });
    }));
  });

  test('spento -> tutto 0', () => {
    expect(resolveColor('SemiDeep', assetById('spento'))).toEqual({ Amber: 0, Blue: 0, White: 0, Power: 0 });
  });

  test('profondità diversa = tabella diversa', () => {
    expect(resolveColor('SemiDeep', assetById('picco')).White).toBe(80);
    expect(resolveColor('Deep', assetById('picco')).White).toBe(100);
  });
});

describe('slotModels — un asset vale uguale a qualunque ora', () => {
  test('"picco" alle 07:00 e alle 23:00 = stesso punto', () => {
    const sel = (t) => [{ modelId: 'picco', time: t }, { modelId: 'spento', time: t === '07:00' ? '12:00' : '03:00' }];
    expect(fromAt(composeSchedule(sel('07:00'), 'SemiDeep'), '07:00'))
      .toEqual(fromAt(composeSchedule(sel('23:00'), 'SemiDeep'), '23:00'));
  });

  test('"alba" spostata alle 13:00 resta il colore alba', () => {
    const sch = composeSchedule([{ modelId: 'alba', time: '13:00' }, { modelId: 'spento', time: '20:00' }], 'SemiDeep');
    expect(fromAt(sch, '13:00')).toEqual({ Amber: 0, Blue: 100, White: 0, Power: 100 });
  });
});

describe('slotModels — composeSchedule', () => {
  test('default selection -> 7 step, Period 86400, somma 86400, Time HH:MM:SS', () => {
    const sch = composeSchedule(defaultSelection(), 'SemiDeep');
    expect(sch.Period).toBe(86400);
    expect(sch.Steps).toBe(7);
    expect(sumDelta(sch)).toBe(86400);
    sch.ColorTransitionList.forEach((ct) => expect(ct.Time).toMatch(/^2015\/12\/01 - \d{2}:\d{2}:\d{2}$/));
  });

  test('To = From dello step successivo, tranne notte -> alba che tiene il buio', () => {
    const list = composeSchedule(defaultSelection(), 'SemiDeep').ColorTransitionList;
    list.forEach((ct, i) => {
      const next = list[(i + 1) % list.length];
      if (ct.Time.endsWith('00:00:00')) expect(ct.To).toEqual(ct.From);
      else expect(ct.To).toEqual(next.From);
    });
  });

  test('spento in mezzo alla giornata: buio tenuto fino allo slot dopo', () => {
    const sch = composeSchedule(defaultSelection().map((s) => (s.fascia === 'picco' ? { ...s, modelId: 'spento' } : s)), 'SemiDeep');
    const ct = sch.ColorTransitionList.find((x) => x.Time.includes('11:00'));
    expect(ct.From).toEqual({ Amber: 0, Blue: 0, White: 0, Power: 0 });
    expect(ct.To).toEqual(ct.From);
  });

  test('selezione vuota -> schedule vuoto', () => {
    const sch = composeSchedule([], 'SemiDeep');
    expect(sch.Steps).toBe(0);
    expect(sch.ColorTransitionList).toEqual([]);
  });

  test('orari non ordinati -> step ordinati', () => {
    const sch = composeSchedule([
      { modelId: 'novilunio', time: '22:00' }, { modelId: 'alba', time: '06:30' }, { modelId: 'picco', time: '12:00' }
    ], 'SemiDeep');
    const times = sch.ColorTransitionList.map((ct) => ct.Time.slice(13));
    expect(times).toEqual([...times].sort());
  });
});

describe('slotModels — selezioni del vecchio modello', () => {
  test('convertite nell\'asset che davano a quell\'ora', () => {
    expect(normalizeSelection([
      { modelId: 'sereno', time: '07:30' }, { modelId: 'nuvoloso', time: '12:30' }, { modelId: 'eclissi', time: '19:00' },
      { modelId: 'plenilunio', time: '22:00' }, { modelId: 'auto', time: '23:00' }, { modelId: 'off', time: '12:00' }
    ]).map((s) => s.modelId)).toEqual(['alba', 'picco-nuvoloso', 'tramonto', 'plenilunio', 'novilunio', 'spento']);
  });

  test('asset già validi restano invariati', () => {
    expect(normalizeSelection([{ modelId: 'sera-piovoso', time: '03:00' }])[0].modelId).toBe('sera-piovoso');
  });
});

// Parita' con i 3 preset hardcoded dell'app originale (ScheduleViewModel ID1..ID3):
// colore raggiunto a ogni orario [A,B,W,P], rampa tra fasce, notte buia tenuta fino all'alba.
describe('slotModels — preset = app originale', () => {
  const TIMES = ['09:00', '10:00', '11:00', '18:00', '19:00', '20:00', '00:00'];
  const APK = {
    superficiale: [[0,100,0,100],[0,100,30,100],[100,100,100,100],[50,100,50,100],[10,50,10,100],[10,50,0,50],[0,0,0,0]],
    intermedia:   [[0,100,0,100],[0,100,20,100],[100,100,80,100],[50,100,20,100],[10,50,5,100],[10,50,0,50],[0,0,0,0]],
    profonda:     [[0,100,0,60],[0,100,10,60],[50,100,60,60],[25,100,10,60],[5,50,0,60],[5,50,0,25],[0,0,0,0]]
  };
  const arr = (c) => [c.Amber, c.Blue, c.White, c.Power];

  Object.keys(APK).forEach((id) => {
    test(id, () => {
      const p = PRESETS.find((x) => x.id === id);
      const sel = FASCE.map((f) => ({ fascia: f.key, modelId: p.sel[f.key], time: p.times[f.key] }));
      const list = composeSchedule(sel, p.depth).ColorTransitionList;
      expect(list).toHaveLength(7);
      expect(list.reduce((s, ct) => s + ct.DeltaSeconds, 0)).toBe(86400);
      TIMES.forEach((hhmm, i) => {
        const ct = list.find((x) => x.Time.endsWith(hhmm + ':00'));
        expect(arr(ct.From)).toEqual(APK[id][i]);
        expect(arr(ct.To)).toEqual(i === 6 ? APK[id][6] : APK[id][i + 1]);
      });
    });
  });
});

describe('asset dinamici (meteo/luna reali)', () => {
  const sm = require('../src/services/slotModels');
  const experimental = require('../src/services/experimental');
  const sel = [{ modelId: 'picco-meteo', time: '11:00' }, { modelId: 'luna', time: '21:00' }];

  test('il colore segue la condizione live, con fallback sereno/novilunio', () => {
    const at = (live) => sm.composeSchedule(sel, 'SemiDeep', live).ColorTransitionList;
    expect(at({})[0].From).toEqual(sm.composeSchedule([{ modelId: 'picco', time: '11:00' }, { modelId: 'novilunio', time: '21:00' }]).ColorTransitionList[0].From);
    expect(at({ weather: 'rainy' })[0].From).toEqual(sm.composeSchedule([{ modelId: 'picco-piovoso', time: '11:00' }, { modelId: 'novilunio', time: '21:00' }]).ColorTransitionList[0].From);
    expect(at({ moon: 'full' })[1].From).toEqual(sm.composeSchedule([{ modelId: 'picco', time: '11:00' }, { modelId: 'plenilunio', time: '21:00' }]).ColorTransitionList[1].From);
  });

  test('dynamicKinds / dailyKey', () => {
    expect(sm.dynamicKinds(sel).sort()).toEqual(['moon', 'weather']);
    expect(sm.dynamicKinds([{ modelId: 'picco', time: '11:00' }])).toEqual([]);
    const now = new Date(2026, 9, 24, 10);
    expect(experimental.dailyKey({ reelState: { selection: sel } }, now)).toBe('dyn:2026-10-24');
    expect(experimental.dailyKey({ reelState: { selection: [{ modelId: 'picco', time: '11:00' }] } }, now)).toBeNull();
  });

  test('liveConditions: luna sempre, meteo solo se configurato', async () => {
    const live = await sm.liveConditions(sel, {});
    expect(['moonless', 'crescent', 'half', 'full']).toContain(live.moon);
    expect(live.weather).toBeUndefined();
  });
});
