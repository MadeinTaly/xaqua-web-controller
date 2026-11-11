'use strict';

const axios = require('axios');
const os = require('os');
const log = require('./logger');

/**
 * Discovery WLED via HTTP probe parallelo su range /24.
 *
 * WLED risponde a GET /json/info con un JSON che contiene `"brand":"WLED"`
 * (e di solito `"name"`, `"ver"`, `"leds"`). Probiamo timeout brevi e
 * limitiamo la concorrenza per non saturare la rete.
 */

const PROBE_TIMEOUT_MS = 700;
const CONCURRENCY      = 32;

async function probe(ip) {
  try {
    const r = await axios.get(`http://${ip}/json/info`, {
      timeout: PROBE_TIMEOUT_MS,
      // Header user-agent generico: alcuni firmware rifiutano user-agent vuoti
      headers: { 'User-Agent': 'xaqua-web-discovery' },
      validateStatus: () => true
    });
    const d = r.data;
    if (!d || typeof d !== 'object') return null;
    const isWled = d.brand === 'WLED' || d.product === 'wled' || (typeof d.ver === 'string' && d.leds);
    if (!isWled) return null;
    return {
      ip,
      name: d.name || 'WLED',
      version: d.ver,
      product: d.product,
      ledCount: d.leds && d.leds.count,
      hasWhite: !!(d.leds && d.leds.wv),
      mac: d.mac
    };
  } catch (e) {
    return null;
  }
}

/**
 * Esegue probe su tutti gli IP del range /24 con concorrenza limitata.
 * @param {string} prefix - "192.168.1" (no .0/24 finale, no trailing dot)
 * @returns {Promise<Array>} lista oggetti WLED trovati
 */
async function scanSubnet(prefix) {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(prefix)) {
    throw new Error(`Prefix /24 non valido: ${prefix}`);
  }
  const ips = [];
  for (let i = 1; i <= 254; i++) ips.push(`${prefix}.${i}`);

  const results = [];
  let cursor = 0;

  async function worker() {
    while (cursor < ips.length) {
      const ip = ips[cursor++];
      const found = await probe(ip);
      if (found) results.push(found);
    }
  }

  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

/**
 * Deriva i prefissi /24 dagli IP IPv4 non-loopback delle interfacce locali.
 * In contesto containerizzato (Docker) può ritornare prefissi della rete bridge (es. 172.x);
 * il chiamante può comunque passare un prefisso esplicito via parametro.
 */
function autoPrefixes() {
  const out = new Set();
  const ifaces = os.networkInterfaces();
  Object.values(ifaces).forEach((arr) => {
    (arr || []).forEach((info) => {
      if (info.family !== 'IPv4' || info.internal) return;
      const parts = info.address.split('.');
      if (parts.length !== 4) return;
      out.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
    });
  });
  return Array.from(out);
}

/**
 * Discovery completa: scan multipli prefissi e ritorna lista deduplicata per IP.
 * @param {Array<string>} prefixes - opzionale, default = autoPrefixes()
 */
async function discover(prefixes) {
  let list = prefixes && prefixes.length ? prefixes : null;
  if (!list) list = autoPrefixes();
  log.info('wled-discovery', 'scan started', { prefixes: list });
  const all = [];
  for (const p of list) {
    try {
      const found = await scanSubnet(p);
      all.push(...found);
    } catch (e) {
      log.warn('wled-discovery', `scanSubnet failed for ${p}`, { error: e.message });
    }
  }
  // Dedupe per IP
  const seen = new Set();
  const unique = all.filter((d) => {
    if (seen.has(d.ip)) return false;
    seen.add(d.ip);
    return true;
  });
  log.info('wled-discovery', 'scan complete', { found: unique.length });
  return unique;
}

module.exports = { discover, autoPrefixes };
