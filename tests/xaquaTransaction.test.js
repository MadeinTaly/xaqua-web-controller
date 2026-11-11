'use strict';

// Il firmware regge UNA connessione alla volta: la sequenza two-phase deve essere
// atomica rispetto alla coda, altrimenti un poll si infila tra due step e il device
// va in reboot.
jest.mock('axios');
const axios = require('axios');
const xaquaClient = require('../src/services/xaquaClient');

describe('xaquaClient.transaction', () => {
  let order;
  let inFlight;
  let maxInFlight;

  beforeEach(() => {
    order = [];
    inFlight = 0;
    maxInFlight = 0;
    xaquaClient.token = 'test-token';
    axios.post = jest.fn((url, body) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(url.split('/').filter(Boolean).pop());
      return new Promise((resolve) => setTimeout(() => {
        inFlight--;
        resolve({ status: 200, data: {} });
      }, 5));
    });
  });

  test('nessuna richiesta esterna si intercala dentro una transazione', async () => {
    const tx = xaquaClient.transaction(async () => {
      await xaquaClient.post('TxA/');
      await new Promise(r => setTimeout(r, 30));
      await xaquaClient.post('TxB/');
    });
    // richiesta "poll" emessa mentre la transazione è in corso
    const poll = xaquaClient.post('Poll/');
    await Promise.all([tx, poll]);

    expect(order).toEqual(['TxA', 'TxB', 'Poll']);
  });

  test('mai due richieste in volo contemporaneamente', async () => {
    await Promise.all([
      xaquaClient.transaction(async () => {
        await xaquaClient.post('One/');
        await xaquaClient.post('Two/');
      }),
      xaquaClient.post('Three/'),
      xaquaClient.post('Four/')
    ]);
    expect(maxInFlight).toBe(1);
  });

  test('transazioni annidate non vanno in deadlock', async () => {
    const res = await xaquaClient.transaction(async () => {
      return xaquaClient.transaction(async () => {
        await xaquaClient.post('Nested/');
        return 'ok';
      });
    });
    expect(res).toBe('ok');
    expect(order).toEqual(['Nested']);
  });

  test('un errore dentro la transazione non blocca la coda', async () => {
    await expect(xaquaClient.transaction(async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');
    await xaquaClient.post('After/');
    expect(order).toEqual(['After']);
  });
});
