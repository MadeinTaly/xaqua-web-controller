'use strict';

const fs = require('fs');
const path = require('path');

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] || LOG_LEVELS.info;

// Ring buffer degli ultimi log, esposto in UI via GET /api/logs.
// Cattura solo ciò che supera il livello corrente (come la console). Ogni voce è anche
// appesa (JSONL) a xaqua.log accanto a config.json (volume persistente in produzione):
// al boot il buffer riparte dalla coda del file, così restart/deploy non cancellano
// cosa è successo prima che la lampada sparisse.
const MAX_BUFFER = 300;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // poi ruota in xaqua.log.1 (una sola copia)
const buffer = [];

function logFile() {
  const cfg = process.env.XAQUA_CONFIG_PATH || path.join(__dirname, '../../data/config.json');
  return path.join(path.dirname(cfg), 'xaqua.log');
}

function persist(entry) {
  try {
    const file = logFile();
    try { if (fs.statSync(file).size > MAX_FILE_BYTES) fs.renameSync(file, file + '.1'); } catch (e) {}
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch (e) {} // disco/permessi: la console resta comunque
}

(function loadTail() {
  try {
    const lines = fs.readFileSync(logFile(), 'utf8').trim().split('\n').slice(-MAX_BUFFER);
    for (const l of lines) { try { buffer.push(JSON.parse(l)); } catch (e) {} }
  } catch (e) {}
})();

function fmtTime() {
  return new Date().toISOString();
}

function serialize(obj) {
  if (!obj) return '';
  try {
    const s = JSON.stringify(obj);
    return s.length > 500 ? s.slice(0, 500) + '...' : s;
  } catch (e) { return String(obj); }
}

function record(ts, level, tag, msg, data) {
  const entry = { ts, level, tag, msg, data: data != null ? serialize(data) : null };
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) buffer.shift();
  persist(entry);
}

function make(level, num, consoleFn) {
  return function (tag, msg, data) {
    if (currentLevel <= num) {
      const ts = fmtTime();
      consoleFn(`[${ts}] [${level.toUpperCase()}] [${tag}] ${msg}${data ? ' | ' + serialize(data) : ''}`);
      record(ts, level, tag, msg, data);
    }
  };
}

module.exports = {
  debug: make('debug', 0, console.log),
  info:  make('info', 1, console.log),
  warn:  make('warn', 2, console.warn),
  error: make('error', 3, console.error),

  // level opzionale: ritorna solo le voci >= di quel livello (es. 'warn' = warn+error)
  getLogs: function (level) {
    if (level && LOG_LEVELS[level] !== undefined) {
      const min = LOG_LEVELS[level];
      return buffer.filter((e) => LOG_LEVELS[e.level] >= min);
    }
    return buffer.slice();
  },
  // Svuota solo la vista: il file resta come storico (scaricabile da /api/logs/file).
  clearLogs: function () { buffer.length = 0; },
  logFile
};
