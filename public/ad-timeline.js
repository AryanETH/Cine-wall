'use strict';

window.CineWallAdTimeline = function createAdTimeline(input, container, formatTime) {
  let previous = '';
  return function renderAdTimeline(state, duration) {
    const breaks = state?.sessionMode === 'video' && state.adScheduleEnabled && duration > 0
      ? (state.adBreaks || []).filter(item => Number.isFinite(item.position) && item.position >= 0 && item.position <= duration)
      : [];
    const signature = breaks.length ? JSON.stringify([duration, ...breaks.map(item => [item.position, item.shown])]) : '';
    if (signature === previous) return;
    previous = signature;
    container.replaceChildren(...breaks.map(item => {
      const marker = document.createElement('span');
      marker.className = 'timeline-marker';
      marker.classList.toggle('is-shown', item.shown);
      marker.style.left = item.position / duration * 100 + '%';
      return marker;
    }));
    const upcoming = breaks.filter(item => !item.shown).map(item => formatTime(item.position));
    if (upcoming.length) input.setAttribute('aria-description', 'Upcoming ads at ' + upcoming.join(', '));
    else input.removeAttribute('aria-description');
  };
};
