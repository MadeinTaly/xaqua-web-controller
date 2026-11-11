'use strict';

const axios = require('axios');
const log = require('./logger');

/**
 * Client HTTP per dispositivi WLED.
 *
 * WLED espone un'API JSON standard:
 *   GET  /json/info  — info statiche (name, ver, leds.count, leds.cct, ...)
 *   GET  /json/state — stato corrente (on, bri, transition, seg[])
 *   POST /json/state — set state parziale
 *   GET  /json/cfg   — configurazione (read-only via API)
 *
 * Riferimento: https://kno.wled.ge/interfaces/json-api/
 *
 * Modello CCT (acquario bianco/blu):
 *   La lampada reale ha capability White+CCT (leds.lc=6, rgbw=false): NESSUN
 *   canale RGB. Si controlla con:
 *     - bri  (0-255): intensità master
 *     - seg.cct (0-255): temperatura, 0 = bianco caldo, 255 = blu freddo/actinic
 *   L'astrazione esposta è { on, white (0-100), blue (0-100) }:
 *     - white = quantità di bianco caldo
 *     - blue  = quantità di blu freddo
 *   Mapping: total=white+blue → bri (cap 100%); cct = blue/total.
 *   Il canale bianco viene tenuto pieno (col[0]=[0,0,0,255]) e modulato da bri.
 */

const insecureTransport = require('http').globalAgent;

// ---- Mapping bianco/blu (0-100) <-> WLED (bri 0-255, cct 0-255) ----
// brightness (0-100): moltiplicatore globale di intensità (default 100 per retrocompatibilità)
function whiteBlueToWled(white, blue, brightness) {
  var w = Math.max(0, Math.min(100, parseInt(white) || 0));
  var b = Math.max(0, Math.min(100, parseInt(blue) || 0));
  var bri_pct = brightness !== undefined ? Math.max(0, Math.min(100, parseInt(brightness) || 0)) : 100;
  var total = w + b;
  if (total <= 0) return { bri: 0, cct: 0 };
  var briBase = Math.round(Math.min(100, total) / 100 * 255);
  var bri = Math.round(briBase * (bri_pct / 100));
  var cct = Math.round((b / total) * 255);
  return { bri: bri, cct: cct };
}

function wledToWhiteBlue(bri, cct) {
  var briPct = Math.max(0, Math.min(255, bri || 0)) / 255 * 100;
  var blueRatio = Math.max(0, Math.min(255, cct || 0)) / 255;
  var blue = Math.round(briPct * blueRatio);
  var white = Math.round(briPct * (1 - blueRatio));
  return { white: white, blue: blue };
}

class WledClient {
  constructor(ip) {
    if (!ip) throw new Error('WledClient: ip mancante');
    this.ip = ip;
    this.baseUrl = `http://${ip}`;
    this._infoCache = null;
    this._infoCacheTime = 0;
    this._stateCache = null;
    this._stateCacheTime = 0;
  }

  async _get(endpoint, timeout = 3000) {
    const url = `${this.baseUrl}${endpoint}`;
    const r = await axios.get(url, { timeout });
    return r.data;
  }

  async _post(endpoint, body, timeout = 3000) {
    const url = `${this.baseUrl}${endpoint}`;
    const r = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout
    });
    // Una mutazione di stato invalida la cache di getState
    if (endpoint.indexOf('/json/state') === 0) this._invalidateState();
    return r.data;
  }

  async getInfo(useCache = true) {
    const now = Date.now();
    if (useCache && this._infoCache && (now - this._infoCacheTime) < 30000) {
      return this._infoCache;
    }
    const data = await this._get('/json/info');
    this._infoCache = data;
    this._infoCacheTime = now;
    return data;
  }

  async getState(useCache = true) {
    const now = Date.now();
    if (useCache && this._stateCache && (now - this._stateCacheTime) < 3000) {
      return this._stateCache;
    }
    const data = await this._get('/json/state');
    this._stateCache = data;
    this._stateCacheTime = now;
    return data;
  }

  _invalidateState() { this._stateCache = null; this._stateCacheTime = 0; }

  /**
   * Ritorna lo stato in formato semplificato.
   */
  async getStatus() {
    try {
      const [info, state] = await Promise.all([
        this.getInfo(),
        this.getState()
      ]);
      const seg0 = (state.seg && state.seg[0]) || {};
      const wb = wledToWhiteBlue(state.bri || 0, seg0.cct || 0);
      return {
        online: true,
        name: info.name || 'WLED',
        ip: this.ip,
        version: info.ver,
        ledCount: info.leds && info.leds.count,
        cctCapable: !!(info.leds && info.leds.cct),
        on: !!state.on,
        brightness: state.bri || 0,
        cct: seg0.cct || 0,
        white: wb.white,
        blue: wb.blue
      };
    } catch (err) {
      log.warn('wled', `getStatus failed @${this.ip}`, { error: err.message });
      return { online: false, ip: this.ip, error: err.message };
    }
  }

  async setOn(on) {
    return this._post('/json/state', { on: !!on });
  }

  async setBrightness(bri) {
    const v = Math.max(0, Math.min(255, parseInt(bri) || 0));
    return this._post('/json/state', { bri: v });
  }

  /**
   * Imposta bianco/blu (0-100). Traduce in bri + cct WLED.
   */
  async setWhiteBlue(white, blue) {
    const wb = whiteBlueToWled(white, blue);
    return this._post('/json/state', {
      on: wb.bri > 0,
      bri: wb.bri,
      seg: [{ id: 0, cct: wb.cct, col: [[0, 0, 0, 255]] }]
    });
  }

  /**
   * Update completo: { on, white, blue, brightness }. Usato dal "Applica" della UI e dallo scheduler.
   * white/blue 0-100; brightness 0-100 (default 100). Se entrambi 0 la lampada resta on ma a bri 0 (spenta visivamente).
   */
  async applyState({ on, white, blue, brightness }) {
    const wb = whiteBlueToWled(white, blue, brightness);
    const body = { bri: wb.bri, seg: [{ id: 0, cct: wb.cct, col: [[0, 0, 0, 255]] }] };
    body.on = (on !== undefined) ? !!on : wb.bri > 0;
    return this._post('/json/state', body);
  }

  /**
   * Verifica raggiungibilità: chiede /json/info con timeout breve.
   */
  async ping() {
    try {
      await this._get('/json/info', 2000);
      return true;
    } catch (e) {
      return false;
    }
  }
}

/**
 * Registry dei dispositivi WLED: legge da config.wled.devices e fornisce
 * accesso per id. Cache di client istanze per evitare re-allocazione.
 */
class WledRegistry {
  constructor() {
    this._clients = {};
  }

  setDevices(devices) {
    const seen = new Set();
    (devices || []).forEach(d => {
      if (!d.id || !d.ip) return;
      seen.add(d.id);
      const existing = this._clients[d.id];
      if (!existing || existing.client.ip !== d.ip) {
        this._clients[d.id] = { device: d, client: new WledClient(d.ip) };
      } else {
        existing.device = d;
      }
    });
    // Rimuovi client per dispositivi non più presenti
    Object.keys(this._clients).forEach(id => {
      if (!seen.has(id)) delete this._clients[id];
    });
  }

  get(id) {
    const entry = this._clients[id];
    return entry ? entry.client : null;
  }

  getDevice(id) {
    const entry = this._clients[id];
    return entry ? entry.device : null;
  }

  listDevices() {
    return Object.values(this._clients).map(e => e.device);
  }

  async listStatuses() {
    const entries = Object.values(this._clients);
    const results = await Promise.all(entries.map(async (e) => {
      const status = await e.client.getStatus();
      return { id: e.device.id, name: e.device.name, type: e.device.type, ...status };
    }));
    return results;
  }
}

const registry = new WledRegistry();

module.exports = { WledClient, WledRegistry, registry, whiteBlueToWled, wledToWhiteBlue };
