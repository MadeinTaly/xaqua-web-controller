'use strict';
const axios = require('axios');
const http = require('http');
const net = require('net');
const { AsyncLocalStorage } = require('async_hooks');
const log = require('./logger');

// Contesto async usato per riconoscere le richieste emesse DA DENTRO una transazione
// (che devono passare senza riaccodarsi, pena deadlock) da quelle esterne (che devono
// attendere la fine della transazione).
const txContext = new AsyncLocalStorage();

const FIXED_TOKEN = '1234';
const READ_BACKOFF_MS = 60000;

const insecureTransport = {
  request: (options, callback) => {
    options.insecureHTTPParser = true;
    return http.request(options, callback);
  }
};

class XaquaClient {
  constructor(ip, username, password) {
    this.baseUrl = `http://${ip}/`;
    this.username = username;
    this.password = password;
    // Il firmware usa un token COSTANTE ("1234"): niente Login a ogni chiamata/scadenza.
    // Login ripetuti (2 per richiesta con il retry) martellavano il device quando era in
    // difficoltà. login() resta solo per il "Test connessione" manuale.
    this.token = FIXED_TOKEN;
    // Backoff letture: dopo un errore di rete i poll (home/ping/watchdog) falliscono subito
    // invece di riaprire connessioni verso un firmware già wedgato.
    this._downUntil = 0;
    this._powerScale = 100;
    this._cache = {};
    // Coda di serializzazione: il firmware regge UNA sola connessione HTTP alla volta.
    // Richieste concorrenti (es. Promise.all in /api/home o getFullStatus) collidono e
    // lo mandano in "socket hang up" / wedge. Tutte le post passano da qui, una per volta.
    this._chain = Promise.resolve();
    // Token della transazione attualmente in esecuzione (null se nessuna).
    this._currentTx = null;
  }

  /**
   * Esegue `fn` come UNA SOLA operazione atomica sulla coda del device.
   *
   * La coda `_chain` serializza le singole richieste, ma NON le sequenze logiche
   * multi-step: durante il two-phase (SetColorSchedule + N SetColorScheduleTransition)
   * la catena resta libera tra uno step e l'altro, così un poll qualunque
   * (oscilloscopio ogni 15s, healthMonitor, watchdog) si infila in mezzo e il firmware
   * — che sta ricevendo la schedule step-by-step — va in crash/reboot.
   *
   * Dentro `transaction()` le post() ereditano il contesto async e vengono eseguite
   * direttamente, mentre ogni altra richiesta resta accodata fino al termine.
   *
   * ATTENZIONE: proprio perché bypassano la coda, dentro `fn` le richieste al device
   * vanno emesse SEQUENZIALMENTE (await uno alla volta). Un `Promise.all` qui aprirebbe
   * davvero N connessioni contemporanee al firmware. Le transazioni annidate sono ok.
   */
  transaction(fn) {
    // Transazione annidata: la coda è già riservata da quella esterna, riaccodarsi
    // sarebbe un deadlock.
    if (this._inCurrentTransaction()) return Promise.resolve().then(fn);
    const token = Symbol('xaqua-tx');
    const task = async () => {
      this._currentTx = token;
      try {
        return await txContext.run(token, fn);
      } finally {
        this._currentTx = null;
      }
    };
    const next = this._chain.then(task, task);
    this._chain = next.catch(() => {});
    return next;
  }

  _inCurrentTransaction() {
    const store = txContext.getStore();
    return !!store && store === this._currentTx;
  }

  setConfig(ip, username, password) {
    this.baseUrl = `http://${ip}/`;
    this.username = username;
    this.password = password;
    this._downUntil = 0;
    this._clearCache();
  }

  setPowerScale(pct) {
    this._powerScale = Math.max(0, Math.min(100, parseInt(pct) >= 0 ? parseInt(pct) : 100));
  }

  scaleColor(obj) {
    const s = this._powerScale / 100;
    return {
      Amber: Math.max(0, Math.round((obj.Amber || 0) * s)),
      Blue:  Math.max(0, Math.round((obj.Blue  || 0) * s)),
      White: Math.max(0, Math.round((obj.White || 0) * s)),
      Power: Math.max(0, Math.round((obj.Power || 0) * s))
    };
  }

  logTimestamp() {
    return new Date().toISOString();
  }

  async _rawPost(endpoint, body, timeout) {
    const url = `${this.baseUrl}${endpoint}`;
    log.info('xaqua', `→ POST ${endpoint}`, body);
    const t0 = Date.now();
    let response;
    try {
      response = await axios.post(url, body, {
        headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
        timeout,
        transport: insecureTransport
      });
    } catch (e) {
      // Diagnostica "chi l'ha ammazzata": codice (ETIMEDOUT/EHOSTUNREACH = sparita dalla rete,
      // ECONNREFUSED/ECONNRESET = viva ma HTTP piantato) e quanto ha aspettato.
      log.warn('xaqua', `✗ POST ${endpoint}`, { code: e.code, status: e.response && e.response.status, error: e.message, ms: Date.now() - t0 });
      throw e;
    }
    log.info('xaqua', `← POST ${endpoint} ${response.status}`, { ms: Date.now() - t0, data: response.data });
    // Firmware in affanno risponde 200 col body vuoto: prima era silenzioso.
    if (endpoint.startsWith('Get') && (response.data == null || String(response.data).trim() === '')) {
      log.warn('xaqua', `${endpoint} 200 con body vuoto`);
    }
    return response.data;
  }

  _gap() { return new Promise((r) => setTimeout(r, 120)); }

  _isTransient(e) {
    const m = ((e && e.message) || '').toLowerCase();
    return (e && (e.code === 'ECONNRESET' || e.code === 'ECONNREFUSED'))
      || m.includes('socket hang up') || m.includes('econnreset') || m.includes('timeout');
  }

  // Tutte le richieste al firmware passano da qui e vengono SERIALIZZATE (una connessione
  // alla volta) con un piccolo gap tra l'una e l'altra + un retry soft sugli errori di rete
  // transienti tipici del firmware (Connection: close, prima connessione dopo idle droppata).
  post(endpoint, body = {}, timeout = 5000) {
    const isRead = endpoint.startsWith('Get');
    const task = async () => {
      // Solo le letture rispettano il backoff: scritture (apply, protezione termica) ci provano sempre.
      if (isRead && Date.now() < this._downUntil) throw new Error('device offline (backoff)');
      let lastErr;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await this._rawPost(endpoint, body, timeout);
          this._downUntil = 0;
          await this._gap();
          return r;
        } catch (e) {
          lastErr = e;
          if (attempt === 1 || !this._isTransient(e)) {
            if (this._isTransient(e)) this._downUntil = Date.now() + READ_BACKOFF_MS;
            await this._gap();
            throw e;
          }
          await new Promise((res) => setTimeout(res, 300)); // backoff soft e ritenta
        }
      }
      throw lastErr;
    };
    // Richiesta emessa da dentro una transazione: la coda è già occupata dalla
    // transazione stessa, riaccodarsi sarebbe un deadlock.
    if (this._inCurrentTransaction()) return task();
    // Accoda dopo la richiesta precedente (a prescindere dal suo esito) e non lasciare
    // mai la catena in stato "rejected" (altrimenti bloccherebbe le successive).
    const next = this._chain.then(task, task);
    this._chain = next.catch(() => {});
    return next;
  }

  // Verifica raggiungibilità TCP senza autenticazione.
  // Anche questa apre una connessione al device, quindi passa dalla stessa coda:
  // un "Test connessione" dalle Settings durante un apply aprirebbe una seconda
  // connessione TCP in parallelo.
  ping() {
    const task = () => this._rawPing();
    if (this._inCurrentTransaction()) return task();
    const next = this._chain.then(task, task);
    this._chain = next.catch(() => {});
    return next;
  }

  _rawPing() {
    return new Promise((resolve, reject) => {
      const { hostname } = new URL(this.baseUrl);
      const socket = net.createConnection({ host: hostname, port: 80 });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(Object.assign(new Error('Host non raggiungibile'), { code: 'PING_TIMEOUT' }));
      }, 2000);
      socket.on('connect', () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(true);
      });
      socket.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async login() {
    const data = await this.post('Login/', {
      Username: this.username,
      Password: this.password
    }, 3000);
    if (!data || !data.LoginResult) throw new Error('Login fallito');
    this.token = data.LoginResult;
    return this.token;
  }

  async withAuth(fn) {
    return fn(this.token);
  }

  _getCache(key, ttlMs) {
    const cached = this._cache[key];
    if (!cached) return undefined;
    if (Date.now() - cached.timestamp > ttlMs) {
      delete this._cache[key];
      return undefined;
    }
    return cached.value;
  }

  _setCache(key, value) {
    this._cache[key] = {
      value,
      timestamp: Date.now()
    };
  }

  _clearCache() {
    this._cache = {};
  }

  // Info lampada
  async getLampInfo() {
    const cacheKey = 'lampInfo';
    const cached = this._getCache(cacheKey, 24 * 3600 * 1000); // nome/fw/ID: statici
    if (cached !== undefined) return cached;
    return this.withAuth(async (token) => {
      const data = await this.post('GetLampInfo/', { token });
      const result = data && data.GetLampInfoResult ? data.GetLampInfoResult : null;
      this._setCache(cacheKey, result);
      return result;
    });
  }

  // Ultima info lampada letta, senza chiamare il firmware (null se mai letta).
  cachedLampInfo() { return this._cache.lampInfo ? this._cache.lampInfo.value : null; }

  async setLampInfo(lamp) {
    return this.withAuth(async (token) => {
      let cached = {};
      try { cached = (await this.getLampInfo()) || {}; } catch(e) {}
      const lampObj = {
        ID:           lamp.ID           || cached.ID           || '',
        Name:         lamp.Name         || cached.Name         || '',
        Description:  lamp.AquariumType !== undefined
          ? (lamp.AquariumType + ',' + (lamp.AquariumName || cached.AquariumName || ''))
          : (cached.Description || ''),
        BaseAddress:  lamp.BaseAddress  || cached.BaseAddress  || '',
        FW_rev:       lamp.FW_rev       || cached.FW_rev       || '',
        GroupID:      lamp.GroupID      || cached.GroupID      || '',
        GroupName:    lamp.GroupName    || cached.GroupName    || '',
        AquariumType: lamp.AquariumType !== undefined ? parseInt(lamp.AquariumType) : (cached.AquariumType || 0)
      };
      delete this._cache.lampInfo; // nome cambiato: la prossima lettura deve essere vera
      return this.post('SetLampInfo/', { token, lamp: lampObj }, 8000);
    });
  }

  async getLampStatus() {
    const cacheKey = 'lampStatus';
    const cached = this._getCache(cacheKey, 10000);
    if (cached !== undefined) return cached;
    return this.withAuth(async (token) => {
      const data = await this.post('GetLampStatus/', { token });
      const result = data && data.GetLampStatusResult ? data.GetLampStatusResult : null;
      if (result && result.Temperature !== undefined) {
        result.Temperature = result.Temperature / 100;
      }
      this._setCache(cacheKey, result);
      return result;
    });
  }

  // Colore istantaneo
  async getColorSchema() {
    const cacheKey = 'colorSchema';
    const cached = this._getCache(cacheKey, 5000);
    if (cached !== undefined) return cached;
    return this.withAuth(async (token) => {
      const data = await this.post('GetColorSchema/', { token });
      const r = data && data.GetColorSchemaResult ? data.GetColorSchemaResult : null;
      if (!r) return null;
      const result = {
        Amber: Math.round(r.Amber || 0),
        Blue:  Math.round(r.Blue  || 0),
        White: Math.round(r.White || 0),
        Power: Math.round(r.Power || 0)
      };
      this._setCache(cacheKey, result);
      return result;
    });
  }

  async setColorSchema(cs) {
    return this.withAuth(async (token) => {
      // Invalida la cache del colore: una GET entro il TTL non deve tornare il valore vecchio
      delete this._cache['colorSchema'];
      return this.post('SetColorSchema/', { token, cs: this.scaleColor(cs) });
    });
  }

  // Schedule
  // Formato firmware: { ColorTransitionList: [{ From, To, DeltaSeconds, Time }, ...] }
  async setColorSchedule(cs) {
    return this.withAuth(async (token) => {
      return this.post('SetColorSchedule/', {
        token,
        cs: { ID: 1, Name: 'Manual', Description: '', Image: '', Steps: cs.Steps, Period: cs.Period || 86400 }
      }, 15000);
    });
  }

  async setColorScheduleTransition(step, ct) {
    return this.withAuth(async (token) => {
      const scaled = {
        ...ct,
        From: ct.From ? this.scaleColor(ct.From) : ct.From,
        To:   ct.To   ? this.scaleColor(ct.To)   : ct.To
      };
      return this.post('SetColorScheduleTransition/', { token, Step: step, ct: scaled }, 10000);
    });
  }

  // Ora
  async getTime() {
    const cacheKey = 'time';
    const cached = this._getCache(cacheKey, 30000);
    if (cached !== undefined) return cached;
    return this.withAuth(async (token) => {
      const data = await this.post('GetTime/', { token });
      const result = data && data.GetTimeResult ? data.GetTimeResult : null;
      this._setCache(cacheKey, result);
      return result;
    });
  }

  async setTime(time) {
    return this.withAuth(async (token) => {
      return this.post('SetTime/', { token, time });
    });
  }

  async syncTime(timezoneOffsetSeconds, manualTime, nowMs = Date.now()) {
    const pad = (n) => String(n).padStart(2, '0');
    let timeStr;
    if (manualTime) {
      // Orario manuale HH:MM o HH:MM:SS — data sempre fissa come le schedule firmware
      const parts = manualTime.split(':');
      timeStr = `2015/12/01 - ${parts[0] || '00'}:${parts[1] || '00'}:${parts[2] || '00'}`;
    } else {
      let d;
      if (timezoneOffsetSeconds !== undefined) {
        // Date.now() è già UTC; applicare solo l'offset target.
        d = new Date(nowMs + timezoneOffsetSeconds * 1000);
        // Usa i getter UTC perché d rappresenta già il "wall clock" target
        timeStr = `2015/12/01 - ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
      } else {
        d = new Date(nowMs);
        timeStr = `2015/12/01 - ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      }
    }
    return this.setTime(timeStr);
  }

  // Credenziali
  async setCredential(username, oldPsw, newPsw) {
    return this.withAuth(async (token) => {
      return this.post('SetCredential/', { token, username, oldPsw, newPsw });
    });
  }

  async enableLogin(isEnabled) {
    return this.withAuth(async (token) => {
      return this.post('EnableLogin/', { token, isEnabled });
    });
  }

  // Stato completo per home
  // Snapshot completo. Le tre letture sono SEQUENZIALI e dentro una singola
  // transazione: sono un'unica fotografia dello stato, e nulla deve intercalarsi.
  getFullStatus() {
    return this.transaction(async () => {
      const safe = async (fn) => { try { return await fn(); } catch (e) { return null; } };
      const info   = await safe(() => this.getLampInfo());
      const status = await safe(() => this.getLampStatus());
      const color  = await safe(() => this.getColorSchema());
      return { info, status, color };
    });
  }

  isNightTime() {
    const hour = new Date().getHours();
    return hour >= 21 || hour < 7;
  }
}

const client = new XaquaClient(
  process.env.DEVICE_IP       || '0.0.0.0',
  process.env.DEVICE_USERNAME || '',
  process.env.DEVICE_PASSWORD || ''
);
module.exports = client;
