'use strict';

// Token firmware costante: nessun Login automatico. Dopo un errore di rete le letture
// vanno in backoff (fail-fast) per non martellare un device wedgato; le scritture no.
jest.mock('axios');
const axios = require('axios');
const xaquaClient = require('../src/services/xaquaClient');

describe('xaquaClient senza login + backoff letture', () => {
  let calls;
  beforeEach(() => {
    calls = [];
    xaquaClient._downUntil = 0;
    xaquaClient._clearCache();
  });

  test('le chiamate usano il token fisso senza Login', async () => {
    axios.post = jest.fn((url, body) => {
      calls.push(url.split('/').filter(Boolean).pop());
      return Promise.resolve({ status: 200, data: { GetTimeResult: 'x' } });
    });
    await xaquaClient.getTime();
    expect(calls).toEqual(['GetTime']);
    expect(axios.post.mock.calls[0][1].token).toBe('1234');
  });

  test('dopo socket hang up le letture falliscono subito, le scritture passano', async () => {
    axios.post = jest.fn((url) => {
      calls.push(url.split('/').filter(Boolean).pop());
      return Promise.reject(new Error('socket hang up'));
    });
    await expect(xaquaClient.getLampStatus()).rejects.toThrow('socket hang up');
    expect(calls).toEqual(['GetLampStatus', 'GetLampStatus']); // 1 retry soft
    calls = [];
    await expect(xaquaClient.getColorSchema()).rejects.toThrow('backoff');
    expect(calls).toEqual([]);
    axios.post = jest.fn((url) => {
      calls.push(url.split('/').filter(Boolean).pop());
      return Promise.resolve({ status: 200, data: {} });
    });
    await xaquaClient.setColorSchema({ Amber: 1, Blue: 1, White: 1, Power: 1 });
    expect(calls).toEqual(['SetColorSchema']);
    expect(xaquaClient._downUntil).toBe(0); // successo azzera il backoff
  });
});
