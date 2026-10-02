'use strict';

(() => {
  const storageKey = 'cinewall-theme-v4';
  const root = document.documentElement;

  function storedTheme() {
    try {
      const value = localStorage.getItem(storageKey);
      return value === 'light' || value === 'dark' ? value : 'light';
    } catch {
      return 'light';
    }
  }

  function updateButtons() {
    const current = root.dataset.theme === 'light' ? 'light' : 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      const icon = button.querySelector('[data-theme-icon]');
      const label = button.querySelector('[data-theme-label]');
      button.setAttribute('aria-label', `Switch to ${next} theme`);
      button.setAttribute('title', `Switch to ${next} theme`);
      button.setAttribute('aria-pressed', String(current === 'light'));
      if (icon) icon.innerHTML = current === 'dark' ? '&#xE706;' : '&#xE708;';
      if (label) label.textContent = current === 'dark' ? 'Light' : 'Dark';
      if (!button.dataset.themeBound) {
        button.dataset.themeBound = 'true';
        button.addEventListener('click', () => {
          setTheme(root.dataset.theme === 'light' ? 'dark' : 'light');
        });
      }
    });
  }

  function setTheme(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem(storageKey, next); } catch { /* Theme still works for this page. */ }
    updateButtons();
  }

  root.dataset.theme = storedTheme();
  window.CineWallTheme = { set: setTheme, get: () => root.dataset.theme };

  window.addEventListener('storage', (event) => {
    if (event.key === storageKey && (event.newValue === 'light' || event.newValue === 'dark')) {
      root.dataset.theme = event.newValue;
      updateButtons();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    updateButtons();
  });
})();
