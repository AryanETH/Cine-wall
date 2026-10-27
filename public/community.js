'use strict';
(() => {
  const section = document.querySelector('.community-section');
  if (!section) return;
  const group = section.querySelector('.community-group'), clone = group.cloneNode(true);
  clone.setAttribute('aria-hidden', 'true'); clone.inert = true;
  const track = section.querySelector('.community-track');
  track.style.setProperty('--community-duration', `${Math.max(40, group.children.length * 14)}s`);
  track.append(clone);
})();
