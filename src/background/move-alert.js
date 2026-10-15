// "Sharp move" detection: alert when the value moved by N points/% within a time window.
// Pure functions over a compact history kept in the watcher's runtime record.
(() => {
  if (globalThis.TTAMove) return;

  const { STEP_UNIT } = TTA;

  // Caps history at ~MAX_SAMPLES points per watcher whatever the window is,
  // so session storage writes stay small even for a 24h window.
  const MAX_SAMPLES = 600;
  const MIN_SAMPLE_GAP_MS = 1000;
  const EPSILON = 1e-9;

  /**
   * Drops samples older than the window except the last one at/before the window start:
   * it is the value that was current at that moment (a flat price produces no new samples).
   */
  function trimHistory(history, now, windowMs) {
    const cutoff = now - windowMs;
    let firstAfter = history.findIndex(([t]) => t > cutoff);
    if (firstAfter === -1) firstAfter = history.length;
    return history.slice(Math.max(0, firstAfter - 1));
  }

  const windowMsOf = (watcher) => TTA.moveWindowSec(watcher) * 1000;

  /** Returns the history with the new sample appended (or merged into the last one if too close). */
  function recordSample(watcher, history, now, value) {
    const windowMs = windowMsOf(watcher);
    const gap = Math.max(MIN_SAMPLE_GAP_MS, windowMs / MAX_SAMPLES);
    const trimmed = trimHistory(history ?? [], now, windowMs);
    const last = trimmed[trimmed.length - 1];
    if (last && now - last[0] < gap) return [...trimmed.slice(0, -1), [last[0], value]];
    return [...trimmed, [now, value]];
  }

  const threshold = (watcher, reference, decimals) =>
    watcher.moveUnit === STEP_UNIT.PCT
      ? (Math.abs(reference) * watcher.moveSize) / 100
      : watcher.moveSize * TTA.pointSize(watcher, decimals);

  /**
   * Compares the current value with the window's extremes, so a move counts even if it
   * started mid-window. Returns { up, delta, pct } or null.
   */
  function detectMove(watcher, history, now, value, decimals) {
    if (!TTA.moveActive(watcher) || watcher.moveSize <= 0) return null;
    const values = trimHistory(history ?? [], now, windowMsOf(watcher)).map(([, v]) => v);
    if (!values.length) return null;

    const low = Math.min(...values);
    const high = Math.max(...values);
    const candidates = [
      { up: true, reference: low, delta: value - low },
      { up: false, reference: high, delta: high - value },
    ];
    const hit = candidates.find((c) => c.delta > 0 && c.delta + EPSILON >= threshold(watcher, c.reference, decimals));
    if (!hit) return null;
    const pct = hit.reference !== 0 ? (hit.delta / Math.abs(hit.reference)) * 100 : 0;
    return { up: hit.up, delta: hit.delta, pct };
  }

  /** "Up 2 percent in 5 minutes, 2388", optionally prefixed with the watcher name. */
  function movePhrase(watcher, move, value, decimals, settings) {
    const sp = TTASpeech.speaker(settings);
    const amount = watcher.moveUnit === STEP_UNIT.PCT ? sp.percent(move.pct) : sp.points(watcher, move.delta, decimals);
    const body = sp.move({
      up: move.up,
      amount,
      period: sp.period(watcher.moveWindow, watcher.moveWindowUnit),
      value: sp.value(watcher, value, decimals),
    });
    const name = TTA.spokenName(watcher);
    return name ? `${name}. ${body}` : body;
  }

  /** Text form for Telegram: "Index: up 2.1% in 5 min → 2390" */
  function moveMessage(watcher, move, value, decimals) {
    const amount =
      watcher.moveUnit === STEP_UNIT.PCT ? TTA.formatNumber(move.pct, 1) : TTA.formatNumber(move.delta, decimals);
    return TTAI18n.t('tgMove', {
      label: TTA.watcherLabel(watcher),
      dir: TTAI18n.t(move.up ? 'moveUp' : 'moveDown'),
      amount: amount + TTA.unitLabel(watcher.moveUnit),
      period: `${watcher.moveWindow} ${TTA.windowUnitLabel(watcher.moveWindowUnit)}`,
      value: TTA.formatNumber(value, decimals),
    });
  }

  globalThis.TTAMove = Object.freeze({ recordSample, detectMove, movePhrase, moveMessage });
})();
