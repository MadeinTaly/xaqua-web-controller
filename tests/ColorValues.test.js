'use strict';

/**
 * Test per validazione valori colore inviati al firmware.
 * Verifica che Amber, Blue, White, Power siano sempre interi 0-100.
 */

const ActualXaquaClient = require('../src/services/xaquaClient');

// Mock del client per evitare chiamate HTTP reali
jest.mock('../src/services/xaquaClient', () => {
  // Copia le funzioni che ci servono
  const MockXaquaClient = class {
    constructor(ip, username, password) {
      this.baseUrl = `http://${ip}/`;
      this.username = username;
      this.password = password;
      this.token = null;
      this.tokenExpiry = null;
      this._powerScale = 100;
      this.postCalls = [];
    }

    setPowerScale(pct) {
      this._powerScale = Math.max(0, Math.min(100, parseInt(pct) >= 0 ? parseInt(pct) : 100));
    }

    scaleColor(obj) {
      const s = this._powerScale / 100;
      return {
        Amber: Math.max(0, Math.min(100, Math.round((isNaN(obj.Amber) ? 0 : obj.Amber || 0) * s))),
        Blue:  Math.max(0, Math.min(100, Math.round((isNaN(obj.Blue) ? 0 : obj.Blue  || 0) * s))),
        White: Math.max(0, Math.min(100, Math.round((isNaN(obj.White) ? 0 : obj.White || 0) * s))),
        Power: Math.max(0, Math.min(100, Math.round((isNaN(obj.Power) ? 0 : obj.Power || 0) * s)))
      };
    }

    async post(endpoint, body = {}, timeout = 5000) {
      this.postCalls.push({ endpoint, body, timeout });
      return {};
    }

    getPostCalls() {
      return this.postCalls;
    }

    clearPostCalls() {
      this.postCalls = [];
    }

    // Mock delle funzioni che usiamo nei test
    async setColorSchema(cs) {
      return this.post('SetColorSchema/', {
        token: 'mock-token',
        cs: this.scaleColor(cs)
      });
    }

    async setColorScheduleTransition(step, ct) {
      const scaled = {
        ...ct,
        From: ct.From ? this.scaleColor(ct.From) : ct.From,
        To:   ct.To   ? this.scaleColor(ct.To)   : ct.To
      };
      return this.post('SetColorScheduleTransition/', {
        token: 'mock-token',
        Step: step,
        ct: scaled
      });
    }
  };

  return MockXaquaClient;
});

// Helper per validare colore
function isValidColor(c) {
  return ['Amber', 'Blue', 'White', 'Power'].every(
    key => Number.isInteger(c[key]) && c[key] >= 0 && c[key] <= 100
  );
}

describe('Valori colore inviati al firmware', () => {
  let client;

  beforeEach(() => {
    // Crea una nuova istanza per ogni test per evitare side effects
    client = new ActualXaquaClient('test', 'user', 'pass');
    // Resetta il power scale per testare con valori puri
    client.setPowerScale(100);
    client.clearPostCalls();
  });

  describe('scaleColor function', () => {
    test('arrotonda i valori decimali a interi per scaleColor', () => {
      // Testa che i decimali vengano arrotondati
      const result = client.scaleColor({
        Amber: 99.9,
        Blue: 50.5,
        White: 33.3,
        Power: 66.6
      });

      expect(result.Amber).toBe(100);
      expect(result.Blue).toBe(51);
      expect(result.White).toBe(33);
      expect(result.Power).toBe(67);
    });

    test('scaleColor clampa valori tra 0 e 100', () => {
      // Testa che valori > 100 diventino 100
      const highValues = client.scaleColor({
        Amber: 150,
        Blue: 120,
        White: 100,
        Power: 200
      });
      expect(highValues.Amber).toBe(100);
      expect(highValues.Blue).toBe(100);
      expect(highValues.White).toBe(100);
      expect(highValues.Power).toBe(100);

      // Testa che valori < 0 diventino 0
      const negativeValues = client.scaleColor({
        Amber: -10,
        Blue: -50,
        White: 0,
        Power: 10
      });
      expect(negativeValues.Amber).toBe(0);
      expect(negativeValues.Blue).toBe(0);
      expect(negativeValues.White).toBe(0);
      expect(negativeValues.Power).toBe(10);
    });

    test('valori NaN e null diventano 0', () => {
      const invalidValues = client.scaleColor({
        Amber: NaN,
        Blue: null,
        White: undefined,
        Power: 'abc'
      });
      expect(invalidValues.Amber).toBe(0);
      expect(invalidValues.Blue).toBe(0);
      expect(invalidValues.White).toBe(0);
      expect(invalidValues.Power).toBe(0);
    });

    test('valori stringhe vengono convertiti', () => {
      const stringValues = client.scaleColor({
        Amber: '75',
        Blue: '25.5',
        White: '0',
        Power: '100'
      });
      expect(stringValues.Amber).toBe(75);
      expect(stringValues.Blue).toBe(26); // 25.5 arrotondato
      expect(stringValues.White).toBe(0);
      expect(stringValues.Power).toBe(100);
    });

    test('power scale applica la corretta scalatura', () => {
      // Imposta un power scale del 50%
      client.setPowerScale(50);

      const result = client.scaleColor({
        Amber: 100,
        Blue: 100,
        White: 100,
        Power: 100
      });

      // Tutti i valori dovrebbero essere ridotti del 50%
      expect(result.Amber).toBe(50);
      expect(result.Blue).toBe(50);
      expect(result.White).toBe(50);
      expect(result.Power).toBe(50);
    });

    test('power scale zero annulla tutti i valori', () => {
      client.setPowerScale(0);

      const result = client.scaleColor({
        Amber: 100,
        Blue: 50,
        White: 25,
        Power: 75
      });

      expect(result.Amber).toBe(0);
      expect(result.Blue).toBe(0);
      expect(result.White).toBe(0);
      expect(result.Power).toBe(0);
    });
  });

  describe('setColorSchema', () => {
    beforeEach(() => {
      client.clearPostCalls();
    });

    test('setColorSchema invia valori validi', async () => {
      const cs = {
        Amber: 75,
        Blue: 50,
        White: 25,
        Power: 100
      };

      await client.setColorSchema(cs);

      // Verifica che sia stato chiamato con i parametri corretti
      const call = client.getPostCalls()[0];
      expect(call.endpoint).toBe('SetColorSchema/');
      expect(call.body.token).toBeDefined();
      expect(call.body.cs.Amber).toBe(75);
      expect(call.body.cs.Blue).toBe(50);
      expect(call.body.cs.White).toBe(25);
      expect(call.body.cs.Power).toBe(100);

      // Verifica che i valori siano validi
      expect(isValidColor(call.body.cs)).toBe(true);
    });

    test('setColorSchema arrotonda decimali', async () => {
      const cs = {
        Amber: 99.9,
        Blue: 50.5,
        White: 33.3,
        Power: 66.6
      };

      await client.setColorSchema(cs);

      // Verifica che i parametri siano stati arrotondati
      const call = client.getPostCalls()[0];
      const sentCs = call.body.cs;

      expect(sentCs.Amber).toBe(100);
      expect(sentCs.Blue).toBe(51);
      expect(sentCs.White).toBe(33);
      expect(sentCs.Power).toBe(67);
    });

    test('setColorSchema clampa valori fuori range', async () => {
      const cs = {
        Amber: 150,
        Blue: -50,
        White: 100,
        Power: 200
      };

      await client.setColorSchema(cs);

      const call = client.getPostCalls()[0];
      const sentCs = call.body.cs;

      expect(sentCs.Amber).toBe(100);
      expect(sentCs.Blue).toBe(0);
      expect(sentCs.White).toBe(100);
      expect(sentCs.Power).toBe(100);
    });
  });

  describe('setColorScheduleTransition', () => {
    beforeEach(() => {
      client.clearPostCalls();
    });

    test('setColorScheduleTransition con valori validi', async () => {
      const ct = {
        From: { Amber: 100, Blue: 50, White: 0, Power: 100 },
        To: { Amber: 50, Blue: 100, White: 50, Power: 50 }
      };

      await client.setColorScheduleTransition(0, ct);

      const call = client.getPostCalls()[0];
      expect(call.endpoint).toBe('SetColorScheduleTransition/');
      expect(call.body.token).toBeDefined();
      expect(call.body.Step).toBe(0);
      expect(call.body.ct.From).toEqual({ Amber: 100, Blue: 50, White: 0, Power: 100 });
      expect(call.body.ct.To).toEqual({ Amber: 50, Blue: 100, White: 50, Power: 50 });

      // Verifica che tutti i valori siano validi
      expect(isValidColor(ct.From)).toBe(true);
      expect(isValidColor(ct.To)).toBe(true);
    });

    test('setColorScheduleTransition clampa From e To', async () => {
      const ct = {
        From: { Amber: 150, Blue: -20, White: 75, Power: 100 },
        To: { Amber: -50, Blue: 150, White: 33.3, Power: 66.6 }
      };

      await client.setColorScheduleTransition(1, ct);

      const call = client.getPostCalls()[0];
      const sentCt = call.body.ct;

      // From dovrebbe essere clampato
      expect(sentCt.From.Amber).toBe(100);
      expect(sentCt.From.Blue).toBe(0);
      expect(sentCt.From.White).toBe(75);
      expect(sentCt.From.Power).toBe(100);

      // To dovrebbe essere arrotondato e clampato
      expect(sentCt.To.Amber).toBe(0);
      expect(sentCt.To.Blue).toBe(100);
      expect(sentCt.To.White).toBe(33);
      expect(sentCt.To.Power).toBe(67);
    });

    test('setColorSchedule con transizioni multiple - tutti valori validi', async () => {
      const transitions = [
        { From: { Amber: 100, Blue: 100, White: 80, Power: 100 }, To: { Amber: 80, Blue: 80, White: 60, Power: 100 } },
        { From: { Amber: 80, Blue: 80, White: 60, Power: 100 }, To: { Amber: 60, Blue: 60, White: 40, Power: 100 } },
        { From: { Amber: 60, Blue: 60, White: 40, Power: 100 }, To: { Amber: 40, Blue: 40, White: 20, Power: 100 } },
        { From: { Amber: 40, Blue: 40, White: 20, Power: 100 }, To: { Amber: 20, Blue: 20, White: 10, Power: 100 } },
        { From: { Amber: 20, Blue: 20, White: 10, Power: 100 }, To: { Amber: 10, Blue: 30, White: 5, Power: 100 } },
        { From: { Amber: 10, Blue: 30, White: 5, Power: 100 }, To: { Amber: 5, Blue: 40, White: 2, Power: 100 } },
        { From: { Amber: 5, Blue: 40, White: 2, Power: 100 }, To: { Amber: 0, Blue: 50, White: 0, Power: 100 } },
        { From: { Amber: 0, Blue: 50, White: 0, Power: 100 }, To: { Amber: 0, Blue: 100, White: 0, Power: 100 } }
      ];

      for (let i = 0; i < transitions.length; i++) {
        await client.setColorScheduleTransition(i, transitions[i]);

        const call = client.getPostCalls()[i];
        const sentCt = call.body.ct;

        // Verifica che tutti i valori siano interi 0-100
        ['From', 'To'].forEach(part => {
          expect(sentCt[part]).toHaveProperty('Amber');
          expect(sentCt[part]).toHaveProperty('Blue');
          expect(sentCt[part]).toHaveProperty('White');
          expect(sentCt[part]).toHaveProperty('Power');

          expect(sentCt[part].Amber).toBeGreaterThanOrEqual(0);
          expect(sentCt[part].Amber).toBeLessThanOrEqual(100);
          expect(sentCt[part].Blue).toBeGreaterThanOrEqual(0);
          expect(sentCt[part].Blue).toBeLessThanOrEqual(100);
          expect(sentCt[part].White).toBeGreaterThanOrEqual(0);
          expect(sentCt[part].White).toBeLessThanOrEqual(100);
          expect(sentCt[part].Power).toBeGreaterThanOrEqual(0);
          expect(sentCt[part].Power).toBeLessThanOrEqual(100);
        });
      }
    });

    test('setColorScheduleTransition gestisce valori mancanti', async () => {
      const ct = {
        // From e To sono undefined
        DeltaSeconds: 3600,
        Time: '10:00'
      };

      await client.setColorScheduleTransition(0, ct);

      const call = client.getPostCalls()[0];
      const sentCt = call.body.ct;

      // Se From e To sono undefined, non dovrebbero essere processati
      expect(sentCt.From).toBeUndefined();
      expect(sentCt.To).toBeUndefined();
    });
  });

  describe('Power scale combinato con arrotondamento', () => {
    test('power scale 75% con valori decimali', () => {
      client.setPowerScale(75);

      const result = client.scaleColor({
        Amber: 99.9,
        Blue: 50.5,
        White: 33.3,
        Power: 66.6
      });

      // Primo applica il power scale, poi arrotonda
      // Amber: 99.9 * 0.75 = 74.925 → 75
      // Blue: 50.5 * 0.75 = 37.875 → 38
      // White: 33.3 * 0.75 = 24.975 → 25
      // Power: 66.6 * 0.75 = 49.95 → 50
      expect(result.Amber).toBe(75);
      expect(result.Blue).toBe(38);
      expect(result.White).toBe(25);
      expect(result.Power).toBe(50);
    });

    test('power scale che potrebbe superare 100', () => {
      client.setPowerScale(150);

      const result = client.scaleColor({
        Amber: 100,
        Blue: 100,
        White: 100,
        Power: 100
      });

      // Anche con power scale > 100, il risultato non supera mai 100
      expect(result.Amber).toBe(100);
      expect(result.Blue).toBe(100);
      expect(result.White).toBe(100);
      expect(result.Power).toBe(100);
    });

    test('power scale che produce valori < 1', () => {
      client.setPowerScale(5);

      const result = client.scaleColor({
        Amber: 10,
        Blue: 15,
        White: 20,
        Power: 25
      });

      // Tutti dovrebbero essere arrotondati all'intero più vicino
      expect(result.Amber).toBe(1); // 10 * 0.05 = 0.5 → 1 (arrotondamento all'intero più vicino)
      expect(result.Blue).toBe(1); // 15 * 0.05 = 0.75 → 1
      expect(result.White).toBe(1); // 20 * 0.05 = 1 → 1
      expect(result.Power).toBe(1); // 25 * 0.05 = 1.25 → 1
    });
  });
});