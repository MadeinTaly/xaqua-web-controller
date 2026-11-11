'use strict';

// Luna nuova di riferimento (Apr 10, 2026 12:00 UTC — confermata astronomica)
const REF_NEW_MOON = new Date('2026-04-10T12:00:00Z');
const SYNODIC_PERIOD = 29.53059; // giorni — ciclo sinodico medio

function calculateMoonAge(date) {
  const daysSinceRef = (date.getTime() - REF_NEW_MOON.getTime()) / (1000 * 60 * 60 * 24);
  const age = ((daysSinceRef % SYNODIC_PERIOD) + SYNODIC_PERIOD) % SYNODIC_PERIOD;
  return age;
}

function calculateMoonPhase(date) {
  const age = calculateMoonAge(date);

  if (age <= 1 || age >= 29) return 'novilunio';
  if (age <= 7) return 'lunaCrescente';
  if (age <= 14) return 'primoQuarto';
  if (age <= 16) return 'plenilunio';
  if (age <= 22) return 'ultimoQuarto';
  return 'lunaCalante';
}

// Mappa simmetrica: fasi crescenti e calanti usano gli stessi livelli di luce
// (novilunio→half→full→half→novilunio). Prima il ramo calante mappava tutto a 'half'
// rendendo asimmetrico il ciclo lunare di 29 giorni.
function moonPhaseToWeatherColumn(phase) {
  switch (phase) {
    case 'novilunio':     return 'moonless';
    case 'lunaCrescente': return 'crescent';
    case 'primoQuarto':   return 'half';
    case 'plenilunio':    return 'full';
    case 'ultimoQuarto':  return 'half';
    case 'lunaCalante':   return 'crescent';
    default:              return 'moonless';
  }
}

module.exports = { calculateMoonPhase, calculateMoonAge, moonPhaseToWeatherColumn };