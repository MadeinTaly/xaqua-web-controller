'use strict';

/**
 * Test per la funzione di power scaling in xaquaClient.
 * Verifica che tutti i valori colore vengano scalati correttamente.
 */

describe('powerScale', () => {
  let xaquaClient;

  beforeEach(() => {
    jest.resetModules();
    xaquaClient = require('../src/services/xaquaClient');
    xaquaClient.setPowerScale(100); // reset
  });

  afterEach(() => {
    xaquaClient.setPowerScale(100);
  });

  test('scaleColor al 100% non modifica i valori', () => {
    xaquaClient.setPowerScale(100);
    const result = xaquaClient.scaleColor({ Amber: 100, Blue: 80, White: 50, Power: 100 });
    expect(result).toEqual({ Amber: 100, Blue: 80, White: 50, Power: 100 });
  });

  test('scaleColor al 80% riduce tutti i canali', () => {
    xaquaClient.setPowerScale(80);
    const result = xaquaClient.scaleColor({ Amber: 100, Blue: 100, White: 100, Power: 100 });
    expect(result).toEqual({ Amber: 80, Blue: 80, White: 80, Power: 80 });
  });

  test('scaleColor arrotonda correttamente (Math.round)', () => {
    xaquaClient.setPowerScale(33);
    const result = xaquaClient.scaleColor({ Amber: 100, Blue: 90, White: 50, Power: 100 });
    // 100*0.33=33, 90*0.33=29.7→30, 50*0.33=16.5→17 (Math.round)
    expect(result).toEqual({ Amber: 33, Blue: 30, White: 17, Power: 33 });
  });

  test('scaleColor non va sotto zero', () => {
    xaquaClient.setPowerScale(0);
    const result = xaquaClient.scaleColor({ Amber: 100, Blue: 100, White: 100, Power: 100 });
    expect(result).toEqual({ Amber: 0, Blue: 0, White: 0, Power: 0 });
  });

  test('scaleColor con valori a zero resta zero', () => {
    xaquaClient.setPowerScale(80);
    const result = xaquaClient.scaleColor({ Amber: 0, Blue: 0, White: 0, Power: 0 });
    expect(result).toEqual({ Amber: 0, Blue: 0, White: 0, Power: 0 });
  });

  test('scaleColor al 50% su valori misti', () => {
    xaquaClient.setPowerScale(50);
    const result = xaquaClient.scaleColor({ Amber: 50, Blue: 100, White: 0, Power: 30 });
    expect(result).toEqual({ Amber: 25, Blue: 50, White: 0, Power: 15 });
  });
});
