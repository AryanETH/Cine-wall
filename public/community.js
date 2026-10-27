'use strict';
(() => {
  const section = document.querySelector('.community-section');
  if (!section) return;
  const group = section.querySelector('.community-group'), clone = group.cloneNode(true);
  clone.setAttribute('aria-hidden', 'true'); clone.inert = true;
  section.querySelector('.community-track').append(clone);
  const button = section.querySelector('#pauseCommunity');
  button.addEventListener('click', () => {
    const paused = section.classList.toggle('is-paused');
    button.setAttribute('aria-pressed', String(paused)); button.textContent = paused ? 'Resume motion' : 'Pause motion';
  });
})();
