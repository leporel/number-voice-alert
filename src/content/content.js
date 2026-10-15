// Tracks watched elements on the page and reports value changes to the service worker.
// Announcement logic (step, cooldown, speech) lives in the service worker so several
// open terminal tabs don't produce duplicate voice alerts.
(() => {
  if (globalThis.__ttaContentLoaded) return;
  globalThis.__ttaContentLoaded = true;

  const { MSG, STORAGE, loadState, parseNumber } = TTA;

  // Fallback re-scan: SPA pages may re-mount widgets, detaching our observed node.
  const RESCAN_MS = 1000;
  // Grace period before "lost" so a widget re-render doesn't trigger a false alarm.
  const LOST_AFTER_MS = 10_000;
  const HIGHLIGHT_ATTR = 'data-tta-watch';
  const HIGHLIGHT_STYLE_ID = 'tta-highlight-style';

  const trackers = new Map(); // watcherId -> tracker
  let highlight = false;
  let rescanTimer = null;

  function isContextAlive() {
    return Boolean(chrome.runtime?.id);
  }

  /** Extension reload invalidates this script; stop touching the page instead of throwing every second. */
  function teardown() {
    trackers.forEach(untrack);
    trackers.clear();
    updateRescanTimer();
  }

  function rescan() {
    if (!isContextAlive()) {
      teardown();
      return;
    }
    trackers.forEach(readValue);
  }

  // The script runs on every site; keep pages without watchers free of timers.
  function updateRescanTimer() {
    if (trackers.size && !rescanTimer) {
      rescanTimer = setInterval(rescan, RESCAN_MS);
    } else if (!trackers.size && rescanTimer) {
      clearInterval(rescanTimer);
      rescanTimer = null;
    }
  }

  function send(message) {
    if (!isContextAlive()) {
      teardown();
      return;
    }
    chrome.runtime.sendMessage(message).catch((err) => console.warn('[TTA] message failed:', err.message));
  }

  function ensureHighlightStyle() {
    if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = HIGHLIGHT_STYLE_ID;
    style.textContent = `[${HIGHLIGHT_ATTR}] { outline: 1px dashed #ffdd2d !important; outline-offset: 2px; }`;
    document.head.appendChild(style);
  }

  function applyHighlight(tracker) {
    if (!tracker.el) return;
    if (highlight) tracker.el.setAttribute(HIGHLIGHT_ATTR, '');
    else tracker.el.removeAttribute(HIGHLIGHT_ATTR);
  }

  function untrack(tracker) {
    tracker.observer.disconnect();
    tracker.el?.removeAttribute(HIGHLIGHT_ATTR);
  }

  /**
   * After a re-render the selector may match a placeholder before the real widget,
   * so prefer the first match that actually holds a number.
   */
  function findElement(selector) {
    let matches;
    try {
      matches = document.querySelectorAll(selector);
    } catch {
      return null; // user-edited selector may be invalid; treated as "not found"
    }
    for (const el of matches) {
      if (parseNumber(el.textContent)) return el;
    }
    return matches[0] ?? null;
  }

  function attach(tracker) {
    const el = findElement(tracker.watcher.selector);
    if (el === tracker.el) return;
    tracker.observer.disconnect();
    tracker.el?.removeAttribute(HIGHLIGHT_ATTR);
    tracker.el = el;
    tracker.lastText = null;
    if (!el) return;
    tracker.observer.observe(el, { characterData: true, childList: true, subtree: true });
    applyHighlight(tracker);
  }

  /** An element without a number counts as missing too: the value is gone either way. */
  function updateLostState(tracker, present) {
    const now = Date.now();
    if (present) {
      tracker.missingSince = null;
      if (tracker.reportedLost) {
        tracker.reportedLost = false;
        send({ type: MSG.STATUS, id: tracker.watcher.id, status: 'ok' });
      }
      return;
    }
    tracker.missingSince ??= now;
    if (!tracker.reportedLost && now - tracker.missingSince >= LOST_AFTER_MS) {
      tracker.reportedLost = true;
      send({ type: MSG.STATUS, id: tracker.watcher.id, status: 'lost' });
    }
  }

  function readValue(tracker) {
    // Without a number the current element may be a stale node or a placeholder: keep searching for the real one.
    if (!tracker.el?.isConnected || !tracker.parsed) attach(tracker);

    const text = tracker.el?.textContent ?? null;
    if (text !== tracker.lastText) {
      tracker.lastText = text;
      tracker.parsed = text === null ? null : parseNumber(text);
      // A number that comes back after a gap is reported even if unchanged, so the service worker sees it alive.
      if (!tracker.parsed) tracker.stale = true;
    }
    updateLostState(tracker, Boolean(tracker.parsed));

    const { parsed } = tracker;
    if (!parsed || (parsed.value === tracker.lastValue && !tracker.stale)) return;
    const initial = tracker.lastValue === null;
    tracker.lastValue = parsed.value;
    tracker.stale = false;
    send({ type: MSG.VALUE, id: tracker.watcher.id, value: parsed.value, decimals: parsed.decimals, initial });
  }

  function createTracker(watcher) {
    const tracker = {
      watcher,
      el: null,
      lastText: null,
      parsed: null,
      lastValue: null,
      stale: false,
      missingSince: null,
      reportedLost: false,
    };
    tracker.observer = new MutationObserver(() => readValue(tracker));
    return tracker;
  }

  async function sync() {
    const { settings, watchers } = await loadState();
    highlight = settings.highlight;
    if (highlight && watchers.some((w) => w.host === location.host)) ensureHighlightStyle();

    // Switched off means no tracking at all, so an empty set tears every tracker down.
    const relevant = new Map(
      settings.paused
        ? []
        : watchers.filter((w) => w.enabled && w.selector && w.host === location.host).map((w) => [w.id, w]),
    );

    for (const [id, tracker] of trackers) {
      const next = relevant.get(id);
      if (!next || next.selector !== tracker.watcher.selector) {
        untrack(tracker);
        trackers.delete(id);
      } else {
        tracker.watcher = next;
        applyHighlight(tracker);
      }
    }
    for (const [id, watcher] of relevant) {
      if (!trackers.has(id)) trackers.set(id, createTracker(watcher));
    }
    trackers.forEach(readValue);
    updateRescanTimer();
  }

  /** Sends the current values again even if unchanged, e.g. after the service worker lost them. */
  function resend(ids) {
    ids.forEach((id) => {
      const tracker = trackers.get(id);
      if (!tracker) return;
      tracker.stale = true;
      readValue(tracker);
    });
  }

  function runSync() {
    sync().catch((err) => console.error('[TTA] sync failed:', err));
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (STORAGE.WATCHERS in changes || STORAGE.SETTINGS in changes)) runSync();
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (msg?.type === MSG.PICK) {
      TTAPicker.start(msg.watcherId ?? null)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true; // async response
    }
    if (msg?.type === MSG.RESYNC && Array.isArray(msg.ids)) {
      resend(msg.ids);
      sendResponse({ ok: true });
    }
    return false;
  });

  runSync();
})();
