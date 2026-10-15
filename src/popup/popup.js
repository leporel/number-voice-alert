(() => {
  const { MSG, STORAGE, DECIMALS_AUTO } = TTA;
  const { t } = TTAI18n;

  const SAVE_DEBOUNCE_MS = 300;
  const DELETE_CONFIRM_MS = 3000;
  const META_REFRESH_MS = 1000;
  const VOICE_SAMPLE_VALUE = 2388.5;
  const voiceSample = (s) => {
    const sp = TTASpeech.speaker(s);
    return sp.phrase('voiceTest', { value: sp.number(VOICE_SAMPLE_VALUE, 1) });
  };

  const HOST_ORIGINS = chrome.runtime.getManifest().host_permissions;

  const $ = (sel) => document.querySelector(sel);
  const els = {
    list: $('#list'),
    empty: $('#empty'),
    notice: $('#notice'),
    settings: $('.settings'),
    voice: $('#voice'),
    voiceAuto: $('#voice-auto'),
    noVoices: $('#no-voices'),
    template: $('#watcher-tpl'),
    tgChatId: $('[data-field="tgChatId"]'),
    tgStatus: $('#tg-status'),
  };

  let settings = TTA.sanitizeSettings();
  let watchers = [];
  let runtime = {};

  const reportError = (err) => {
    console.error('[TTA]', err);
    showNotice(t('errorGeneric'));
  };

  /**
   * Debounced saver. The popup dies the moment it loses focus and takes pending timers with it,
   * so committed edits (checkbox, select, blur) must call it with immediate=true.
   */
  function createSaver(save, ms) {
    let timer = null;
    const run = () => {
      clearTimeout(timer);
      timer = null;
      save().catch(reportError);
    };
    return (immediate) => {
      if (immediate) {
        run();
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(run, ms);
    };
  }

  const persistSettings = createSaver(() => TTA.saveSettings(settings), SAVE_DEBOUNCE_MS);
  const persistWatchers = createSaver(() => TTA.saveWatchers(watchers), SAVE_DEBOUNCE_MS);

  function showNotice(text) {
    els.notice.textContent = text;
    els.notice.hidden = !text;
  }

  /** Static texts live in data-i18n* attributes so the markup stays language-neutral. */
  function localize(root) {
    root.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
    root.querySelectorAll('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle)));
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)));
  }

  // --- generic form binding: elements with data-field map 1:1 to object keys ---

  const readInput = (el) => (el.type === 'checkbox' ? el.checked : el.value);

  function writeInput(el, value) {
    if (el.type === 'checkbox') el.checked = Boolean(value);
    else el.value = String(value ?? '');
  }

  /** onChange(field, value, committed): `input` while typing, `change` once the edit is final. */
  function bindFields(root, source, onChange) {
    root.querySelectorAll('[data-field]').forEach((el) => {
      writeInput(el, source[el.dataset.field]);
      el.addEventListener('input', () => onChange(el.dataset.field, readInput(el), false));
      el.addEventListener('change', () => onChange(el.dataset.field, readInput(el), true));
    });
  }

  // --- global settings ---

  function renderOutputs() {
    document.querySelectorAll('output[data-out]').forEach((out) => {
      out.textContent = Number(settings[out.dataset.out]).toFixed(2).replace(/\.?0+$/, '');
    });
  }

  // Global switches: each button flips one boolean setting; `off` is its label key when the setting is true.
  const TOGGLES = [
    { key: 'muted', el: $('#mute'), on: 'soundOn', off: 'soundOff' },
    { key: 'paused', el: $('#power'), on: 'powerOn', off: 'powerOff' },
  ];

  function renderToggles() {
    TOGGLES.forEach(({ key, el, on, off }) => {
      el.textContent = t(settings[key] ? off : on);
      el.classList.toggle('off', settings[key]);
    });
  }

  // Created after loadState: the interface language is known only then.
  let languageNames = null;

  function languageName(lang) {
    if (!lang) return t('voiceOther');
    languageNames ??= new Intl.DisplayNames([TTAI18n.getLang()], { type: 'language' });
    let name;
    try {
      name = languageNames.of(lang);
    } catch {
      return lang; // a malformed code reported by some TTS engine must not break the whole voice list
    }
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  function voiceLabel({ voice, gender }) {
    const genderKey = gender === TTASpeech.GENDER.FEMALE ? 'voiceFemale' : 'voiceMale';
    const details = [gender && t(genderKey), voice.remote && t('voiceOnline')].filter(Boolean);
    return details.length ? `${voice.voiceName} (${details.join(', ')})` : voice.voiceName;
  }

  const selectedVoiceLang = () => els.voice.selectedOptions[0]?.dataset.lang ?? '';

  /** Settings saved before the voice language was stored get it filled in from the voice list. */
  function syncVoiceLang() {
    // A saved voice missing from the list (uninstalled, voices failed to load) must keep its stored language.
    if (els.voice.value !== settings.voiceName) return;
    const voiceLang = selectedVoiceLang();
    if (settings.voiceLang === voiceLang) return;
    settings = { ...settings, voiceLang };
    persistSettings(true);
  }

  function voiceGroup({ lang, voices }) {
    const group = document.createElement('optgroup');
    group.label = languageName(lang);
    voices.forEach((entry) => {
      const option = new Option(voiceLabel(entry), entry.voice.voiceName);
      option.dataset.lang = entry.voice.lang ?? '';
      group.append(option);
    });
    return group;
  }

  async function fillVoices() {
    const voices = await TTASpeech.getVoices();
    els.voice.append(...TTASpeech.shortlistVoices(voices, settings.voiceName).map(voiceGroup));
    const autoLang = TTAI18n.resolveLang(settings.uiLang);
    els.voiceAuto.textContent = t('voiceAuto', { lang: languageName(autoLang) });
    // Only the automatic choice can end up without a voice; an explicitly chosen one is in the list.
    const missing = !settings.voiceName && !TTASpeech.findVoice(voices, autoLang);
    els.noVoices.textContent = missing ? t('noVoices', { lang: languageName(autoLang) }) : '';
    els.noVoices.hidden = !missing;
  }

  function bindSettings() {
    bindFields(els.settings, settings, (field, value, committed) => {
      settings = { ...settings, [field]: value };
      if (field === 'uiLang') {
        // Every text in the popup depends on it; reloading is simpler than re-rendering each part.
        if (committed) TTA.saveSettings(settings).then(() => location.reload(), reportError);
        return;
      }
      // The service worker picks the phrase language from the voice language.
      if (field === 'voiceName') settings.voiceLang = selectedVoiceLang();
      renderOutputs();
      persistSettings(committed);
    });
    syncVoiceLang();
    renderOutputs();
    renderToggles();
  }

  // --- watchers ---

  // 4 decimals covers any step a user would type; trailing zeros are noise in a summary.
  const shortNumber = (n) => TTA.formatNumber(n, 4).replace(/[.,]?0+$/, '');

  const channelSuffix = (voice, telegram) => (telegram ? t(voice ? 'summaryTgToo' : 'summaryTgOnly') : '');

  function stepSummary(w) {
    const parts = [];
    if (!TTA.stepActive(w)) parts.push(t('summaryStepOff'));
    else {
      const step =
        w.step > 0 ? t('summaryStep', { step: shortNumber(w.step) + TTA.unitLabel(w.stepUnit) }) : t('summaryEveryChange');
      parts.push(step + channelSuffix(w.stepEnabled, w.tgStep));
    }
    if (TTA.moveActive(w)) {
      const move = t('summaryMove', {
        size: shortNumber(w.moveSize) + TTA.unitLabel(w.moveUnit),
        window: `${w.moveWindow} ${TTA.windowUnitLabel(w.moveWindowUnit)}`,
      });
      parts.push(move + channelSuffix(w.moveEnabled, w.tgMove));
    }
    return parts.join(' · ');
  }

  function secondsAgo(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    return s < 60 ? t('secondsAgo', { n: s }) : t('minutesAgo', { n: Math.round(s / 60) });
  }

  function renderValue(card, w) {
    const rt = runtime[w.id];
    const num = card.querySelector('.num');
    const meta = card.querySelector('.meta');
    const decimals = w.decimals === DECIMALS_AUTO ? (rt?.decimals ?? 0) : w.decimals;
    num.textContent = rt?.value == null ? '—' : TTA.formatNumber(rt.value, decimals);

    let text = t('statusWaiting');
    if (settings.paused) text = t('statusExtensionOff');
    else if (!w.enabled) text = t('statusOff');
    else if (rt?.status === 'lost') text = t('statusLost');
    else if (rt?.status === 'closed') text = t('statusClosed');
    else if (rt?.updatedAt) text = secondsAgo(rt.updatedAt);
    meta.textContent = text;
    const broken = rt?.status === 'lost' || rt?.status === 'closed';
    const tracked = w.enabled && !settings.paused;
    meta.classList.toggle('bad', tracked && broken);
    card.querySelector('[data-action="reconnect"]').hidden = !tracked || (rt?.value != null && !broken);
  }

  const isWaiting = (w) => w.enabled && !settings.paused && runtime[w.id]?.value == null;

  async function reconnect(id) {
    if (!(await ensureSiteAccess())) {
      showNotice(t('noSiteAccess'));
      return;
    }
    const w = watchers.find((x) => x.id === id);
    if (!w) return;
    const reached = await TTA.reconnectWatchers([TTA.sanitizeWatcher(w)]);
    showNotice(reached ? '' : t('noOpenTab', { host: w.host }));
  }

  function updateWatcher(id, patch, committed) {
    watchers = watchers.map((w) => (w.id === id ? { ...w, ...patch } : w));
    persistWatchers(committed);
    return watchers.find((w) => w.id === id);
  }

  function armDelete(btn, id) {
    if (btn.classList.contains('confirm')) {
      watchers = watchers.filter((w) => w.id !== id);
      TTA.saveWatchers(watchers).catch(reportError);
      return;
    }
    btn.classList.add('confirm');
    btn.textContent = t('deleteConfirm');
    setTimeout(() => btn.isConnected && renderList(), DELETE_CONFIRM_MS);
  }

  const CARD_ACTIONS = {
    speak: (id) => chrome.runtime.sendMessage({ type: MSG.SPEAK_NOW, watcherId: id }).catch(reportError),
    repick: (id) => startPick(id).catch(reportError),
    reconnect: (id) => reconnect(id).catch(reportError),
    delete: (id, btn) => armDelete(btn, id),
  };

  function createCard(w) {
    const card = els.template.content.firstElementChild.cloneNode(true);
    card.dataset.id = w.id;
    card.classList.toggle('disabled', !w.enabled);
    card.querySelector('.step-summary').textContent = stepSummary(w);
    card.querySelector('.host').textContent = w.host;

    bindFields(card, w, (field, value, committed) => {
      const next = updateWatcher(w.id, { [field]: value }, committed);
      const clean = TTA.sanitizeWatcher(next);
      card.classList.toggle('disabled', !clean.enabled);
      card.querySelector('.step-summary').textContent = stepSummary(clean);
      renderValue(card, clean);
    });

    card.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault(); // buttons live inside <summary>; don't toggle the details
        CARD_ACTIONS[btn.dataset.action](w.id, btn);
      });
    });
    renderValue(card, w);
    return card;
  }

  function renderList() {
    els.list.replaceChildren(...watchers.map(createCard));
    els.empty.hidden = watchers.length > 0;
  }

  function refreshValues() {
    els.list.querySelectorAll('.card').forEach((card) => {
      const w = watchers.find((x) => x.id === card.dataset.id);
      if (w) renderValue(card, TTA.sanitizeWatcher(w));
    });
  }

  function renderLastPhrase(text) {
    const el = $('#last-phrase');
    el.hidden = !text;
    if (!text) return;
    const quote = document.createElement('q');
    quote.textContent = text;
    el.replaceChildren(t('lastPhrase'), quote);
  }

  // --- shortcuts ---

  const COMMAND_LABELS = { 'toggle-mute': 'cmdMute', 'toggle-pause': 'cmdPause', 'speak-now': 'cmdSpeak' };

  /** Shortcuts have no defaults, so show what the user actually assigned instead of hardcoded keys. */
  async function renderShortcuts() {
    const commands = await chrome.commands.getAll();
    const assigned = commands
      .filter((c) => c.shortcut && COMMAND_LABELS[c.name])
      .map((c) => `${c.shortcut} — ${t(COMMAND_LABELS[c.name])}`);
    $('#shortcut-list').textContent = assigned.length ? assigned.join(' · ') : t('shortcutsNone');
  }

  // --- telegram ---

  /** Runs a Telegram action and shows its outcome next to the Telegram fields, where the user is looking. */
  async function runTelegram(action) {
    els.tgStatus.hidden = false;
    els.tgStatus.textContent = t('tgWait');
    try {
      els.tgStatus.textContent = await action(TTA.sanitizeSettings(settings));
    } catch (err) {
      console.error('[TTA] telegram:', err.message);
      els.tgStatus.textContent = t('tgError', { message: err.message });
    }
  }

  async function findTelegramChat(clean) {
    const chatId = await TTATelegram.findChatId(clean.tgToken);
    if (!chatId) return t('tgNoChat');
    settings = { ...settings, tgChatId: chatId };
    writeInput(els.tgChatId, chatId);
    persistSettings(true);
    return t('tgChatFound', { id: chatId });
  }

  async function sendTelegramTest(clean) {
    await TTATelegram.send(clean, t('tgTestMessage'));
    return t('tgTestSent');
  }

  // --- picking ---

  // Injection is allowed for the active tab via activeTab even if the host isn't in the manifest.
  async function sendPick(tabId, message) {
    if (!(await TTA.sendOrInject(tabId, message))) await chrome.tabs.sendMessage(tabId, message);
  }

  /**
   * Browsers may withhold site access after a reload that widened permissions (Yandex Browser does),
   * so re-request it. Must run inside the click handler: permissions.request needs a user gesture.
   */
  async function ensureSiteAccess() {
    const access = { origins: HOST_ORIGINS };
    return (await chrome.permissions.contains(access)) || chrome.permissions.request(access);
  }

  // No URL pre-check: some Chromium forks don't expose tab.url to the popup,
  // so the injection attempt itself is the reliable test.
  async function startPick(watcherId = null) {
    if (!(await ensureSiteAccess())) {
      showNotice(t('noSiteAccess'));
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) {
      showNotice(t('noActiveTab'));
      return;
    }
    try {
      await sendPick(tab.id, { type: MSG.PICK, watcherId });
    } catch (err) {
      console.error('[TTA] pick failed:', err, tab.url);
      // With <all_urls> granted, a hidden URL means the browser itself blocks extensions on this tab
      // (Yandex Browser's protected mode for banking sites, internal pages, extension store).
      showNotice(tab.url ? t('pickFailed', { url: tab.url, message: err.message }) : t('pickBlocked'));
      return;
    }
    window.close();
  }

  // --- wiring ---

  $('#pick').addEventListener('click', () => startPick().catch(reportError));
  $('#test-voice').addEventListener('click', () => {
    const clean = TTA.sanitizeSettings(settings);
    TTASpeech.speak(voiceSample(clean), clean, { interrupt: true }).catch(reportError);
  });
  $('#tg-find-chat').addEventListener('click', () => runTelegram(findTelegramChat));
  $('#tg-test').addEventListener('click', () => runTelegram(sendTelegramTest));
  TOGGLES.forEach(({ key, el }) =>
    el.addEventListener('click', () => {
      settings = { ...settings, [key]: !settings[key] };
      renderToggles();
      refreshValues();
      TTA.saveSettings(settings).catch(reportError);
    }),
  );
  $('#shortcuts').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(reportError);
  });

  const sameIds = (a, b) => a.length === b.length && a.every((w, i) => w.id === b[i].id);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes[STORAGE.RUNTIME]) {
      runtime = changes[STORAGE.RUNTIME].newValue ?? {};
      refreshValues();
    }
    if (area === 'session' && changes[STORAGE.LAST_PHRASE]) renderLastPhrase(changes[STORAGE.LAST_PHRASE].newValue);
    if (area !== 'local') return;
    if (changes[STORAGE.SETTINGS]) {
      // Only the global switches can change from outside (hotkeys); other fields are edited here.
      const { muted, paused } = TTA.sanitizeSettings(changes[STORAGE.SETTINGS].newValue);
      settings = { ...settings, muted, paused };
      renderToggles();
      refreshValues();
    }
    if (changes[STORAGE.WATCHERS]) {
      const next = (changes[STORAGE.WATCHERS].newValue ?? []).map(TTA.sanitizeWatcher);
      // Re-render only on add/remove so typing in a card doesn't lose focus on our own saves.
      if (!sameIds(next, watchers)) {
        watchers = next;
        renderList();
      }
    }
  });

  async function init() {
    const [state, session] = await Promise.all([
      TTA.loadState(),
      chrome.storage.session.get([STORAGE.RUNTIME, STORAGE.LAST_PHRASE]),
    ]);
    // loadState has switched the language; the card template is localized once, before cards are cloned from it.
    document.documentElement.lang = TTAI18n.getLang();
    localize(document);
    localize(els.template.content);
    renderLastPhrase(session[STORAGE.LAST_PHRASE]);
    settings = state.settings;
    watchers = state.watchers;
    runtime = session[STORAGE.RUNTIME] ?? {};
    // A broken voice list must not leave the settings form unbound (it would silently stop saving).
    await fillVoices().catch((err) => {
      console.error('[TTA] voices unavailable:', err);
      els.noVoices.textContent = t('noVoices', { lang: languageName(TTAI18n.getLang()) });
      els.noVoices.hidden = false;
    });
    bindSettings();
    renderList();
    // Values that never arrived usually mean an orphaned content script; try reviving it right away.
    const waiting = watchers.filter(isWaiting);
    if (waiting.length) TTA.reconnectWatchers(waiting).catch(reportError);
    renderShortcuts().catch(reportError);
    setInterval(refreshValues, META_REFRESH_MS);
  }

  init().catch(reportError);
})();
