'use strict';

(function () {
  const byId = id => document.getElementById(id);
  let statusLoading = false;
  let wledLoading = false;
  let wledSaving = false;
  const channels = ['amber', 'blue', 'white', 'power'];
  const numeric = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const percent = value => numeric(value) ? Math.max(0, Math.min(100, Number(value))) : null;
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function request(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error('Richiesta non riuscita');
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  function renderStatus(data) {
    const available = !!(data.info || data.status || data.color || data.time);
    const complete = !!(data.status && data.color && data.time);
    byId('device-name').textContent = data.info && data.info.Name || (available ? 'Plafoniera Xaqua' : 'Plafoniera non raggiungibile');
    const badge = byId('home-live-status');
    badge.dataset.state = complete ? 'live' : 'error';
    badge.textContent = !available ? 'Non disponibile' : !complete ? 'Dati parziali' : data.lampOff ? 'Spenta' : 'Connessa';
    byId('stat-temp').textContent = data.status && numeric(data.status.Temperature) ? Number(data.status.Temperature).toFixed(1) : '—';
    byId('stat-fan').textContent = data.status && numeric(data.status.FanSpeed) ? data.status.FanSpeed : '—';
    byId('stat-time').textContent = typeof data.time === 'string' ? (data.time.split(' - ')[1] || data.time) : '—';
    channels.forEach(channel => {
      const key = channel[0].toUpperCase() + channel.slice(1);
      const value = data.color ? percent(data.color[key]) : null;
      byId('color-' + channel + '-preview').textContent = value === null ? '—' : value;
      byId('channel-' + channel + '-fill').style.width = (value || 0) + '%';
      if (channel !== 'power') byId('light-instrument').style.setProperty('--' + channel + '-level', data.lampOff ? 0 : (value || 0) / 100);
    });
    byId('home-update-status').textContent = !available ? 'Verifica la connessione nelle impostazioni, poi aggiorna.' : !complete ? 'Alcune letture non sono disponibili. Riprova con Aggiorna.' : 'Aggiornato alle ' + new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }

  // fresh=true solo dal bottone Aggiorna: lettura vera dal firmware. L'auto-refresh legge la
  // cache del server (ultimo giro di healthMonitor), zero chiamate alla lampada.
  async function loadStatus(fresh) {
    if (statusLoading) return;
    statusLoading = true;
    byId('home-refresh').disabled = true;
    byId('light-instrument').setAttribute('aria-busy', 'true');
    try { renderStatus(await request(fresh === true ? '/api/home?fresh=1' : '/api/home')); }
    catch (error) { renderStatus({}); }
    finally {
      statusLoading = false;
      byId('home-refresh').disabled = false;
      byId('light-instrument').setAttribute('aria-busy', 'false');
    }
  }

  async function loadWledGlance() {
    if (wledLoading || wledSaving) return;
    wledLoading = true;
    const wrap = byId('wled-glance-wrap');
    try {
      const data = await request('/api/wled/devices');
      const devices = data.devices || [];
      wrap.classList.toggle('hidden', !devices.length);
      if (!devices.length) return;
      await Promise.all(devices.map(async dev => {
        try { dev._next = (await request('/api/wled/' + encodeURIComponent(dev.id) + '/next')).next || null; }
        catch (error) { dev._nextError = true; }
      }));
      if (wledSaving) return;
      byId('wled-glance').innerHTML = devices.map(dev => {
        const online = !!dev.online;
        const white = percent(dev.white);
        const blue = percent(dev.blue);
        const next = dev._next;
        const nextText = dev._nextError ? 'Non disponibile' : !next ? 'Nessuna fascia' : next.time + ' · ' + (next.on ? 'Bianco ' + (next.white || 0) + '% / Blu ' + (next.blue || 0) + '%' : 'Spento');
        const id = esc(dev.id);
        return '<article class="home-wled-card"><div class="home-wled-top"><div><h3>' + esc(dev.name || dev.deviceName || 'WLED') + '</h3><span class="home-wled-state" data-online="' + online + '"><i></i>' + (online ? dev.on ? 'Acceso' : 'Spento' : 'Offline') + '</span></div><div class="home-wled-next">Prossima fascia<strong>' + esc(nextText) + '</strong></div></div>'
          + (online ? '<div class="home-wled-channels"><span>Bianco ' + (white === null ? '—' : white + '%') + '</span><span>Blu ' + (blue === null ? '—' : blue + '%') + '</span></div><div class="home-wled-controls" aria-label="Comandi per ' + esc(dev.name || 'WLED') + '"><button type="button" class="wg-set" data-id="' + id + '" data-w="100" data-b="0">Bianco</button><button type="button" class="wg-set" data-id="' + id + '" data-w="0" data-b="100">Blu</button><button type="button" class="wg-set" data-id="' + id + '" data-w="0" data-b="0">Spegni</button></div>' : '') + '</article>';
      }).join('');
    } catch (error) {
      wrap.classList.remove('hidden');
      byId('wled-glance').innerHTML = '<p class="home-wled-error" role="status">Dispositivi WLED non disponibili. Premi Aggiorna per riprovare.</p>';
    } finally { wledLoading = false; }
  }

  byId('wled-glance').addEventListener('click', async event => {
    const button = event.target.closest('.wg-set');
    if (!button || wledSaving) return;
    wledSaving = true;
    const controls = byId('wled-glance').querySelectorAll('.wg-set');
    controls.forEach(control => { control.disabled = true; });
    const white = Number(button.dataset.w);
    const blue = Number(button.dataset.b);
    try {
      await request('/api/wled/' + encodeURIComponent(button.dataset.id) + '/state', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: white + blue > 0, white, blue, brightness: 100 })
      });
      if (typeof showToast === 'function') showToast('Impostato', 'success');
      setTimeout(loadWledGlance, 400);
    } catch (error) {
      if (typeof showToast === 'function') showToast('Comando non riuscito. Riprova.', 'error');
    } finally {
      wledSaving = false;
      controls.forEach(control => { control.disabled = false; });
    }
  });

  byId('home-refresh').addEventListener('click', () => { loadStatus(true); loadWledGlance(); });
  loadStatus();
  loadWledGlance();
  setInterval(loadStatus, 30000);
  setInterval(loadWledGlance, 30000);
})();
