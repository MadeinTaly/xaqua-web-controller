'use strict';

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('./_shared');
const configStore = require('../../services/configStore');
const log = require('../../services/logger');
const { fetchCurrentWeather, weatherCodeToCondition } = require('../../services/weatherService');
const { calculateMoonPhase, moonPhaseToWeatherColumn } = require('../../services/moonHelper');

// NATURE
const MOON_LABELS  = { moonless: 'Senza Luna', crescent: 'Luna Crescente', half: 'Mezza Luna', full: 'Luna Piena' };
const MOON_EMOJIS  = { moonless: '🌑', crescent: '🌒', half: '🌓', full: '🌕' };
const DAY_LABELS   = { clear: 'Sereno', cloudy: 'Nuvoloso', rainy: 'Piovoso' };

// Cache meteo corrente (15 minuti)
let weatherCache = null;
let weatherCacheTime = 0;
const WEATHER_CACHE_TTL = 15 * 60 * 1000;

router.get('/nature/current', asyncHandler(async (req, res) => {
  const config = configStore.load();

  // Luna — sempre disponibile
  const phase = calculateMoonPhase(new Date());
  const moonCondition = moonPhaseToWeatherColumn(phase);
  const moon = { phase: moonCondition, label: MOON_LABELS[moonCondition], emoji: MOON_EMOJIS[moonCondition] };

  // Meteo — solo se configurato, con cache
  let weather = null;
  if (config.weather && config.weather.city && config.weather.apiKey) {
    const now = Date.now();
    if (!weatherCache || now - weatherCacheTime > WEATHER_CACHE_TTL) {
      try {
        const data = await fetchCurrentWeather(config.weather.city, config.weather.apiKey);
        const condition = weatherCodeToCondition(data.weather[0].id);
        weatherCache = { condition, label: DAY_LABELS[condition] || condition, city: data.name };
        weatherCacheTime = now;
      } catch (err) {
        weatherCache = null;
      }
    }
    weather = weatherCache;
  }

  res.json({ moon, weather });
}));

// Test meteo: valida key/città dal config server-side, ritorna città risolta + condizione.
router.get('/weather/test', asyncHandler(async (req, res) => {
  const config = configStore.load();
  const city = config.weather && config.weather.city;
  const apiKey = config.weather && config.weather.apiKey;
  if (!city) return res.json({ ok: false, error: 'Città non impostata in config' });
  if (!apiKey) return res.json({ ok: false, error: 'API key non impostata in config' });
  try {
    const ow = await fetchCurrentWeather(city, apiKey);
    const code = ow && ow.weather && ow.weather[0] && ow.weather[0].id;
    res.json({
      ok: true,
      query: city,
      resolved: ow.name + (ow.sys && ow.sys.country ? ', ' + ow.sys.country : ''),
      condition: weatherCodeToCondition(code),
      desc: ow.weather && ow.weather[0] && ow.weather[0].description,
      tempC: ow.main && typeof ow.main.temp === 'number' ? Math.round(ow.main.temp - 273.15) : null
    });
  } catch (e) {
    log.warn('api', 'weather/test fallito', { error: e.message });
    res.json({ ok: false, error: e.message });
  }
}));

module.exports = router;
