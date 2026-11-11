'use strict';

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const colors = {
    success: 'bg-emerald-600',
    error:   'bg-red-600',
    info:    'bg-blue-600'
  };
  toast.className = `toast ${colors[type] || colors.info}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Indicatore stato device: poll /api/ping ~30s -> aggiorna i pallini .dev-dot
function pollDeviceStatus() {
  fetch('/api/ping').then((r) => r.json()).then((d) => {
    const on = !!d.online;
    document.querySelectorAll('.dev-dot').forEach((el) => {
      el.classList.remove('bg-gray-400', 'bg-emerald-500', 'bg-red-500');
      el.classList.add(on ? 'bg-emerald-500' : 'bg-red-500');
      el.title = on ? ('Lampada online' + (d.name ? ' · ' + d.name : '')) : 'Lampada offline';
    });
    document.querySelectorAll('.dev-dot-label').forEach((el) => { el.textContent = on ? 'online' : 'offline'; });
  }).catch(() => {
    document.querySelectorAll('.dev-dot').forEach((el) => {
      el.classList.remove('bg-gray-400', 'bg-emerald-500'); el.classList.add('bg-red-500');
    });
  });
}
pollDeviceStatus();
setInterval(pollDeviceStatus, 30000);
