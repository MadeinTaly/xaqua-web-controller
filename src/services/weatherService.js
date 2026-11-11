'use strict';

const axios = require('axios');

// Mappatura codici OpenWeatherMap → condizione
function weatherCodeToCondition(code) {
  if (code === 800) return 'clear';
  if (code >= 801 && code <= 804) return 'cloudy';
  if (code >= 500 && code <= 531) return 'rainy';
  if (code >= 300 && code <= 321) return 'rainy';
  if (code >= 200 && code <= 232) return 'rainy';
  if (code >= 600 && code <= 622) return 'rainy';
  if (code >= 700 && code <= 781) return 'cloudy';
  return 'clear';
}

// Meteo corrente (non forecast) — per Nature mode
async function fetchCurrentWeather(city, apiKey) {
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}`;
  const response = await axios.get(url, { timeout: 10000 });
  return response.data;
}

module.exports = { fetchCurrentWeather, weatherCodeToCondition };
