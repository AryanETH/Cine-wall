'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  const status = $('#adsStatus');
  const login = $('#adsLogin');
  const dashboard = $('#adsDashboard');
  const settings = $('#adSettings');
  let data;
  let busy = false;
  function notify(message, error = false) {
    status.textContent = message;
    status.toggleAttribute('data-error', error);
    status.setAttribute('role', error ? 'alert' : 'status');
  }
  async function api(path, method = 'GET', value, contentType = 'application/json') {
    const response = await fetch('/advt/api/' + path, {
      method, cache: 'no-store', headers: value === undefined ? undefined : { 'Content-Type': contentType },
      body: value === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(value) : value,
    });
    if (response.status === 401 && dashboard) location.replace('/advt');
    const body = await response.json();
    if (!response.ok) throw Error(body.error || 'Request failed.');
    return body;
  }
  async function run(action, button) {
    if (busy) return;
    busy = true;
    if (button) button.disabled = true;
    try { await action(); }
    catch (error) { notify(error.message, true); }
    finally { busy = false; if (button) button.disabled = false; }
  }
  if (login) {
    login.addEventListener('submit', event => {
      event.preventDefault();
      void run(async () => {
        const input = $('#adsPassword');
        await api('login', 'POST', { password: input.value });
        input.value = '';
        location.replace('/advt');
      }, login.querySelector('button'));
    });
    return;
  }
  function element(tag, text) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    return node;
  }
  const formats = [
    ['skippable', 'Skippable · after 5s'],
    ['standard', 'Non-skippable · ≤15s'],
    ['bumper', 'Bumper · ≤6s'],
  ];
  function select(values, value, label) {
    const node = element('select');
    node.setAttribute('aria-label', label);
    for (const [id, name] of values) {
      const option = element('option', name);
      option.value = id;
      node.append(option);
    }
    node.value = value;
    return node;
  }
  function currentDraft() {
    return {
      enabled: $('#adsEnabled').checked,
      formUrl: $('#adFormUrl').value.trim(),
      slots: [...$('#adSlots').querySelectorAll('fieldset')].map(slot => ({
        creativeId: slot.querySelector('select').value,
        format: slot.querySelector('select:last-child').value,
      })),
    };
  }
  function render(draft = data) {
    $('#adsEnabled').checked = draft.enabled;
    $('#adFormUrl').value = draft.formUrl;
    $('#adSlots').replaceChildren();
    const choices = [['', 'No ad'], ...data.creatives.map(ad => [ad.id, ad.title + ' · ' + ad.duration + 's'])];
    for (let i = 0; i < 3; i++) {
      const slot = draft.slots[i];
      const row = element('fieldset');
      const format = select(formats, slot?.format || 'skippable', 'Format for slot ' + (i + 1));
      const video = select(choices, slot?.creativeId || '', 'Video for slot ' + (i + 1));
      format.disabled = !video.value;
      video.addEventListener('change', () => { format.disabled = !video.value; });
      row.append(element('legend', 'Slot ' + (i + 1)), video, format);
      $('#adSlots').append(row);
    }
    $('#adLibrary').replaceChildren(...data.creatives.map(ad => {
      const row = element('li', ad.title + ' · ' + ad.duration + 's ');
      const preview = element('a', 'Preview');
      preview.href = '/advt/api/media/' + ad.id;
      preview.target = '_blank';
      preview.rel = 'noopener';
      const remove = element('button', 'Remove');
      remove.type = 'button';
      remove.className = 'quiet';
      remove.setAttribute('aria-label', 'Remove ' + ad.title);
      remove.addEventListener('click', () => {
        if (!confirm('Remove “' + ad.title + '” from the ad library?')) return;
        void run(async () => {
          const draft = currentDraft();
          data = await api('creative/' + ad.id, 'DELETE');
          draft.slots = draft.slots.map(slot => slot.creativeId === ad.id ? { ...slot, creativeId: '' } : slot);
          render(draft);
          notify('Video removed.');
        }, remove);
      });
      row.append(preview, remove);
      return row;
    }));
  }
  $('#adsLogout').addEventListener('click', () => void run(async () => {
    await api('logout', 'POST', {});
    location.replace('/advt');
  }, $('#adsLogout')));
  $('#uploadAd').addEventListener('submit', event => {
    event.preventDefault();
    void run(async () => {
      const file = $('#adFile').files[0];
      if (!file || file.size > 25 * 1024 * 1024) throw Error('Choose an MP4 no larger than 25 MiB.');
      const draft = currentDraft();
      notify('Uploading and validating video…');
      data = await api('creative?title=' + encodeURIComponent($('#adTitle').value), 'POST', file, 'video/mp4');
      render(draft);
      event.target.reset();
      notify('Video ready.');
    }, event.submitter);
  });
  settings.addEventListener('submit', event => {
    event.preventDefault();
    void run(async () => {
      const draft = currentDraft();
      draft.slots = draft.slots.filter(slot => slot.creativeId);
      data = await api('settings', 'POST', draft);
      render();
      notify(data.enabled ? 'Pre-roll ads are enabled.' : 'Settings saved. Pre-roll ads are off.');
    }, event.submitter);
  });
  void run(async () => { data = await api('settings'); render(); notify(''); });
})();

