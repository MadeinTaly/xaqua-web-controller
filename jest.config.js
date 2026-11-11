/**
 * Jest configuration per xaqua-web.
 *
 * Configurazione parallelizzata con isolamento del config:
 * - setupFiles esegue tests/setup.js PRIMA di ogni test suite
 * - setup.js crea una tmp directory per-worker e setta XAQUA_CONFIG_PATH env
 * - Consente esecuzione parallela senza --runInBand e senza sporcare data/config.json
 *
 * forceExit: true è necessario perché alcuni test (scheduler, api) lasciano
 * setInterval/Promise aperti. I test passano, ma i timer rimangono attivi.
 * Alternativa: aggiungere .unref() agli interval e teardown esplicito nei describe.
 */

module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setup.js'],
  testTimeout: 10000,
  forceExit: true,
};
