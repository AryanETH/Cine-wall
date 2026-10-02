'use strict';

const busy = document.querySelector('#launcherBusy');
const supportModal = document.querySelector('#supportModal');
const supportForm = document.querySelector('#supportForm');
const supportQrResult = document.querySelector('#supportQrResult');
const supportAmount = document.querySelector('#supportAmount');

function closeSupport() {
  supportModal.hidden = true;
  document.body.classList.remove('modal-open');
}

function openSupport() {
  supportModal.hidden = false;
  document.body.classList.add('modal-open');
  supportForm.hidden = false;
  supportQrResult.hidden = true;
  setTimeout(() => supportAmount.focus(), 0);
}

document.querySelector('#openSupport').addEventListener('click', openSupport);
document.querySelector('#closeSupport').addEventListener('click', closeSupport);
supportModal.addEventListener('click', (event) => {
  if (event.target === supportModal) closeSupport();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !supportModal.hidden) closeSupport();
});

supportForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const amount = Math.round(Number(supportAmount.value) * 100) / 100;
  if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
    supportAmount.setCustomValidity('Enter an amount between ₹1 and ₹1,00,000.');
    supportAmount.reportValidity();
    return;
  }
  supportAmount.setCustomValidity('');
  const upiUrl = `upi://pay?pa=${encodeURIComponent('6260976807-3@ybl')}&pn=${encodeURIComponent('CineWall Project')}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent('Support CineWall')}`;
  document.querySelector('#supportQr').src = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=12&data=${encodeURIComponent(upiUrl)}`;
  document.querySelector('#supportQrAmount').textContent = `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.querySelector('#openUpiApp').href = upiUrl;
  supportForm.hidden = true;
  supportQrResult.hidden = false;
});

supportAmount.addEventListener('input', () => supportAmount.setCustomValidity(''));
document.querySelector('#changeSupportAmount').addEventListener('click', () => {
  supportQrResult.hidden = true;
  supportForm.hidden = false;
  supportAmount.focus();
});

document.querySelector('.mode-grid').addEventListener('click', async (event) => {
  const card = event.target.closest('[data-session-mode]');
  if (!card) return;
  
  // Prevent clicking on coming-soon cards
  if (event.target.closest('.coming-soon')) return;
  
  const sessionMode = card.dataset.sessionMode;
  busy.hidden = false;
  try {
    const response = await fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'session-mode', sessionMode }),
    });
    if (!response.ok) throw new Error('Mode could not start');
    const dashboard = `/admin.html?mode=${encodeURIComponent(sessionMode)}`;
    location.href = window.CineWallSession?.link(dashboard) || dashboard;
  } catch {
    busy.hidden = true;
    document.querySelector('#launcherConnection').classList.remove('online');
    document.querySelector('#launcherConnection span:last-child').textContent = 'Server unavailable';
  }
});

fetch('/api/status', { cache: 'no-store' })
  .then((response) => {
    if (!response.ok) throw new Error();
    document.querySelector('#launcherConnection').classList.add('online');
  })
  .catch(() => {
    document.querySelector('#launcherConnection span:last-child').textContent = 'Server unavailable';
  });
