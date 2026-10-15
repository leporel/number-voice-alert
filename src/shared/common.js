// Shared between the service worker (importScripts), content scripts and the popup.
// Classic script instead of an ES module because MV3 content scripts can't use static imports.
(() => {
  if (globalThis.TTA) return;

  const { t, isSupported, setLang } = TTAI18n;

  const MSG = Object.freeze({
    VALUE: 'tta:value',
    STATUS: 'tta:status',
    PICK: 'tta:pick',
    SPEAK_NOW: 'tta:speak-now',
    RESYNC: 'tta:resync',
  });

  const STORAGE = Object.freeze({
    SETTINGS: 'settings',
    WATCHERS: 'watchers',
    RUNTIME: 'runtime', // chrome.storage.session: last values, survives SW restarts but not browser restarts
    LAST_PHRASE: 'lastPhrase', // chrome.storage.session: exact text sent to TTS, shown in the popup
  });

  const STEP_UNIT = Object.freeze({ ABS: 'abs', PCT: 'pct' });

  // Length of one unit of the "sharp move" window, in seconds.
  const WINDOW_UNIT_SEC = Object.freeze({ s: 1, m: 60, h: 3600 });
  const windowUnitLabel = (unit) => t(`unit_${unit}`);

  const unitLabel = (unit) => (unit === STEP_UNIT.PCT ? '%' : ` ${t('unitPt')}`);

  // decimals === AUTO keeps the precision shown on the page.
  const DECIMALS_AUTO = -1;

  const DEFAULT_SETTINGS = Object.freeze({
    paused: false,
    muted: false,
    uiLang: '', // empty = follow the browser language
    voiceName: '',
    voiceLang: '', // language of the chosen voice; decides the language of spoken phrases
    rate: 1.1,
    pitch: 1,
    volume: 1,
    template: '{name} {value}',
    cooldownSec: 5,
    announceOnStart: true,
    lostAlert: true,
    heartbeatMin: 0,
    highlight: true,
    speakFraction: false,
    tgToken: '',
    tgChatId: '',
  });

  const DEFAULT_WATCHER = Object.freeze({
    name: '',
    host: '',
    selector: '',
    enabled: true,
    speakName: true,
    step: 1,
    stepUnit: STEP_UNIT.ABS,
    snapToGrid: true,
    decimals: DECIMALS_AUTO,
    skipDigits: 0,
    trackFraction: false,
    stepEnabled: true,
    tgStep: false,
    moveEnabled: false,
    tgMove: false,
    moveSize: 1,
    moveUnit: STEP_UNIT.PCT,
    moveWindow: 5,
    moveWindowUnit: 'm',
  });

  const LIMITS = Object.freeze({
    rate: [0.5, 3],
    pitch: [0.5, 2],
    volume: [0, 1],
    cooldownSec: [0, 600],
    heartbeatMin: [0, 240],
    step: [0, 1e9],
    decimals: [DECIMALS_AUTO, 6],
    skipDigits: [0, 9],
    moveWindow: [1, 1440],
    moveWindowSec: [1, 86400], // a day; longer windows would need far more history than session storage should hold
    nameLength: 40,
    templateLength: 120,
    selectorLength: 2000,
    tgTokenLength: 100,
    tgChatIdLength: 64,
  });

  const clamp = (n, [min, max], fallback) => {
    const v = Number(n);
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  };

  const str = (s, maxLen, fallback = '') => (typeof s === 'string' ? s.slice(0, maxLen) : fallback);

  // BCP 47-ish tag as reported by chrome.tts: "en-US", "ru-RU", "zh-CN".
  const LANG_TAG_RE = /^[a-z]{2,3}([-_][a-z0-9]{2,8})*$/i;

  const BOT_TOKEN_RE = /\d+:[\w-]{30,}/;
  const BOT_TOKEN_EXACT_RE = new RegExp(`^${BOT_TOKEN_RE.source}$`);
  const isBotToken = (s) => typeof s === 'string' && BOT_TOKEN_EXACT_RE.test(s);
  // Numeric id of a user/group or @username of a public channel.
  const isChatId = (s) => typeof s === 'string' && /^(-?\d+|@\w{4,})$/.test(s);

  /** Accepts a bare token or a pasted Bot API link ("https://api.telegram.org/bot<token>/..."). */
  function extractBotToken(raw) {
    const s = str(raw, LIMITS.tgTokenLength).trim();
    return s.match(BOT_TOKEN_RE)?.[0] ?? s;
  }

  /** Normalizes settings from storage/UI so the rest of the code can trust the shape. */
  function sanitizeSettings(raw = {}) {
    const d = DEFAULT_SETTINGS;
    return {
      paused: Boolean(raw.paused ?? d.paused),
      muted: Boolean(raw.muted ?? d.muted),
      uiLang: isSupported(raw.uiLang) ? raw.uiLang : d.uiLang,
      voiceName: str(raw.voiceName, 200),
      voiceLang: LANG_TAG_RE.test(raw.voiceLang ?? '') ? raw.voiceLang : d.voiceLang,
      rate: clamp(raw.rate, LIMITS.rate, d.rate),
      pitch: clamp(raw.pitch, LIMITS.pitch, d.pitch),
      volume: clamp(raw.volume, LIMITS.volume, d.volume),
      template: str(raw.template, LIMITS.templateLength).trim() || d.template,
      cooldownSec: clamp(raw.cooldownSec, LIMITS.cooldownSec, d.cooldownSec),
      announceOnStart: Boolean(raw.announceOnStart ?? d.announceOnStart),
      lostAlert: Boolean(raw.lostAlert ?? d.lostAlert),
      heartbeatMin: clamp(raw.heartbeatMin, LIMITS.heartbeatMin, d.heartbeatMin),
      highlight: Boolean(raw.highlight ?? d.highlight),
      speakFraction: Boolean(raw.speakFraction ?? d.speakFraction),
      tgToken: extractBotToken(raw.tgToken),
      tgChatId: str(raw.tgChatId, LIMITS.tgChatIdLength).trim(),
    };
  }

  function sanitizeWatcher(raw = {}) {
    const d = DEFAULT_WATCHER;
    return {
      id: str(raw.id, 64) || crypto.randomUUID(),
      name: str(raw.name, LIMITS.nameLength).trim(),
      host: str(raw.host, 253),
      selector: str(raw.selector, LIMITS.selectorLength).trim(),
      enabled: Boolean(raw.enabled ?? d.enabled),
      speakName: Boolean(raw.speakName ?? d.speakName),
      step: clamp(raw.step, LIMITS.step, d.step),
      stepUnit: raw.stepUnit === STEP_UNIT.PCT ? STEP_UNIT.PCT : STEP_UNIT.ABS,
      snapToGrid: Boolean(raw.snapToGrid ?? d.snapToGrid),
      decimals: Math.trunc(clamp(raw.decimals, LIMITS.decimals, d.decimals)),
      skipDigits: Math.trunc(clamp(raw.skipDigits, LIMITS.skipDigits, d.skipDigits)),
      trackFraction: Boolean(raw.trackFraction ?? d.trackFraction),
      stepEnabled: Boolean(raw.stepEnabled ?? d.stepEnabled),
      tgStep: Boolean(raw.tgStep ?? d.tgStep),
      moveEnabled: Boolean(raw.moveEnabled ?? d.moveEnabled),
      tgMove: Boolean(raw.tgMove ?? d.tgMove),
      moveSize: clamp(raw.moveSize, LIMITS.step, d.moveSize),
      moveUnit: raw.moveUnit === STEP_UNIT.ABS ? STEP_UNIT.ABS : STEP_UNIT.PCT,
      moveWindow: Math.trunc(clamp(raw.moveWindow, LIMITS.moveWindow, d.moveWindow)),
      moveWindowUnit: Object.hasOwn(WINDOW_UNIT_SEC, raw.moveWindowUnit) ? raw.moveWindowUnit : d.moveWindowUnit,
    };
  }

  // Voice and Telegram are independent channels: an alert type is tracked if either of them wants it.
  const stepActive = (w) => w.stepEnabled || w.tgStep;
  const moveActive = (w) => w.moveEnabled || w.tgMove;

  /** "www.tbank.ru" -> "tbank": the zone and "www." are noise, and a bare name isn't turned into a link by Telegram. */
  function siteLabel(host) {
    const labels = host.replace(/^www\./i, '').split('.');
    return labels.length > 1 ? labels.slice(0, -1).join('.') : host;
  }

  /** Watcher title for text messages: its name, or the site it watches when unnamed. */
  const watcherLabel = (watcher) => watcher.name || siteLabel(watcher.host);

  // The name can serve only as a visual label (popup, Telegram) while staying out of speech.
  const spokenName = (watcher) => (watcher.speakName ? watcher.name : '');

  function moveWindowSec(watcher) {
    const sec = watcher.moveWindow * WINDOW_UNIT_SEC[watcher.moveWindowUnit];
    return Math.min(LIMITS.moveWindowSec[1], Math.max(LIMITS.moveWindowSec[0], sec));
  }

  /** Also switches the interface language: every context reads its strings right after loading state. */
  async function loadState() {
    const data = await chrome.storage.local.get([STORAGE.SETTINGS, STORAGE.WATCHERS]);
    const watchers = Array.isArray(data[STORAGE.WATCHERS]) ? data[STORAGE.WATCHERS].map(sanitizeWatcher) : [];
    const settings = sanitizeSettings(data[STORAGE.SETTINGS]);
    setLang(settings.uiLang);
    return { settings, watchers };
  }

  const saveSettings = (settings) =>
    chrome.storage.local.set({ [STORAGE.SETTINGS]: sanitizeSettings(settings) });

  const saveWatchers = (watchers) =>
    chrome.storage.local.set({ [STORAGE.WATCHERS]: watchers.map(sanitizeWatcher) });

  /**
   * Tabs opened before the extension was installed or reloaded have no live content script.
   * Returns true if a live script got the message, false if the script had to be injected
   * (a fresh script syncs on its own). Popup and service worker only: content scripts lack chrome.scripting.
   */
  async function sendOrInject(tabId, message) {
    try {
      await chrome.tabs.sendMessage(tabId, message);
      return true;
    } catch {
      // "Receiving end does not exist" is the expected signal of a missing script; injection errors propagate.
      const files = chrome.runtime.getManifest().content_scripts[0].js;
      await chrome.scripting.executeScript({ target: { tabId }, files });
      return false;
    }
  }

  const tabHost = (tab) => {
    try {
      return tab.url ? new URL(tab.url).host : '';
    } catch {
      return ''; // unparsable URL means the tab can't host a watcher
    }
  };

  /**
   * Makes the open tabs of the given watchers report their values again, without a page reload.
   * Returns how many tabs were reached; unreachable ones (protected pages, no site access) are logged.
   */
  async function reconnectWatchers(watchers) {
    const active = watchers.filter((w) => w.enabled && w.selector && w.host);
    const hosts = new Set(active.map((w) => w.host));
    if (!hosts.size) return 0;
    const message = { type: MSG.RESYNC, ids: active.map((w) => w.id) };
    // Filtered by host here: tabs.query match patterns can't express ports.
    const tabs = (await chrome.tabs.query({})).filter((tab) => tab.id != null && hosts.has(tabHost(tab)));
    const results = await Promise.allSettled(tabs.map((tab) => sendOrInject(tab.id, message)));
    results
      .filter((r) => r.status === 'rejected')
      .forEach((r) => console.warn('[TTA] reconnect failed:', r.reason?.message ?? r.reason));
    return results.filter((r) => r.status === 'fulfilled').length;
  }

  /** Inserts or replaces a watcher by id. Re-reads storage to avoid clobbering concurrent edits. */
  async function upsertWatcher(watcher) {
    const { watchers } = await loadState();
    const clean = sanitizeWatcher(watcher);
    const idx = watchers.findIndex((w) => w.id === clean.id);
    const next = idx === -1 ? [...watchers, clean] : watchers.map((w, i) => (i === idx ? clean : w));
    await saveWatchers(next);
    return clean;
  }

  /**
   * Extracts the first number from text like "2 388,5 пт (−1,05%)" or "$1,234.50".
   * Returns { value, decimals } or null. decimals = fraction digits as displayed.
   */
  function parseNumber(text) {
    if (typeof text !== 'string') return null;
    // Thousand separators on the terminal are regular/no-break/thin spaces.
    const compact = text.replace(/[\s   ]/g, '').replace(/[−–]/g, '-');
    const match = compact.match(/-?\d[\d.,]*/);
    if (!match) return null;

    let num = match[0].replace(/[.,]+$/, '');
    const lastSep = Math.max(num.lastIndexOf(','), num.lastIndexOf('.'));
    let decimals = 0;
    if (lastSep !== -1) {
      const sepChar = num[lastSep];
      const otherSep = sepChar === ',' ? '.' : ',';
      const sepCount = num.split(sepChar).length - 1;
      // A single kind of separator repeated ("1,234,567") is grouping, not a decimal point.
      const isDecimal = num.includes(otherSep) || sepCount === 1;
      if (isDecimal) {
        decimals = num.length - lastSep - 1;
        num = num.slice(0, lastSep).replace(/[.,]/g, '') + '.' + num.slice(lastSep + 1);
      } else {
        num = num.replace(/[.,]/g, '');
      }
    }
    const value = Number(num);
    return Number.isFinite(value) ? { value, decimals } : null;
  }

  /** Number for display in the interface language: "2388,5" in Russian, "2388.5" in English, no grouping. */
  function formatNumber(value, decimals) {
    const digits = Math.max(0, Math.min(LIMITS.decimals[1], decimals));
    const text = value.toFixed(digits);
    return TTAI18n.getLang() === 'ru' ? text.replace('.', ',') : text;
  }

  // The setting is phrased positively ("speak the fraction") because a negated checkbox got misread.
  const skipsFraction = (settings) => !settings.speakFraction;

  /** Decimals the value is shown and spoken with: the watcher's own setting or the page's precision. */
  const effectiveDecimals = (watcher, shownDecimals) =>
    watcher.decimals === DECIMALS_AUTO ? (shownDecimals ?? 0) : watcher.decimals;

  /**
   * Size of one point for absolute steps and moves. With trackFraction the user thinks in units of the last
   * spoken digit: step 3 on 1.12260 means 0.00003, matching the spoken "12260" -> "12263".
   */
  const pointSize = (watcher, decimals) => (watcher.trackFraction && decimals > 0 ? 10 ** -decimals : 1);

  function stepThreshold(watcher, anchor, decimals) {
    if (watcher.stepUnit === STEP_UNIT.PCT) return (Math.abs(anchor) * watcher.step) / 100;
    return watcher.step * pointSize(watcher, decimals);
  }

  /**
   * Point that the next change is measured from. Snapping to the step grid gives natural
   * hysteresis: jitter around a level (109.99 <-> 110.01) does not trigger repeated alerts.
   */
  function anchorFor(watcher, value, decimals) {
    if (watcher.snapToGrid && watcher.stepUnit === STEP_UNIT.ABS && watcher.step > 0) {
      const step = watcher.step * pointSize(watcher, decimals);
      return Math.round(value / step) * step;
    }
    return value;
  }

  // Float noise guard so 0.1-steps on values like 2388.5 compare correctly.
  const EPSILON = 1e-9;

  function shouldAnnounce(watcher, anchor, value, decimals) {
    const threshold = stepThreshold(watcher, anchor, decimals);
    if (threshold <= 0) return value !== anchor;
    return Math.abs(value - anchor) + EPSILON >= threshold;
  }

  function renderTemplate(template, vars) {
    return template.replace(/\{(name|value|dir|delta)\}/g, (_, key) => vars[key] ?? '').replace(/\s+/g, ' ').trim();
  }

  globalThis.TTA = Object.freeze({
    MSG,
    STORAGE,
    STEP_UNIT,
    windowUnitLabel,
    DECIMALS_AUTO,
    DEFAULT_SETTINGS,
    LIMITS,
    unitLabel,
    isBotToken,
    isChatId,
    sanitizeSettings,
    sanitizeWatcher,
    loadState,
    saveSettings,
    saveWatchers,
    upsertWatcher,
    sendOrInject,
    reconnectWatchers,
    parseNumber,
    formatNumber,
    skipsFraction,
    moveWindowSec,
    watcherLabel,
    spokenName,
    stepActive,
    moveActive,
    effectiveDecimals,
    pointSize,
    anchorFor,
    shouldAnnounce,
    renderTemplate,
  });
})();
