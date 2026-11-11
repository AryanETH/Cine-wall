'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  const status = $('#adsStatus');
  const login = $('#adsLogin');
  const dashboard = $('#adsDashboard');
  const settings = $('#adSettings');
  const push = $('#pushAds');
  const pauseAds = $('#pauseAds');
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
    const body = await response.json().catch(() => ({}));
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
      formUrl: $('#adFormUrl').value.trim(),
      slots: [...$('#adSlots').querySelectorAll('fieldset')].flatMap(slot => {
        const creativeId = slot.querySelector('[name="creativeId"]')?.value;
        const format = slot.querySelector('[name="format"]')?.value;
        return creativeId && format ? [{ creativeId, format }] : [];
      }),
    };
  }
  function renderCampaign() {
    const live = $('#campaignStatus');
    live.textContent = data.enabled ? 'Ads live' : data.published ? 'Ads paused' : 'No ads pushed';
    live.toggleAttribute('data-live', data.enabled);
    pauseAds.hidden = !data.enabled;
    const campaign = data.published;
    const names = campaign?.slots.map(slot => slot.title).join(' · ');
    const date = campaign?.at ? new Date(campaign.at).toLocaleString() : '';
    $('#campaignDetails').textContent = [names, date && 'Pushed ' + date].filter(Boolean).join(' | ');
  }
  function render(draft = data) {
    renderCampaign();
    $('#adFormUrl').value = draft.formUrl;
    $('#adSlots').replaceChildren();
    const choices = [['', 'No ad'], ...data.creatives.map(ad => [ad.id, ad.title + ' · ' + ad.duration + 's'])];
    
    // Only show slots that have content or if we have less than 3 slots
    const activeSlots = draft.slots.filter(s => s?.creativeId);
    const slotsToShow = Math.max(activeSlots.length + (activeSlots.length < 3 ? 1 : 0), 1);
    push.disabled = !activeSlots.length;
    
    for (let i = 0; i < Math.min(slotsToShow, 3); i++) {
      const slot = draft.slots[i];
      const row = element('fieldset');
      const format = select(formats, slot?.format || 'skippable', 'Format for slot ' + (i + 1));
      const video = select(choices, slot?.creativeId || '', 'Video for slot ' + (i + 1));
      format.name = 'format';
      video.name = 'creativeId';
      format.disabled = !video.value;
      video.addEventListener('change', () => { 
        format.disabled = !video.value;
        render(currentDraft());
      });
      
      const controls = element('div');
      controls.className = 'slot-controls';
      controls.append(video, format);
      
      // Add X button if slot has content
      if (video.value) {
        const removeBtn = element('button', '×');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-slot';
        removeBtn.setAttribute('aria-label', 'Remove slot ' + (i + 1));
        removeBtn.addEventListener('click', () => {
          const updated = currentDraft();
          updated.slots.splice(i, 1);
          render(updated);
        });
        controls.append(removeBtn);
      }
      
      row.append(element('legend', 'Slot ' + (i + 1)), controls);
      $('#adSlots').append(row);
    }
    
    $('#adLibrary').replaceChildren(...data.creatives.map(ad => {
      const row = element('li');
      const info = element('div');
      info.className = 'ad-info';
      const title = element('strong', ad.title);
      const meta = element('span', ad.duration + 's');
      meta.className = 'ad-meta';
      info.append(title);
      if (ad.description) {
        info.append(element('br'), element('span', ad.description));
      }
      info.append(element('br'), meta);
      if (ad.clickUrl) info.append(element('br'), element('span', ad.clickUrl));
      
      // Add trim info if trimmed
      if (ad.trimStart > 0 || ad.trimEnd < ad.originalDuration) {
        const trimInfo = element('span', ` (trimmed from ${ad.originalDuration}s)`);
        trimInfo.style.fontSize = '.85rem';
        trimInfo.style.color = '#8b95a3';
        info.append(element('br'), trimInfo);
      }
      
      const actions = element('div');
      actions.className = 'ad-actions';
      
      const preview = element('a', 'Preview');
      preview.href = '/advt/api/media/' + ad.id;
      preview.target = '_blank';
      preview.rel = 'noopener';
      const editLink = element('button', ad.clickUrl ? 'Edit link' : 'Add link');
      editLink.type = 'button';
      editLink.className = 'quiet';
      editLink.addEventListener('click', () => openAdLink(ad));
      
      if (ad.originalDuration > .5) {
        const trim = element('button', 'Trim');
        trim.type = 'button';
        trim.className = 'quiet';
        trim.addEventListener('click', () => showTrimDialog(ad));
        actions.append(trim);
      }
      
      const remove = element('button', 'Remove');
      remove.type = 'button';
      remove.className = 'quiet';
      remove.setAttribute('aria-label', 'Remove ' + ad.title);
      remove.addEventListener('click', () => {
        if (!confirm('Remove "' + ad.title + '" from the ad library?')) return;
        void run(async () => {
          const draft = currentDraft();
          data = await api('creative/' + ad.id, 'DELETE');
          draft.slots = draft.slots.filter(slot => slot.creativeId !== ad.id);
          render(draft);
          notify('Video removed.');
        }, remove);
      });
      actions.append(editLink, preview, remove);
      row.append(info, actions);
      return row;
    }));
    
    // Update logo preview
    if (data.logo) {
      $('#logoPreview').src = '/advt/api/logo?t=' + Date.now();
      $('#logoPreview').hidden = false;
      $('#removeLogo').hidden = false;
    } else {
      $('#logoPreview').hidden = true;
      $('#removeLogo').hidden = true;
    }
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
      const title = $('#adTitle').value;
      const description = $('#adDescription').value.trim();
      const params = new URLSearchParams({ title });
      if (description) params.set('description', description);
      const clickUrl = $('#adClickUrl').value.trim();
      if (clickUrl) params.set('clickUrl', clickUrl);
      data = await api('creative?' + params.toString(), 'POST', file, 'video/mp4');
      render(draft);
      event.target.reset();
      notify('Video ready.');
    }, event.submitter);
  });
  settings.addEventListener('submit', event => {
    event.preventDefault();
    void run(async () => {
      const draft = currentDraft();
      notify('Pushing ads…');
      const published = await api('publish', 'POST', draft);
      if (!published.enabled || !published.published?.id) throw Error('The server did not confirm the push. Reload and check the campaign status.');
      data = published;
      render();
      const total = data.published.slots.length;
      notify(total === 1 ? 'Ad pushed successfully. One slot is live.' : 'Ads pushed successfully. ' + total + ' slots are live.');
    }, event.submitter);
  });
  pauseAds.addEventListener('click', () => void run(async () => {
    const draft = currentDraft();
    data = await api('pause', 'POST', {});
    render(draft);
    notify('Ads paused for upcoming breaks.');
  }, pauseAds));
  $('#saveAdForm').addEventListener('click', event => {
    const input = $('#adFormUrl');
    if (!input.reportValidity()) return;
    void run(async () => {
      const draft = currentDraft();
      data = await api('contact', 'POST', { formUrl: draft.formUrl });
      render({ ...draft, formUrl: data.formUrl });
      notify('Advertiser contact link saved.');
    }, event.currentTarget);
  });
  
  $('#uploadLogo').addEventListener('submit', event => {
    event.preventDefault();
    void run(async () => {
      const file = $('#logoFile').files[0];
      if (!file || file.size > 2 * 1024 * 1024) throw Error('Choose a PNG, JPG, or WebP no larger than 2 MiB.');
      const draft = currentDraft();
      notify('Uploading logo…');
      data = await api('logo', 'POST', file, file.type);
      render(draft);
      event.target.reset();
      notify('Logo uploaded.');
    }, event.submitter);
  });
  
  $('#removeLogo').addEventListener('click', () => {
    if (!confirm('Remove the logo from all ads?')) return;
    void run(async () => {
      const draft = currentDraft();
      data = await api('logo', 'DELETE');
      render(draft);
      notify('Logo removed.');
    }, $('#removeLogo'));
  });
  
  const linkDialog = $('#adLinkDialog');
  const linkStatus = $('#adLinkStatus');
  let linkCreative;
  function openAdLink(ad) {
    linkCreative = ad.id;
    $('#adLinkHeading').textContent = 'Website for ' + ad.title;
    $('#adLinkValue').value = ad.clickUrl || '';
    linkStatus.textContent = '';
    linkStatus.removeAttribute('data-error');
    linkDialog.showModal();
  }
  $('#adLinkForm').addEventListener('submit', event => {
    event.preventDefault();
    void run(async () => {
      const draft = currentDraft();
      try {
        data = await api('creative/' + linkCreative + '/link', 'POST', { clickUrl: $('#adLinkValue').value.trim() });
        linkDialog.close();
        render(draft);
        notify('Link saved. Push the ad to publish it on the video wall.');
      } catch (error) {
        linkStatus.textContent = error.message;
        linkStatus.setAttribute('data-error', '');
      }
    }, event.submitter);
  });
  $('#adLinkCancel').addEventListener('click', () => { if (!busy) linkDialog.close(); });
  linkDialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });

  const dialog = $('#trimDialog');
  const trimForm = $('#trimForm');
  const trimStart = $('#trimStart');
  const trimLength = $('#trimLength');
  const trimPreview = $('#trimPreview');
  const trimStatus = $('#trimStatus');
  const presets = [...$('#trimPresets').querySelectorAll('button')];
  let trimming;
  const rounded = value => Math.round(value * 1000) / 1000;
  function updateTrim(seek = false) {
    const maxStart = Math.max(0, rounded(trimming.originalDuration - trimLength.valueAsNumber));
    trimStart.max = String(maxStart);
    if (trimStart.valueAsNumber > maxStart) trimStart.value = maxStart;
    const start = trimStart.valueAsNumber;
    const end = rounded(start + trimLength.valueAsNumber);
    $('#trimRange').textContent = Number.isFinite(end) ? 'Keep ' + start + 's–' + end + 's' : '';
    if (seek && trimPreview.readyState && Number.isFinite(start)) trimPreview.currentTime = start;
  }
  function showTrimDialog(ad) {
    trimming = ad;
    $('#trimHeading').textContent = 'Trim ' + ad.title;
    $('#trimSource').textContent = 'Original video: ' + ad.originalDuration + 's';
    trimLength.max = Math.min(ad.originalDuration, 60);
    trimLength.value = Math.min(ad.duration, 60);
    trimStart.value = ad.trimStart;
    trimStatus.textContent = '';
    trimStatus.removeAttribute('data-error');
    $('#trimRestore').hidden = !ad.trimFile || ad.originalDuration > 60;
    for (const button of presets) button.disabled = Number(button.dataset.duration) > ad.originalDuration;
    trimPreview.src = '/advt/api/media/' + ad.id + '?original=1';
    updateTrim();
    dialog.showModal();
  }
  function applyTrim(startTime, duration, button) {
    if (busy) return;
    const ad = trimming;
    void run(async () => {
      const draft = currentDraft();
      trimStatus.removeAttribute('data-error');
      trimStatus.textContent = 'Preparing the clip…';
      try {
        data = await api('creative/' + ad.id + '/trim', 'POST', { duration, startTime });
        dialog.close();
        render(draft);
        notify('Video saved at ' + duration + 's.');
      } catch (error) {
        trimStatus.textContent = error.message;
        trimStatus.setAttribute('data-error', '');
      }
    }, button);
  }
  for (const button of presets) button.addEventListener('click', () => {
    trimLength.value = button.dataset.duration;
    updateTrim(true);
  });
  trimStart.addEventListener('input', () => updateTrim(true));
  trimLength.addEventListener('input', () => updateTrim(true));
  trimPreview.addEventListener('loadedmetadata', () => updateTrim(true));
  trimPreview.addEventListener('timeupdate', () => {
    if (!trimPreview.paused && trimPreview.currentTime >= trimStart.valueAsNumber + trimLength.valueAsNumber) trimPreview.pause();
  });
  trimForm.addEventListener('submit', event => {
    event.preventDefault();
    applyTrim(trimStart.valueAsNumber, trimLength.valueAsNumber, event.submitter);
  });
  $('#trimRestore').addEventListener('click', event => applyTrim(0, trimming.originalDuration, event.currentTarget));
  $('#trimCancel').addEventListener('click', () => { if (!busy) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    trimPreview.pause();
    trimPreview.removeAttribute('src');
    trimPreview.load();
  });
  
  const analyticsDays = $('#analyticsDays');
  const analyticsStatus = $('#analyticsStatus');
  const number = new Intl.NumberFormat();
  const count = value => number.format(value);
  const percent = (value, base) => base ? (100 * value / base).toFixed(1) + '%' : '—';
  let analyticsRequest = 0;
  async function refreshAnalytics() {
    const id = ++analyticsRequest;
    analyticsStatus.textContent = 'Loading analytics…';
    analyticsStatus.removeAttribute('data-error');
    $('#analyticsTable').hidden = true;
    $('#analyticsSummary').replaceChildren();
    try {
      const { totals, creatives } = await api('analytics?days=' + analyticsDays.value);
      if (id !== analyticsRequest) return;
      const cards = [
        ['Impressions', count(totals.impressions)], ['Clicks', count(totals.clicks)],
        ['CTR', percent(totals.clicks, totals.impressions)], ['Completed', count(totals.completed)],
        ['Completion rate', percent(totals.completed, totals.impressions)], ['Skipped', count(totals.skipped)],
      ];
      $('#analyticsSummary').replaceChildren(...cards.map(([label, value]) => {
        const card = element('div');
        card.append(element('dt', label), element('dd', value));
        return card;
      }));
      $('#analyticsRows').replaceChildren(...creatives.map(ad => {
        const row = element('tr');
        const title = element('th', ad.title);
        title.scope = 'row';
        row.append(title);
        for (const value of [count(ad.served), count(ad.impressions), count(ad.clicks), percent(ad.clicks, ad.impressions),
          count(ad.q25), count(ad.q50), count(ad.q75), count(ad.completed), count(ad.skipped), count(ad.failed)]) {
          row.append(element('td', value));
        }
        return row;
      }));
      $('#analyticsTable').hidden = creatives.length === 0;
      analyticsStatus.textContent = creatives.length ? '' : 'No ad activity in this period yet.';
    } catch (error) {
      if (id !== analyticsRequest) return;
      analyticsStatus.textContent = error.message;
      analyticsStatus.setAttribute('data-error', '');
    }
  }
  analyticsDays.addEventListener('change', refreshAnalytics);
  $('#refreshAnalytics').addEventListener('click', refreshAnalytics);
  void run(async () => { data = await api('settings'); render(); notify(''); });
  void refreshAnalytics();
})();
