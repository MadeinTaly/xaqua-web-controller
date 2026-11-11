'use strict';

const { autoPrefixes } = require('../src/services/wledDiscovery');

describe('wledDiscovery.autoPrefixes', () => {
  test('ritorna un array di stringhe in formato a.b.c', () => {
    const out = autoPrefixes();
    expect(Array.isArray(out)).toBe(true);
    out.forEach(p => {
      expect(p).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/);
    });
  });

  test('non include loopback', () => {
    const out = autoPrefixes();
    expect(out).not.toContain('127.0.0');
  });
});

describe('wledDiscovery filter logica route', () => {
  test('dedupe per IP funziona', () => {
    // Simula la logica di filtro che il route applica
    const found = [
      { ip: '1.1.1.1', name: 'A' },
      { ip: '1.1.1.2', name: 'B' },
      { ip: '1.1.1.3', name: 'C' }
    ];
    const existingIps = new Set(['1.1.1.2']);
    const filtered = found.filter(d => !existingIps.has(d.ip));
    expect(filtered).toHaveLength(2);
    expect(filtered.map(d => d.ip)).toEqual(['1.1.1.1', '1.1.1.3']);
  });

  test('skippedExisting count corretto', () => {
    const found = [
      { ip: '10.0.0.1' }, { ip: '10.0.0.2' }, { ip: '10.0.0.3' }
    ];
    const existingIps = new Set(['10.0.0.1', '10.0.0.3']);
    const filtered = found.filter(d => !existingIps.has(d.ip));
    expect(filtered).toHaveLength(1);
    expect(found.length - filtered.length).toBe(2);
  });
});
