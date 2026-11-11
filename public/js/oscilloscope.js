'use strict';
// Oscilloscopio: visualizza live il colore della lampada vs il valore atteso dal schedule.
// Poll ogni 15s, grafico canvas con ultimi ~40 campioni, serie in 4 canali.

(function () {
  function $(id) { return document.getElementById(id); }

  const HISTORY_SIZE = 40;
  const POLL_INTERVAL = 60000; // = giro di healthMonitor lato server (la pagina legge la sua cache)
  const CHANNEL_COLORS = {
    A: { real: '#d97706', exp: 'rgba(217, 119, 6, 0.4)' }, // amber
    B: { real: '#2563eb', exp: 'rgba(37, 99, 235, 0.4)' },  // blue
    W: { real: '#6b7280', exp: 'rgba(107, 114, 128, 0.4)' }, // white
    P: { real: '#dc2626', exp: 'rgba(220, 38, 38, 0.4)' }   // power (red)
  };

  let history = [];
  let timer = null;
  let canvas = $('osc-canvas');
  let ctx = canvas ? canvas.getContext('2d') : null;

  function resizeCanvas() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * (window.devicePixelRatio || 1);
    canvas.height = rect.height * (window.devicePixelRatio || 1);
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
  }

  function drawGraph() {
    if (!canvas || !ctx || history.length < 2) return;
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    const padding = { top: 30, bottom: 50, left: 50, right: 20 };
    const graphW = w - padding.left - padding.right;
    const graphH = h - padding.top - padding.bottom;

    // Sfondo
    ctx.fillStyle = 'rgba(15, 23, 42, 0.3)';
    ctx.fillRect(0, 0, w, h);

    // Griglia
    ctx.strokeStyle = 'rgba(75, 85, 99, 0.2)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (graphH * i / 4);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();
    }

    // Etichette asse Y (0–100)
    ctx.fillStyle = 'rgba(107, 114, 128, 0.6)';
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const val = (4 - i) * 25;
      const y = padding.top + (graphH * i / 4) + 4;
      ctx.fillText(val, padding.left - 8, y);
    }

    // Scala per ogni punto
    const xScale = graphW / (HISTORY_SIZE - 1);
    const yScale = graphH / 100;

    // Funzione per disegnare una serie
    function drawSeries(channel, isExp) {
      const data = history.map(h => {
        const val = isExp ? (h.expected && h.expected[channel]) : h.current[channel];
        return val !== undefined ? val : 0;
      });

      const color = isExp ? CHANNEL_COLORS[channel].exp : CHANNEL_COLORS[channel].real;
      ctx.strokeStyle = color;
      ctx.lineWidth = isExp ? 2 : 2.5;
      if (isExp) ctx.setLineDash([5, 3]);
      else ctx.setLineDash([]);

      ctx.beginPath();
      data.forEach((val, i) => {
        const x = padding.left + i * xScale;
        const y = padding.top + graphH - val * yScale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Disegna attesi prima (sotto), poi reali (sopra)
    ['A', 'B', 'W', 'P'].forEach(ch => {
      drawSeries(ch, true);
      drawSeries(ch, false);
    });

    // Legenda
    ctx.setLineDash([]);
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    const legend = [
      { text: 'Amber reale', color: CHANNEL_COLORS.A.real },
      { text: 'Blue reale', color: CHANNEL_COLORS.B.real },
      { text: 'White reale', color: CHANNEL_COLORS.W.real },
      { text: 'Power reale', color: CHANNEL_COLORS.P.real }
    ];
    let lx = padding.left;
    legend.forEach((l, i) => {
      ctx.fillStyle = l.color;
      ctx.fillRect(lx, h - 35, 10, 10);
      ctx.fillStyle = 'rgba(107, 114, 128, 0.8)';
      ctx.fillText(l.text, lx + 15, h - 27);
      lx += 140;
      if (lx > w - padding.right - 100) {
        lx = padding.left;
      }
    });
  }

  function updateUI(sample) {
    const timeMatch = sample.lampTime && sample.lampTime.match(/(\d{2}):(\d{2}):(\d{2})/);
    if (timeMatch) {
      $('osc-time').textContent = `${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3]}`;
    }

    $('osc-dev').textContent = sample.deviation.toFixed(1);

    const icon = sample.ok ? '✓' : '✕';
    const iconColor = sample.ok ? 'text-green-500' : 'text-red-500';
    const textColor = sample.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
    $('osc-ok-icon').textContent = icon;
    $('osc-ok-icon').className = 'text-2xl font-bold ' + iconColor;
    $('osc-ok-text').textContent = sample.ok ? 'OK' : 'ERRORE';
    $('osc-ok-text').className = 'font-bold ' + textColor;

    // Valori numerici attuali
    $('osc-am-real').textContent = sample.current.A;
    $('osc-bl-real').textContent = sample.current.B;
    $('osc-wh-real').textContent = sample.current.W;
    $('osc-pw-real').textContent = sample.current.P;

    if (sample.expected) {
      $('osc-am-exp').textContent = sample.expected.A;
      $('osc-bl-exp').textContent = sample.expected.B;
      $('osc-wh-exp').textContent = sample.expected.W;
      $('osc-pw-exp').textContent = sample.expected.P;
    } else {
      $('osc-am-exp').textContent = $('osc-bl-exp').textContent = $('osc-wh-exp').textContent = $('osc-pw-exp').textContent = 'n/a';
    }

    $('osc-count').textContent = history.length;
  }

  async function sample() {
    if (!$('osc-running').checked) return;

    try {
      const tol = parseInt($('osc-tol').value) || 8;
      const r = await fetch(`/api/oscilloscope/sample?tol=${tol}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();

      if (!data.ok && data.error) {
        history.push({ current: { A: 0, B: 0, W: 0, P: 0 }, expected: null, error: data.error });
      } else {
        history.push({
          lampTime: data.lampTime,
          current: data.current,
          expected: data.expected,
          deviation: data.deviation,
          ok: data.ok
        });
      }

      if (history.length > HISTORY_SIZE) {
        history = history.slice(-HISTORY_SIZE);
      }

      if (history.length > 0) {
        updateUI(history[history.length - 1]);
        drawGraph();
      }
    } catch (e) {
      console.error('Errore polling:', e.message);
    }
  }

  function toggleRunning() {
    const running = $('osc-running').checked;
    if (running && !timer) {
      sample(); // campiona subito
      timer = setInterval(sample, POLL_INTERVAL);
    } else if (!running && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function boot() {
    resizeCanvas();
    window.addEventListener('resize', () => {
      resizeCanvas();
      if (history.length > 0) drawGraph();
    });

    $('osc-running').onchange = toggleRunning;
    $('osc-tol').onchange = sample;

    // Avvia il polling se la checkbox è checked
    if ($('osc-running').checked) {
      toggleRunning();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
