'use strict';

/**
 * Calcola il valore interpolato di un colore all'interno di una lista di transizioni.
 * Usa interpolazione lineare tra From e To su DeltaSeconds.
 *
 * @param {Array} colorTransitionList - array di {From, To, DeltaSeconds, Time}
 * @param {number} daySec - secondi dalla mezzanotte (0–86399)
 * @returns {object|null} - {Amber, Blue, White, Power} interpolati, o null se lista vuota
 */
function expectedAt(colorTransitionList, daySec) {
  if (!colorTransitionList || !colorTransitionList.length) {
    return null;
  }

  // Normalizza daySec nel range [0, 86400)
  daySec = ((daySec % 86400) + 86400) % 86400;

  // Converti i Time "HH:MM:SS" in secondi dalla mezzanotte
  const transitions = colorTransitionList.map((ct) => {
    const m = ct.Time && ct.Time.match(/(\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const sec = parseInt(m[3], 10);
    const startSec = h * 3600 + min * 60 + sec;
    return {
      startSec,
      From: ct.From,
      To: ct.To,
      DeltaSeconds: ct.DeltaSeconds
    };
  }).filter(t => t !== null);

  if (!transitions.length) {
    return null;
  }

  // Trova la transizione attiva: quella il cui startSec <= daySec < startSec + DeltaSeconds
  let active = null;
  let isWrap = false;
  for (const t of transitions) {
    const endSec = t.startSec + t.DeltaSeconds;
    // Gestisci wrap-around (es. dall'ultimo step di sera al primo di mattina)
    if (endSec > 86400) {
      // Transizione che attraversa la mezzanotte
      if (daySec >= t.startSec || daySec < (endSec % 86400)) {
        active = t;
        isWrap = true;
        break;
      }
    } else {
      // Transizione normale, senza wrap
      if (daySec >= t.startSec && daySec < endSec) {
        active = t;
        isWrap = false;
        break;
      }
    }
  }

  // Se non trovata, usa l'ultima come fallback (ore prima di sunrise)
  if (!active) {
    active = transitions[transitions.length - 1];
    isWrap = false;
  }

  // Interpola linearmente
  let elapsed;
  if (isWrap) {
    // Transizione che attraversa mezzanotte: elapsed = tempo da startSec all'ora attuale
    // Se daySec < startSec, significa che siamo dopo mezzanotte, quindi aggiungi 86400
    if (daySec < active.startSec) {
      elapsed = (86400 - active.startSec) + daySec;
    } else {
      elapsed = daySec - active.startSec;
    }
  } else {
    elapsed = daySec - active.startSec;
  }
  const fraction = Math.min(1, Math.max(0, elapsed / active.DeltaSeconds));

  const interpolate = (from, to) => {
    return Math.round(from + (to - from) * fraction);
  };

  return {
    Amber: interpolate(active.From.Amber, active.To.Amber),
    Blue: interpolate(active.From.Blue, active.To.Blue),
    White: interpolate(active.From.White, active.To.White),
    Power: interpolate(active.From.Power, active.To.Power)
  };
}

module.exports = { expectedAt };
