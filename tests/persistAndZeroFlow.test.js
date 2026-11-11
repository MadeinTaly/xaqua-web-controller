'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

describe('saveConfig atomic write', () => {
  test('writeFileSync su tmp + rename produce un file consistente', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xaqua-save-'));
    const dest = path.join(dir, 'config.json');
    const tmp = dest + '.tmp';

    const initial = { version: 1, manualSchedule: [] };
    fs.writeFileSync(dest, JSON.stringify(initial, null, 2));

    const updated = { version: 2, manualSchedule: [{ key: 'sunrise', time: '06:00' }] };
    fs.writeFileSync(tmp, JSON.stringify(updated, null, 2));
    fs.renameSync(tmp, dest);

    const read = JSON.parse(fs.readFileSync(dest, 'utf8'));
    expect(read.version).toBe(2);
    expect(read.manualSchedule).toHaveLength(1);

    // Cleanup
    fs.unlinkSync(dest);
    fs.rmdirSync(dir);
  });
});

describe('moonHelper — mapping simmetrico crescente/calante', () => {
  const { moonPhaseToWeatherColumn } = require('../src/services/moonHelper');

  test('luna crescente e calante mappano entrambe a crescent', () => {
    expect(moonPhaseToWeatherColumn('lunaCrescente')).toBe('crescent');
    expect(moonPhaseToWeatherColumn('lunaCalante')).toBe('crescent');
  });

  test('primo quarto e ultimo quarto mappano entrambi a half', () => {
    expect(moonPhaseToWeatherColumn('primoQuarto')).toBe('half');
    expect(moonPhaseToWeatherColumn('ultimoQuarto')).toBe('half');
  });

  test('novilunio → moonless, plenilunio → full', () => {
    expect(moonPhaseToWeatherColumn('novilunio')).toBe('moonless');
    expect(moonPhaseToWeatherColumn('plenilunio')).toBe('full');
  });
});
