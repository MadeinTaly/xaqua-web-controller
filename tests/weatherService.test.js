'use strict';

const { weatherCodeToCondition } = require('../src/services/weatherService');

// ---------------------------------------------------------------------------
// Helper: intercetta la URL effettiva usata da axios per le chiamate meteo
// ---------------------------------------------------------------------------

describe('weatherService URL security', () => {
  // Per testare che le URL usino HTTPS senza fare richieste reali,
  // mockiamo axios e verifichiamo la URL passata.

  let axios;
  let weatherService;

  beforeEach(() => {
    jest.resetModules();
    axios = require('axios');
    jest.spyOn(axios, 'get').mockImplementation(() => Promise.resolve({ data: {} }));
    // Ricarichiamo il modulo dopo il mock
    weatherService = require('../src/services/weatherService');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('fetchCurrentWeather usa HTTPS (non HTTP)', async () => {
    await weatherService.fetchCurrentWeather('Roma', 'testkey');
    const calledUrl = axios.get.mock.calls[0][0];
    expect(calledUrl).toMatch(/^https:\/\//);
    expect(calledUrl).not.toMatch(/^http:\/\//);
  });
});

// ---------------------------------------------------------------------------
// weatherCodeToCondition — test esistenti del mapping
// ---------------------------------------------------------------------------

describe('weatherCodeToCondition', () => {
  test('codice 800 → clear', () => {
    expect(weatherCodeToCondition(800)).toBe('clear');
  });

  test('codice 801-804 → cloudy', () => {
    expect(weatherCodeToCondition(801)).toBe('cloudy');
    expect(weatherCodeToCondition(804)).toBe('cloudy');
  });

  test('codice 500-531 → rainy', () => {
    expect(weatherCodeToCondition(500)).toBe('rainy');
    expect(weatherCodeToCondition(502)).toBe('rainy');
  });

  test('codice 300-321 → rainy (pioggia leggera - FIX)', () => {
    expect(weatherCodeToCondition(300)).toBe('rainy');
  });

  test('codice 200-232 → rainy (temporali)', () => {
    expect(weatherCodeToCondition(200)).toBe('rainy');
  });

  test('codice 600-622 → rainy (neve)', () => {
    expect(weatherCodeToCondition(600)).toBe('rainy');
  });

  test('codice sconosciuto → clear (default)', () => {
    expect(weatherCodeToCondition(999)).toBe('clear');
  });
});
