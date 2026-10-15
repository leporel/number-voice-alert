// Interactive element picker: hover highlight, click to choose, then a small form to name the watcher.
(() => {
  if (globalThis.TTAPicker) return;

  const { parseNumber, formatNumber, loadState, upsertWatcher, STEP_UNIT } = TTA;
  const { t } = TTAI18n;

  // Test/QA attributes survive redesigns better than hashed CSS-module classes.
  const STABLE_ATTRS = ['data-qa-type', 'data-qa-tag', 'data-qa', 'data-testid', 'data-test-id'];
  const MAX_CLASSES_PER_SEGMENT = 2;
  // Price cells toggle classes on every tick (green/red, flash animation); they must not end up in the selector.
  const VOLATILE_CLASS_RE = /(active|hover|focus|selected|up|down|positive|negative|green|red|grow|fall|animat|flash|blink|highlight|tta-)/i;
  // Auto-generated ids (React useId ":r1:", numeric suffixes) differ between page loads.
  const DYNAMIC_ID_RE = /^:|\d{3,}|[a-f0-9]{8,}/i;
  const TOAST_MS = 1800;

  const BLOCKED_POINTER_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu'];
  const ISOLATED_KEY_EVENTS = ['keydown', 'keyup', 'keypress'];

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    .box { position: fixed; pointer-events: none; border: 2px solid #ffdd2d; background: rgba(255,221,45,.12);
           border-radius: 3px; transition: all .05s linear; display: none; }
    .tip { position: fixed; pointer-events: none; background: #1d232b; color: #fff; font-size: 12px; padding: 3px 7px;
           border-radius: 4px; border: 1px solid #ffdd2d; white-space: nowrap; display: none; }
    .tip.bad { border-color: #e5484d; color: #ffb4b4; }
    .hint { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); background: #1d232b; color: #cfd6df;
            font-size: 13px; padding: 8px 14px; border-radius: 8px; border: 1px solid #39424e; box-shadow: 0 6px 24px rgba(0,0,0,.4); }
    .hint b { color: #ffdd2d; font-weight: 600; }
    form { position: fixed; top: 64px; left: 50%; transform: translateX(-50%); width: 320px; pointer-events: auto;
           background: #1d232b; color: #e6ebf0; border: 1px solid #39424e; border-radius: 12px; padding: 16px;
           box-shadow: 0 12px 40px rgba(0,0,0,.5); display: none; font-size: 13px; }
    h3 { margin: 0 0 4px; font-size: 15px; }
    .found { color: #9aa5b1; margin-bottom: 12px; }
    .found strong { color: #ffdd2d; font-size: 18px; }
    label { display: block; color: #9aa5b1; margin: 10px 0 4px; }
    input, select { width: 100%; background: #12161b; color: #e6ebf0; border: 1px solid #39424e; border-radius: 6px;
                    padding: 7px 9px; font-size: 13px; outline: none; }
    input:focus, select:focus { border-color: #ffdd2d; }
    .row { display: flex; gap: 8px; }
    .row > :first-child { flex: 1; }
    .row select { width: 110px; }
    .actions { display: flex; gap: 8px; margin-top: 16px; }
    button { flex: 1; border: 0; border-radius: 6px; padding: 9px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .save { background: #ffdd2d; color: #111; }
    .cancel { background: #2b333d; color: #e6ebf0; }
    .toast { position: fixed; top: 64px; left: 50%; transform: translateX(-50%); background: #1f7a4d; color: #fff;
             padding: 10px 16px; border-radius: 8px; font-size: 13px; display: none; }
  `;

  // Built per mount: the interface language may change between picks.
  const markup = () => `
    <style>${STYLE}</style>
    <div class="box"></div>
    <div class="tip"></div>
    <div class="hint">${t('pickerHint')} <b>↑</b>/<b>↓</b> — ${t('pickerHintNav')}, <b>Esc</b> — ${t('pickerHintCancel')}</div>
    <form>
      <h3>${t('pickerTitle')}</h3>
      <div class="found">${t('pickerNow')} <strong class="value"></strong></div>
      <label>${t('pickerName')}</label>
      <input name="name" maxlength="40" placeholder="${t('pickerNamePlaceholder')}" autocomplete="off">
      <label>${t('pickerStep')}</label>
      <div class="row">
        <input name="step" type="number" min="0" step="any">
        <select name="stepUnit">
          <option value="${STEP_UNIT.ABS}">${t('unitPoints')}</option>
          <option value="${STEP_UNIT.PCT}">%</option>
        </select>
      </div>
      <div class="actions">
        <button type="button" class="cancel">${t('pickerCancel')}</button>
        <button type="submit" class="save">${t('pickerSave')}</button>
      </div>
    </form>
    <div class="toast">${t('pickerSaved')}</div>
  `;

  const isStableClass = (c) => !VOLATILE_CLASS_RE.test(c);
  const isStableId = (id) => Boolean(id) && !DYNAMIC_ID_RE.test(id);

  function selectsOnly(selector, el) {
    try {
      const found = document.querySelectorAll(selector);
      return found.length === 1 && found[0] === el;
    } catch {
      return false;
    }
  }

  function segmentFor(node) {
    let seg = node.tagName.toLowerCase();
    const attr = STABLE_ATTRS.find((a) => node.hasAttribute(a));
    if (attr) seg += `[${attr}="${CSS.escape(node.getAttribute(attr))}"]`;
    const classes = [...node.classList].filter(isStableClass).slice(0, MAX_CLASSES_PER_SEGMENT);
    seg += classes.map((c) => '.' + CSS.escape(c)).join('');

    const parent = node.parentElement;
    if (parent && [...parent.children].filter((c) => c.matches(seg)).length > 1) {
      const sameTag = [...parent.children].filter((c) => c.tagName === node.tagName);
      seg += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
    }
    return seg;
  }

  /** Shortest ancestor chain that uniquely identifies the element. */
  function buildSelector(el) {
    if (isStableId(el.id) && selectsOnly('#' + CSS.escape(el.id), el)) return '#' + CSS.escape(el.id);
    const parts = [];
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      parts.unshift(node !== el && isStableId(node.id) ? '#' + CSS.escape(node.id) : segmentFor(node));
      const selector = parts.join(' > ');
      if (selectsOnly(selector, el)) return selector;
    }
    return parts.join(' > ');
  }

  class Picker {
    constructor() {
      this.host = null;
      this.ui = null;
      this.target = null;
      this.childStack = [];
      this.confirming = false;
      this.existing = null;
      this.onMove = this.onMove.bind(this);
      this.onBlocked = this.onBlocked.bind(this);
      this.onKey = this.onKey.bind(this);
      this.onScroll = () => this.drawTarget();
    }

    get active() {
      return this.host !== null;
    }

    async start(watcherId) {
      if (this.active) this.stop();
      const { watchers } = await loadState();
      this.existing = watchers.find((w) => w.id === watcherId) ?? null;
      this.mount();
      window.addEventListener('mousemove', this.onMove, true);
      window.addEventListener('keydown', this.onKey, true);
      window.addEventListener('scroll', this.onScroll, true);
      BLOCKED_POINTER_EVENTS.forEach((t) => window.addEventListener(t, this.onBlocked, true));
    }

    stop() {
      window.removeEventListener('mousemove', this.onMove, true);
      window.removeEventListener('keydown', this.onKey, true);
      window.removeEventListener('scroll', this.onScroll, true);
      BLOCKED_POINTER_EVENTS.forEach((t) => window.removeEventListener(t, this.onBlocked, true));
      this.host?.remove();
      this.host = this.ui = this.target = this.existing = null;
      this.childStack = [];
      this.confirming = false;
    }

    mount() {
      this.host = document.createElement('tta-picker');
      this.host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
      const root = this.host.attachShadow({ mode: 'closed' });
      root.innerHTML = markup(); // our own dictionary strings only; user data is set via textContent/value
      // Keep the terminal's hotkeys from reacting to typing inside our form.
      ISOLATED_KEY_EVENTS.forEach((t) => root.addEventListener(t, (e) => e.stopPropagation()));
      const $ = (s) => root.querySelector(s);
      this.ui = { box: $('.box'), tip: $('.tip'), hint: $('.hint'), form: $('form'), value: $('.value'), toast: $('.toast') };
      this.ui.form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.save().catch((err) => console.error('[TTA] save failed:', err));
      });
      $('.cancel').addEventListener('click', () => this.stop());
      document.documentElement.appendChild(this.host);
    }

    isOwnEvent(e) {
      return e.composedPath().includes(this.host);
    }

    onMove(e) {
      if (this.confirming || this.isOwnEvent(e) || !(e.target instanceof Element)) return;
      if (e.target === this.target) return;
      this.childStack = [];
      this.setTarget(e.target);
    }

    onBlocked(e) {
      if (this.confirming || this.isOwnEvent(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === 'click' && this.target) this.openForm();
    }

    onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.stop();
        return;
      }
      if (this.confirming || !this.target) return;
      if (e.key === 'ArrowUp' && this.target.parentElement && this.target.parentElement !== document.body) {
        this.childStack.push(this.target);
        this.setTarget(this.target.parentElement);
      } else if (e.key === 'ArrowDown' && this.childStack.length) {
        this.setTarget(this.childStack.pop());
      } else if (e.key === 'Enter') {
        this.openForm();
      } else {
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
    }

    setTarget(el) {
      this.target = el;
      this.drawTarget();
    }

    drawTarget() {
      if (!this.target || !this.ui) return;
      const r = this.target.getBoundingClientRect();
      const { box, tip } = this.ui;
      Object.assign(box.style, { display: 'block', left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` });

      const parsed = parseNumber(this.target.textContent);
      tip.textContent = parsed ? t('pickerNumber', { value: formatNumber(parsed.value, parsed.decimals) }) : t('pickerNoNumber');
      tip.classList.toggle('bad', !parsed);
      const tipTop = r.top > 28 ? r.top - 26 : r.bottom + 6;
      Object.assign(tip.style, { display: 'block', left: `${Math.max(4, r.left)}px`, top: `${tipTop}px` });
    }

    openForm() {
      const parsed = parseNumber(this.target.textContent);
      if (!parsed) return; // nothing to watch; let the user pick another element
      this.confirming = true;
      const { form, value, hint } = this.ui;
      value.textContent = formatNumber(parsed.value, parsed.decimals);
      form.elements.name.value = this.existing?.name ?? '';
      form.elements.step.value = String(this.existing?.step ?? 1);
      form.elements.stepUnit.value = this.existing?.stepUnit ?? STEP_UNIT.ABS;
      hint.style.display = 'none';
      form.style.display = 'block';
      form.elements.name.focus();
    }

    async save() {
      const { form } = this.ui;
      await upsertWatcher({
        ...(this.existing ?? { id: crypto.randomUUID() }),
        name: form.elements.name.value,
        step: form.elements.step.value,
        stepUnit: form.elements.stepUnit.value,
        selector: buildSelector(this.target),
        host: location.host,
        enabled: true,
      });
      form.style.display = 'none';
      this.ui.box.style.display = this.ui.tip.style.display = 'none';
      this.ui.toast.style.display = 'block';
      setTimeout(() => this.stop(), TOAST_MS);
    }
  }

  globalThis.TTAPicker = new Picker();
})();
