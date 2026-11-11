'use strict';

const fs = require('fs');
const path = require('path');
const log = require('./logger');

function getPath() {
  return process.env.XAQUA_CONFIG_PATH || path.join(__dirname, '../../data/config.json');
}

/**
 * Carica il config da disco (sync).
 * Su errore, logga warn e ritorna un config minimo.
 */
function load() {
  try {
    const data = fs.readFileSync(getPath(), 'utf8');
    return JSON.parse(data);
  } catch (e) {
    log.warn('configStore', 'load error, returning defaults', { error: e.message });
    return {
      device: { ip: process.env.DEVICE_IP || '192.168.1.1' },
      weather: { city: '', apiKey: '' },
      aquarium: { type: 'SemiDeep' }
    };
  }
}

/**
 * Salva config su disco in modo atomico (tmp + rename).
 * Sync.
 */
function save(config) {
  const configPath = getPath();
  const tmp = configPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, configPath);
}

class ConfigStore {
  constructor() {
    // Coda di promise per serializzare le operazioni di update
    this._chain = Promise.resolve();
  }

  /**
   * Ritorna il config corrente (sync).
   */
  load() {
    return load();
  }

  /**
   * Esegue una mutazione in coda serializzata.
   * Il mutator è una funzione (sync o async) che riceve il config corrente
   * e deve modificarlo in-place (oppure ritornare un nuovo config).
   * Dopo il mutator, salva il config e ritorna il config finale.
   */
  update(mutator) {
    const task = async () => {
      const config = load();
      // Se mutator è async, attendi
      await Promise.resolve(mutator(config));
      save(config);
      return config;
    };

    // Accoda dopo la task precedente, anche se fallisce
    const next = this._chain.then(task, task);
    // Cattura i fallimenti per non bloccare la catena
    this._chain = next.catch(() => {});
    return next;
  }
}

module.exports = new ConfigStore();
