importScripts('../shared/i18n.js', '../shared/common.js', '../shared/speech.js', '../shared/telegram.js', 'move-alert.js');

const { MSG, STORAGE, LIMITS } = TTA;

const HEARTBEAT_ALARM = 'tta-heartbeat';
const MIN_ALARM_PERIOD_MIN = 0.5; // Chrome rejects shorter alarm periods
const PERSIST_DEBOUNCE_MS = 300; // values tick several times a second; batch session writes
const STATUS = Object.freeze({ OK: 'ok', LOST: 'lost', CLOSED: 'closed' });

let stateCache = null;
let stateVersion = 0; // bumped on every storage change to discard reads that raced with it
let runtimeCache = null;
let persistTimer = null;
const pendingRechecks = new Map(); // watcherId -> timeout id

async function getState() {
  while (!stateCache) {
    const version = stateVersion;
    const loaded = await TTA.loadState();
    if (version === stateVersion) stateCache = loaded;
  }
  return stateCache;
}

/** Per-watcher live data: { value, decimals, anchor, spokenValue, spokenAt, updatedAt, status, tabId, history }. */
async function getRuntime() {
  if (!runtimeCache) {
    const data = await chrome.storage.session.get(STORAGE.RUNTIME);
    runtimeCache ??= data[STORAGE.RUNTIME] ?? {};
  }
  return runtimeCache;
}

function persistRuntime() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    chrome.storage.session
      .set({ [STORAGE.RUNTIME]: runtimeCache ?? {} })
      .catch((err) => console.error('[TTA] persist runtime failed:', err));
  }, PERSIST_DEBOUNCE_MS);
}

function say(text, settings, options) {
  chrome.storage.session
    .set({ [STORAGE.LAST_PHRASE]: text })
    .catch((err) => console.warn('[TTA] last phrase not saved:', err));
  TTASpeech.speak(text, settings, options).catch((err) => console.error('[TTA] speak failed:', err));
}

// A watcher with both voice switches off is Telegram-only: its reminders and lost/closed warnings stay silent too.
const hasVoice = (watcher) => watcher.stepEnabled || watcher.moveEnabled;

/** Mute silences voice only; Telegram ignores it. Pause (extension off) is checked separately and stops both. */
const speaks = (watcher, settings) => !settings.muted && hasVoice(watcher);

/** Telegram works independently of mute: muting the voice is exactly when a phone message is useful. */
function notifyTelegram(settings, text) {
  if (!TTATelegram.isConfigured(settings)) return;
  TTATelegram.send(settings, text).catch((err) => console.error('[TTA] telegram failed:', err.message));
}

/**
 * A fixed spoken phrase with watcher names appended; unnamed watchers are left out
 * so the phrase never ends with a dangling colon.
 */
function alertPhrase(settings, key, watchers) {
  const text = TTASpeech.speaker(settings).phrase(key);
  const names = watchers.map(TTA.spokenName).filter(Boolean);
  return names.length ? `${text}: ${names.join(', ')}` : text;
}

const speechDecimals = (watcher, rt) => TTA.effectiveDecimals(watcher, rt.decimals);

function buildPhrase(watcher, rt, prevValue, settings) {
  const sp = TTASpeech.speaker(settings);
  const decimals = speechDecimals(watcher, rt);
  const vars = { name: TTA.spokenName(watcher), value: sp.value(watcher, rt.value, decimals), dir: '', delta: '' };
  if (prevValue != null && prevValue !== rt.value) {
    vars.dir = sp.dir(rt.value > prevValue);
    vars.delta = sp.points(watcher, Math.abs(rt.value - prevValue), decimals);
  }
  return TTA.renderTemplate(settings.template, vars);
}

/** "Index: 2390 ▲ +10" */
function stepMessage(watcher, rt, prevValue) {
  const decimals = speechDecimals(watcher, rt);
  const text = `${TTA.watcherLabel(watcher)}: ${TTA.formatNumber(rt.value, decimals)}`;
  if (prevValue == null || prevValue === rt.value) return text;
  const up = rt.value > prevValue;
  return `${text} ${up ? '▲ +' : '▼ −'}${TTA.formatNumber(Math.abs(rt.value - prevValue), decimals)}`;
}

function scheduleRecheck(watcherId, delayMs) {
  if (pendingRechecks.has(watcherId)) return;
  const timer = setTimeout(() => {
    pendingRechecks.delete(watcherId);
    recheck(watcherId).catch((err) => console.error('[TTA] recheck failed:', err));
  }, delayMs);
  pendingRechecks.set(watcherId, timer);
}

/** After a cooldown, speak only if the price is still far enough from the last announced level. */
async function recheck(watcherId) {
  const { settings, watchers } = await getState();
  const watcher = watchers.find((w) => w.id === watcherId);
  const rt = (await getRuntime())[watcherId];
  if (settings.paused || !watcher?.enabled || !TTA.stepActive(watcher) || rt?.value == null) return;
  if (TTA.shouldAnnounce(watcher, rt.anchor, rt.value, speechDecimals(watcher, rt))) announce(watcher, rt, settings);
  persistRuntime();
}

/**
 * Step alert, or with `initial` the start-of-tracking announcement. The latter is spoken regardless of
 * the step voice switch and never goes to Telegram: a page reload is not a price event.
 */
function announce(watcher, rt, settings, { bypassCooldown = false, initial = false } = {}) {
  // While muted the anchor still moves on every step, so unmuting doesn't blurt out a stale backlog.
  if (!settings.muted && !bypassCooldown) {
    const waitMs = (rt.spokenAt ?? 0) + settings.cooldownSec * 1000 - Date.now();
    if (waitMs > 0) {
      scheduleRecheck(watcher.id, waitMs);
      return;
    }
  }
  const prevValue = rt.spokenValue;
  markSpoken(watcher, rt);
  if (speaks(watcher, settings) && (initial || watcher.stepEnabled)) say(buildPhrase(watcher, rt, prevValue, settings), settings);
  if (!initial && watcher.tgStep) notifyTelegram(settings, stepMessage(watcher, rt, prevValue));
}

/** Moves the step anchor to the current value without announcing it. */
function resetAnchor(watcher, rt) {
  rt.anchor = TTA.anchorFor(watcher, rt.value, speechDecimals(watcher, rt));
  rt.spokenValue = rt.value;
}

function markSpoken(watcher, rt) {
  resetAnchor(watcher, rt);
  rt.spokenAt = Date.now();
}

/**
 * Sharp-move check. After an alert the history restarts from the current value,
 * so the next alert needs another full move instead of firing on every tick.
 */
function trackMove(watcher, rt, settings, now) {
  if (!TTA.moveActive(watcher)) {
    delete rt.history;
    return false;
  }
  const move = TTAMove.detectMove(watcher, rt.history, now, rt.value, speechDecimals(watcher, rt));
  rt.history = TTAMove.recordSample(watcher, move ? [] : rt.history, now, rt.value);
  if (!move) return false;
  // The move phrase already contains the value, so the step alert continues from here.
  markSpoken(watcher, rt);
  const decimals = speechDecimals(watcher, rt);
  if (!settings.muted && watcher.moveEnabled) say(TTAMove.movePhrase(watcher, move, rt.value, decimals, settings), settings);
  if (watcher.tgMove) notifyTelegram(settings, TTAMove.moveMessage(watcher, move, rt.value, decimals));
  return true;
}

async function handleValue(msg, sender) {
  const { settings, watchers } = await getState();
  const watcher = watchers.find((w) => w.id === msg.id);
  // Content scripts stop tracking when switched off; this only drops values that raced with the switch.
  if (settings.paused || !watcher?.enabled) return;

  const runtime = await getRuntime();
  const rt = (runtime[watcher.id] ??= {});
  const now = Date.now();
  Object.assign(rt, {
    value: msg.value,
    decimals: msg.decimals,
    updatedAt: now,
    status: STATUS.OK,
    tabId: sender.tab?.id ?? null,
  });
  // History from before a page reload has a blind gap; comparing across it would fake a sharp move.
  if (msg.initial) rt.history = [];
  const moved = trackMove(watcher, rt, settings, now);

  if (rt.anchor == null || msg.initial) {
    if (settings.announceOnStart) {
      announce(watcher, rt, settings, { bypassCooldown: true, initial: true });
    } else {
      resetAnchor(watcher, rt);
    }
  } else if (!moved && TTA.stepActive(watcher) && TTA.shouldAnnounce(watcher, rt.anchor, rt.value, speechDecimals(watcher, rt))) {
    announce(watcher, rt, settings);
  }
  persistRuntime();
}

async function handleStatus(msg) {
  const { settings, watchers } = await getState();
  const watcher = watchers.find((w) => w.id === msg.id);
  if (settings.paused || !watcher?.enabled) return;
  const runtime = await getRuntime();
  const rt = (runtime[watcher.id] ??= {});
  rt.status = msg.status;
  persistRuntime();
  if (msg.status === STATUS.LOST && settings.lostAlert && speaks(watcher, settings)) {
    say(alertPhrase(settings, 'elementLost', [watcher]), settings);
  }
}

async function handleTabClosed(tabId) {
  const { settings, watchers } = await getState();
  if (settings.paused) return;
  const runtime = await getRuntime();
  const affected = watchers.filter((w) => {
    const rt = runtime[w.id];
    return w.enabled && rt?.tabId === tabId && rt.status === STATUS.OK;
  });
  if (!affected.length) return;
  affected.forEach((w) => (runtime[w.id].status = STATUS.CLOSED));
  persistRuntime();
  const voiced = affected.filter((w) => speaks(w, settings));
  if (settings.lostAlert && voiced.length) {
    say(alertPhrase(settings, 'tabClosed', voiced), settings);
  }
}

/**
 * Speaks current values. Explicit requests (hotkey/popup) work even while muted, the periodic reminder doesn't.
 * While off nothing is tracked, so stored values are stale and only the off state is reported.
 * A Telegram-only watcher is spoken only when asked for by id (its own card button).
 */
async function speakCurrent({ watcherId = null, reminder = false } = {}) {
  const { settings, watchers } = await getState();
  if (reminder && (settings.paused || settings.muted)) return;
  if (settings.paused) {
    say(TTASpeech.speaker(settings).phrase('extensionOff'), settings, { interrupt: true });
    return;
  }
  const runtime = await getRuntime();
  const phrases = watchers
    .filter((w) => w.enabled && (watcherId ? w.id === watcherId : hasVoice(w)) && runtime[w.id]?.value != null)
    .map((w) => buildPhrase(w, runtime[w.id], null, settings));
  if (!phrases.length && reminder) return;
  say(phrases.length ? phrases.join('. ') : TTASpeech.speaker(settings).phrase('noData'), settings, { interrupt: true });
}

async function syncHeartbeat(settings) {
  await chrome.alarms.clear(HEARTBEAT_ALARM);
  if (!settings.paused && settings.heartbeatMin > 0) {
    await chrome.alarms.create(HEARTBEAT_ALARM, {
      periodInMinutes: Math.max(MIN_ALARM_PERIOD_MIN, settings.heartbeatMin),
    });
  }
}

const badgeText = (settings) => (settings.paused ? 'OFF' : settings.muted ? 'MUTE' : '');

function updateBadge(settings) {
  chrome.action.setBadgeBackgroundColor({ color: '#e5484d' }).catch((err) => console.warn('[TTA] badge:', err));
  chrome.action.setBadgeText({ text: badgeText(settings) }).catch((err) => console.warn('[TTA] badge:', err));
}

// Spoken confirmation for each global switch: [phrase key when the setting turns false, when it turns true].
const TOGGLE_PHRASES = Object.freeze({
  paused: ['extensionOn', 'extensionOff'],
  muted: ['soundOn', 'soundOff'],
});

async function toggleSetting(key) {
  const { settings } = await getState();
  await TTA.saveSettings({ ...settings, [key]: !settings[key] });
}

function cancelRecheck(id) {
  clearTimeout(pendingRechecks.get(id));
  pendingRechecks.delete(id);
}

/** Drops queued alerts and move history, which would otherwise fire stale alerts once switched back on. */
async function stopAlerts() {
  [...pendingRechecks.keys()].forEach(cancelRecheck);
  const runtime = await getRuntime();
  Object.values(runtime).forEach((rt) => delete rt.history);
  persistRuntime();
}

// Fields that define the size of a step; after a change the stored anchor is measured in the old scale.
const STEP_SCALE_FIELDS = ['step', 'stepUnit', 'snapToGrid', 'decimals', 'trackFraction'];

/**
 * Re-anchors watchers whose step scale changed. Otherwise the next tick compares against a level from
 * the old scale (step 3 snapped 1.12260 to 0) and blurts out a huge bogus change.
 */
async function rebaseAnchors(prevWatchers, watchers) {
  const prev = new Map(prevWatchers.map((w) => [w.id, w]));
  const runtime = await getRuntime();
  const changed = watchers.filter((w) => {
    const old = prev.get(w.id);
    return old && runtime[w.id]?.value != null && STEP_SCALE_FIELDS.some((f) => old[f] !== w[f]);
  });
  if (!changed.length) return;
  changed.forEach((w) => resetAnchor(w, runtime[w.id]));
  persistRuntime();
}

async function pruneRuntime(watchers) {
  const runtime = await getRuntime();
  const ids = new Set(watchers.map((w) => w.id));
  Object.keys(runtime)
    .filter((id) => !ids.has(id))
    .forEach((id) => {
      delete runtime[id];
      cancelRecheck(id);
    });
  persistRuntime();
}

// Content scripts are the only untrusted-ish input here: the page can't message us directly,
// but values still come from page DOM, so keep the shape strict.
function isValidValueMsg(msg) {
  return (
    typeof msg.id === 'string' &&
    Number.isFinite(msg.value) &&
    Number.isInteger(msg.decimals) &&
    msg.decimals >= 0 &&
    msg.decimals <= LIMITS.decimals[1]
  );
}

const isValidStatusMsg = (msg) => typeof msg.id === 'string' && (msg.status === STATUS.OK || msg.status === STATUS.LOST);

function logError(err) {
  console.error('[TTA]', err);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string') return false;
  switch (msg.type) {
    case MSG.VALUE:
      if (isValidValueMsg(msg)) handleValue(msg, sender).catch(logError);
      break;
    case MSG.STATUS:
      if (isValidStatusMsg(msg)) handleStatus(msg).catch(logError);
      break;
    case MSG.SPEAK_NOW:
      speakCurrent({ watcherId: typeof msg.watcherId === 'string' ? msg.watcherId : null }).catch(logError);
      break;
    default:
      return false;
  }
  sendResponse({ ok: true });
  return false;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  stateVersion++;
  stateCache = null;
  const settingsChange = changes[STORAGE.SETTINGS];
  if (settingsChange) {
    const next = TTA.sanitizeSettings(settingsChange.newValue);
    const prev = TTA.sanitizeSettings(settingsChange.oldValue);
    updateBadge(next);
    if (next.heartbeatMin !== prev.heartbeatMin || next.paused !== prev.paused) syncHeartbeat(next).catch(logError);
    if (next.paused && !prev.paused) stopAlerts().catch(logError);
    // Confirmed here rather than in the hotkey handler so the popup switches get the same feedback;
    // the interrupting phrase also cuts off whatever was being spoken.
    Object.entries(TOGGLE_PHRASES)
      .filter(([key]) => next[key] !== prev[key])
      .forEach(([key, phrases]) => say(TTASpeech.speaker(next).phrase(phrases[Number(next[key])]), next, { interrupt: true }));
  }
  const watchersChange = changes[STORAGE.WATCHERS];
  if (watchersChange) {
    const watchers = (watchersChange.newValue ?? []).map(TTA.sanitizeWatcher);
    pruneRuntime(watchers).catch(logError);
    rebaseAnchors((watchersChange.oldValue ?? []).map(TTA.sanitizeWatcher), watchers).catch(logError);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) speakCurrent({ reminder: true }).catch(logError);
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-mute') toggleSetting('muted').catch(logError);
  else if (command === 'toggle-pause') toggleSetting('paused').catch(logError);
  else if (command === 'speak-now') speakCurrent().catch(logError);
});

chrome.tabs.onRemoved.addListener((tabId) => handleTabClosed(tabId).catch(logError));

async function init() {
  const { settings } = await getState();
  updateBadge(settings);
  await syncHeartbeat(settings);
}

/** Reload/update orphans the content scripts in already open tabs; revive them so no page reload is needed. */
async function reconnectOpenTabs() {
  const { watchers } = await getState();
  await TTA.reconnectWatchers(watchers);
}

chrome.runtime.onInstalled.addListener(() => {
  init().catch(logError);
  reconnectOpenTabs().catch(logError);
});
chrome.runtime.onStartup.addListener(() => init().catch(logError));
