'use strict';

// Read-only ambient light: reuse page reads and poll only when no page supplies color.
(function () {
  const root = document.documentElement;
  const nativeFetch = window.fetch.bind(window);
  let lastRead = 0;
  let lampOff = false;
  let pending = false;
  let color = null;
  const valid = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const level = value => Math.max(0, Math.min(100, Number(value))) / 100;

  function paint() {
    if (!color || lampOff) {
      root.style.setProperty('--water-strength', '0');
      return;
    }
    const a = level(color.Amber), b = level(color.Blue), w = level(color.White), p = level(color.Power);
    const rgb = [a * 255 + w * 255, a * 150 + w * 255 + b * 60, b * 255 + w * 255];
    const peak = Math.max(...rgb, 1);
    root.style.setProperty('--water-color', rgb.map(value => Math.round(value / peak * 255)).join(' '));
    root.style.setProperty('--water-strength', String(Math.min(1, Math.max(a, b, w) * p)));
  }

  function accept(data) {
    if (data && ['Amber', 'Blue', 'White', 'Power'].every(key => valid(data[key]))) {
      color = data;
      lastRead = Date.now();
      paint();
    } else {
      color = null;
      paint();
    }
  }

  window.fetch = function (input, init) {
    const path = typeof input === 'string' ? input.split('?')[0] : '';
    const method = (init && init.method || 'GET').toUpperCase();
    const colorRead = method === 'GET' && ['/api/home', '/api/color'].includes(path);
    return nativeFetch(input, init).then(response => {
      if (colorRead && !response.ok) accept(null);
      if (response.ok && ['/api/home', '/api/color', '/api/power'].includes(path)) {
        response.clone().json().then(data => {
          if (path === '/api/home' && method === 'GET') {
            lampOff = !!data.lampOff;
            accept(data.color);
          } else if (path === '/api/color' && method === 'GET') {
            accept(data);
          } else if (path === '/api/power') {
            if (method === 'GET' && typeof data.lampOff === 'boolean') lampOff = data.lampOff;
            else if (method === 'POST' && data.ok && init && typeof init.body === 'string') {
              const body = JSON.parse(init.body);
              if (typeof body.on === 'boolean') lampOff = !body.on;
            }
            paint();
          }
        }).catch(() => { if (colorRead) accept(null); });
      }
      return response;
    }).catch(error => {
      if (colorRead) accept(null);
      throw error;
    });
  };

  async function refresh() {
    if (pending || document.hidden || Date.now() - lastRead < 25000) return;
    pending = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      // /api/home senza fresh = cache del server (ultimo giro healthMonitor): zero chiamate al firmware.
      const response = await nativeFetch('/api/home', { signal: controller.signal });
      if (!response.ok) throw new Error('Color unavailable');
      const data = await response.json();
      lampOff = !!data.lampOff;
      accept(data.color);
    } catch (error) { accept(null); }
    finally { clearTimeout(timeout); pending = false; }
  }

  // The home already polls the same cached snapshot; don't duplicate it there.
  if (!document.getElementById('home-refresh')) {
    setTimeout(refresh, 1500);
    setInterval(refresh, 30000);
  }
  document.addEventListener('visibilitychange', () => {
    root.classList.toggle('water-paused', document.hidden);
    if (!document.hidden && !document.getElementById('home-refresh')) refresh();
  });
})();
