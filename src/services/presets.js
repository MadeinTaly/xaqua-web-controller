'use strict';

// Profili dal CSV embedded nell'app originale
// Formato: { orario: { condizione: { Amber, Blue, White, Power } } }
// Condizioni diurne: clear, cloudy, rainy
// Condizioni notturne: moonless, crescent, half, full

const PROFILES = {
  // SemiDeep = "Barriera corallina intermedia" (nell'UI "Intermedio")
  SemiDeep: {
    name: 'Barriera corallina intermedia',
    uiName: 'Intermedio',
    schedule: {
      sunrise:   { clear: {A:0,B:100,W:0,P:100},   cloudy: {A:0,B:100,W:0,P:80},    rainy: {A:0,B:100,W:0,P:60} },
      morning:   { clear: {A:0,B:100,W:20,P:100},  cloudy: {A:0,B:100,W:20,P:80},   rainy: {A:0,B:100,W:20,P:60} },
      day:       { clear: {A:100,B:100,W:80,P:100}, cloudy: {A:100,B:100,W:80,P:80}, rainy: {A:100,B:100,W:80,P:60} },
      afternoon: { clear: {A:50,B:100,W:20,P:100},  cloudy: {A:50,B:100,W:20,P:80},  rainy: {A:50,B:100,W:20,P:60} },
      sunset:    { clear: {A:10,B:50,W:5,P:100},    cloudy: {A:10,B:50,W:5,P:80},    rainy: {A:10,B:50,W:5,P:60} },
      evening:   { clear: {A:10,B:50,W:0,P:50},     cloudy: {A:10,B:50,W:0,P:40},    rainy: {A:10,B:50,W:0,P:30} },
      night:     { moonless: {A:0,B:0,W:0,P:1},  crescent: {A:0,B:2,W:0,P:80},  half: {A:0,B:4,W:0,P:80},  full: {A:0,B:8,W:0,P:80} },
      latenight: { moonless: {A:0,B:0,W:0,P:0},  crescent: {A:0,B:100,W:0,P:4}, half: {A:0,B:70,W:70,P:4}, full: {A:0,B:100,W:100,P:4} }
    }
  },

  // Deep = "Barriera corallina superficiale" (nell'UI "Superficiale") — naming invertito nell'originale
  Deep: {
    name: 'Barriera corallina superficiale',
    uiName: 'Superficiale',
    schedule: {
      sunrise:   { clear: {A:0,B:100,W:0,P:100},   cloudy: {A:0,B:100,W:0,P:80},    rainy: {A:0,B:100,W:0,P:60} },
      morning:   { clear: {A:0,B:100,W:30,P:100},  cloudy: {A:0,B:100,W:30,P:80},   rainy: {A:0,B:100,W:30,P:60} },
      day:       { clear: {A:100,B:100,W:100,P:100},cloudy: {A:100,B:100,W:100,P:80},rainy: {A:100,B:100,W:100,P:60} },
      afternoon: { clear: {A:50,B:100,W:50,P:100},  cloudy: {A:50,B:100,W:50,P:80},  rainy: {A:50,B:100,W:50,P:60} },
      sunset:    { clear: {A:10,B:50,W:10,P:100},   cloudy: {A:10,B:50,W:10,P:80},   rainy: {A:10,B:50,W:10,P:60} },
      evening:   { clear: {A:10,B:50,W:0,P:50},     cloudy: {A:10,B:50,W:0,P:40},    rainy: {A:10,B:50,W:0,P:30} },
      night:     { moonless: {A:0,B:0,W:0,P:1},  crescent: {A:0,B:2,W:0,P:80},  half: {A:0,B:4,W:0,P:80},  full: {A:0,B:8,W:0,P:80} },
      latenight: { moonless: {A:0,B:0,W:0,P:0},  crescent: {A:0,B:100,W:0,P:4}, half: {A:0,B:70,W:70,P:4}, full: {A:0,B:100,W:100,P:4} }
    }
  },

  // VeryDeep = "Barriera corallina profonda" (nell'UI "Profondo")
  VeryDeep: {
    name: 'Barriera corallina profonda',
    uiName: 'Profondo',
    schedule: {
      sunrise:   { clear: {A:0,B:100,W:0,P:100},  cloudy: {A:0,B:100,W:0,P:60},   rainy: {A:0,B:100,W:0,P:40} },
      morning:   { clear: {A:0,B:100,W:10,P:100}, cloudy: {A:0,B:100,W:10,P:60},  rainy: {A:0,B:100,W:10,P:40} },
      day:       { clear: {A:50,B:100,W:60,P:100},cloudy: {A:50,B:100,W:60,P:60}, rainy: {A:50,B:100,W:60,P:40} },
      afternoon: { clear: {A:25,B:100,W:10,P:100},cloudy: {A:25,B:100,W:10,P:60}, rainy: {A:25,B:100,W:10,P:40} },
      sunset:    { clear: {A:5,B:50,W:0,P:100},   cloudy: {A:5,B:50,W:0,P:60},    rainy: {A:5,B:50,W:0,P:40} },
      evening:   { clear: {A:5,B:50,W:0,P:50},    cloudy: {A:5,B:50,W:0,P:25},    rainy: {A:5,B:50,W:0,P:10} },
      night:     { moonless: {A:0,B:0,W:0,P:1},  crescent: {A:0,B:2,W:0,P:80},  half: {A:0,B:4,W:0,P:80},  full: {A:0,B:8,W:0,P:80} },
      latenight: { moonless: {A:0,B:0,W:0,P:0},  crescent: {A:0,B:100,W:0,P:4}, half: {A:0,B:70,W:70,P:4}, full: {A:0,B:100,W:100,P:4} }
    }
  },
  // SoftReef = coralli molli, zoanthus, anemoni, qualche Montipora. Usato dal preset 🪸.
  // Utopya: canale Blue = indigo ~420nm, il blu ~450nm arriva dal bianco (phosphor).
  // - spettro blu+bianco dominante, ambra solo estetica: il rosso deprime la
  //   fotofisiologia (Wijgerde 2014, PLOS ONE), il blu induce i pigmenti (D'Angelo 2008, MEPS);
  // - picco al 70%: range moderato per molli/zoa (~100-250 PAR, consenso hobbistico);
  //   conta la luce giornaliera totale, non la durata (Schutter 2012, JMBA).
  // - sunrise/evening/night quasi zero: notte buia e piatta, l'alba sale da sola nel morning.
  // ponytail: Power 70 è un punto di partenza senza misura PAR, tarare con un PAR meter.
  SoftReef: {
    name: 'Coralli molli & zoantidi',
    uiName: 'Molli',
    schedule: {
      sunrise:   { clear: {A:0,B:100,W:0,P:3},    cloudy: {A:0,B:100,W:0,P:3},    rainy: {A:0,B:100,W:0,P:3} },
      morning:   { clear: {A:0,B:100,W:30,P:45},  cloudy: {A:0,B:100,W:30,P:36},  rainy: {A:0,B:100,W:30,P:27} },
      day:       { clear: {A:15,B:100,W:70,P:70}, cloudy: {A:15,B:100,W:70,P:56}, rainy: {A:15,B:100,W:70,P:42} },
      afternoon: { clear: {A:10,B:100,W:60,P:70}, cloudy: {A:10,B:100,W:60,P:56}, rainy: {A:10,B:100,W:60,P:42} },
      sunset:    { clear: {A:5,B:100,W:10,P:25},  cloudy: {A:5,B:100,W:10,P:20},  rainy: {A:5,B:100,W:10,P:15} },
      evening:   { clear: {A:0,B:100,W:0,P:3},    cloudy: {A:0,B:100,W:0,P:3},    rainy: {A:0,B:100,W:0,P:3} },
      night:     { moonless: {A:0,B:0,W:0,P:0},  crescent: {A:0,B:2,W:0,P:80},  half: {A:0,B:4,W:0,P:80},  full: {A:0,B:8,W:0,P:80} },
      latenight: { moonless: {A:0,B:0,W:0,P:0},  crescent: {A:0,B:100,W:0,P:4}, half: {A:0,B:70,W:70,P:4}, full: {A:0,B:100,W:100,P:4} }
    }
  }
};

module.exports = { PROFILES };
