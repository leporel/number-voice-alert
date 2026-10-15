// Spoken phrases per speech language, voice selection and the chrome.tts wrapper.
// Service worker and popup only: content scripts have no chrome.tts.
(() => {
  if (globalThis.TTASpeech) return;

  const { format, langBase, isSupported, resolveLang } = TTAI18n;
  const MAX_DECIMALS = TTA.LIMITS.decimals[1];

  /**
   * A speech locale turns numbers and events into words for one language.
   * Contract: { tag, integer(n), decimal(value, digits), percent(pct, isInteger), period(count, unit),
   *             dir(up), move({ up, amount, period, value }), phrases }
   */
  function createRussian() {
    const ONES_MASC = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
    const ONES_FEM = ['', 'одна', 'две', ...ONES_MASC.slice(3)];
    // Accusative feminine for "за одну минуту", "за двадцать одну секунду".
    const ONES_FEM_ACC = ['', 'одну', 'две', ...ONES_MASC.slice(3)];
    const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
    const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
    const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
    // Index = power of 1000. "тысяча" is feminine: "одна тысяча", "две тысячи".
    const SCALES = [
      null,
      { forms: ['тысяча', 'тысячи', 'тысяч'], ones: ONES_FEM },
      { forms: ['миллион', 'миллиона', 'миллионов'], ones: ONES_MASC },
      { forms: ['миллиард', 'миллиарда', 'миллиардов'], ones: ONES_MASC },
    ];
    const MAX_WORDS_NUMBER = 1e12;
    const PERCENT_FORMS = ['процент', 'процента', 'процентов'];
    const PERIOD_WORDS = Object.freeze({
      s: { forms: ['секунду', 'секунды', 'секунд'], ones: ONES_FEM_ACC },
      m: { forms: ['минуту', 'минуты', 'минут'], ones: ONES_FEM_ACC },
      h: { forms: ['час', 'часа', 'часов'], ones: ONES_MASC },
    });

    /** Formats a number so a Russian TTS voice reads it naturally ("2388,5" -> "две тысячи ... запятая пять"). */
    const decimal = (value, digits) => value.toFixed(digits).replace('.', ',').replace(/^-/, 'минус ');

    /** Russian plural form index: 1 тысяча / 2 тысячи / 5 тысяч. */
    function pluralIndex(n) {
      const lastTwo = n % 100;
      const last = n % 10;
      if (last === 1 && lastTwo !== 11) return 0;
      if (last >= 2 && last <= 4 && (lastTwo < 10 || lastTwo >= 20)) return 1;
      return 2;
    }

    function tripletToWords(n, ones) {
      const words = [HUNDREDS[Math.floor(n / 100)]];
      const rest = n % 100;
      if (rest >= 10 && rest < 20) {
        words.push(TEENS[rest - 10]);
      } else {
        words.push(TENS[Math.floor(rest / 10)], ones[rest % 10]);
      }
      return words.filter(Boolean);
    }

    /**
     * Integer in Russian words. Speech engines read bare integers inconsistently
     * (some append "целых"), plain words leave them nothing to interpret.
     * `ones` picks gender/case of the last digit word for the noun that follows.
     */
    function integerToWords(value, ones = ONES_MASC) {
      let n = Math.abs(Math.trunc(value));
      if (n >= MAX_WORDS_NUMBER) return decimal(Math.trunc(value), 0);
      if (n === 0) return 'ноль';
      const groups = [];
      for (let scale = 0; n > 0; scale++, n = Math.floor(n / 1000)) {
        const triplet = n % 1000;
        if (!triplet) continue;
        // Spoken Russian says "тысяча сто", not "одна тысяча сто".
        const words = scale === 1 && triplet === 1 ? [] : tripletToWords(triplet, scale ? SCALES[scale].ones : ones);
        if (scale) words.push(SCALES[scale].forms[pluralIndex(triplet)]);
        groups.unshift(words.join(' '));
      }
      return (value < 0 ? 'минус ' : '') + groups.join(' ');
    }

    /** "минуту", "две минуты", "пять минут": a lone 1 is dropped as in natural speech ("за минуту"). */
    function countWithNoun(n, forms, ones) {
      return n === 1 ? forms[0] : `${integerToWords(n, ones)} ${forms[pluralIndex(n)]}`;
    }

    return Object.freeze({
      tag: 'ru-RU',
      integer: (n) => integerToWords(n),
      decimal,
      // Fractions always take "процента": "1,5 процента".
      percent: (pct, isInteger) =>
        isInteger ? countWithNoun(pct, PERCENT_FORMS, ONES_MASC) : `${decimal(pct, 1)} ${PERCENT_FORMS[1]}`,
      period(count, unit) {
        const { forms, ones } = PERIOD_WORDS[unit];
        return `за ${countWithNoun(count, forms, ones)}`;
      },
      dir: (up) => (up ? 'вверх' : 'вниз'),
      move: ({ up, amount, period, value }) => `${up ? 'Рост' : 'Падение'} на ${amount} ${period}, ${value}`,
      phrases: Object.freeze({
        elementLost: 'Элемент не найден',
        tabClosed: 'Вкладка закрыта, слежение остановлено',
        extensionOn: 'Расширение включено',
        extensionOff: 'Расширение выключено',
        soundOn: 'Звук включён',
        soundOff: 'Звук выключен',
        noData: 'Нет данных',
        voiceTest: 'Проверка голоса. Индекс {value}',
      }),
    });
  }

  function createEnglish() {
    const PERIOD_WORDS = Object.freeze({ s: ['a second', 'seconds'], m: ['a minute', 'minutes'], h: ['an hour', 'hours'] });
    // English engines read digits well ("2388.5" -> "two thousand ... point five"), so no number-to-words here.
    const decimal = (value, digits) => value.toFixed(digits);

    return Object.freeze({
      tag: 'en-US',
      integer: (n) => String(n),
      decimal,
      percent: (pct, isInteger) => `${isInteger ? pct : decimal(pct, 1)} percent`,
      period: (count, unit) => (count === 1 ? `in ${PERIOD_WORDS[unit][0]}` : `in ${count} ${PERIOD_WORDS[unit][1]}`),
      dir: (up) => (up ? 'up' : 'down'),
      move: ({ up, amount, period, value }) => `${up ? 'Up' : 'Down'} ${amount} ${period}, ${value}`,
      phrases: Object.freeze({
        elementLost: 'Element not found',
        tabClosed: 'Tab closed, tracking stopped',
        extensionOn: 'Extension on',
        extensionOff: 'Extension off',
        soundOn: 'Sound on',
        soundOff: 'Sound off',
        noData: 'No data',
        voiceTest: 'Voice check. Index {value}',
      }),
    });
  }

  const LOCALES = Object.freeze({ ru: createRussian(), en: createEnglish() });
  const FALLBACK_SPEECH_LANG = 'en';

  /**
   * Phrases follow the chosen voice: a Russian voice speaks Russian, any other voice speaks English.
   * With the automatic voice they follow the interface language.
   */
  function speechLang(settings) {
    if (!settings.voiceLang) return resolveLang(settings.uiLang);
    const lang = langBase(settings.voiceLang);
    return isSupported(lang) ? lang : FALLBACK_SPEECH_LANG;
  }

  /**
   * Drops the first `count` digits of the integer part: 2388,5 with 1 -> 388,5, 2005 with 1 -> 5.
   * If that would leave no integer digits (the value shrank to fewer digits), the value is kept whole.
   */
  function trimLeadingDigits(value, count) {
    const abs = Math.abs(value);
    const keep = String(Math.trunc(abs)).length - count;
    if (count <= 0 || keep < 1) return value;
    const trimmed = abs % 10 ** keep;
    return value < 0 ? -trimmed : trimmed;
  }

  function createSpeaker(locale, skipFraction) {
    /**
     * Number as it should be spoken. With skipFraction the fraction is truncated, not rounded:
     * saying "2389" for 2388.9 would claim a level the price hasn't reached yet.
     * Values below 1 keep their fraction, otherwise a small delta would be spoken as "zero".
     */
    function number(value, decimals) {
      if (skipFraction && Math.abs(value) >= 1) return locale.integer(Math.trunc(value));
      const digits = Math.max(0, Math.min(MAX_DECIMALS, decimals));
      // "2387,0" makes engines say "...seven point zero"; a zero fraction is just an integer.
      const shown = Number(value.toFixed(digits));
      if (Number.isInteger(shown)) return locale.integer(shown);
      return locale.decimal(value, digits);
    }

    /**
     * The watched value as spoken, honoring the watcher's skipDigits and trackFraction. The fraction is cut before
     * trimming: otherwise 2000,5 -> 0,5 would fall under number()'s "keep the fraction below 1" rule meant for deltas.
     */
    function value(watcher, raw, decimals) {
      const digits = Math.max(0, Math.min(MAX_DECIMALS, decimals));
      // Quotes like 1.12260 move only in the fraction; it is spoken as a whole number ("12260"),
      // regardless of the global fraction setting. Without shown decimals there is no fraction to speak.
      if (watcher.trackFraction && digits > 0) {
        // Skipped digits are counted on the fraction as displayed, zeros included: 1.09870 with 1 -> "9870".
        // At least the last digit is always spoken.
        const fraction = Math.abs(raw).toFixed(digits).split('.')[1];
        const skip = Math.min(watcher.skipDigits, fraction.length - 1);
        return locale.integer(Number(fraction.slice(skip)));
      }
      const base = skipFraction && Math.abs(raw) >= 1 ? Math.trunc(raw) : raw;
      return number(trimLeadingDigits(base, watcher.skipDigits), decimals);
    }

    /** An absolute change in the watcher's points: "3" rather than "0.00003" when only the fraction is spoken. */
    function points(watcher, amount, decimals) {
      const size = TTA.pointSize(watcher, decimals);
      return size === 1 ? number(amount, decimals) : locale.integer(Math.round(amount / size));
    }

    /** Percent rounded to tenths; skipFraction truncates like number(), keeping the fraction below 1. */
    function percent(pct) {
      const tenths = Math.round(pct * 10) / 10;
      const rounded = skipFraction && tenths >= 1 ? Math.trunc(tenths) : tenths;
      return locale.percent(rounded, Number.isInteger(rounded));
    }

    return Object.freeze({
      tag: locale.tag,
      number,
      value,
      points,
      percent,
      period: locale.period,
      dir: locale.dir,
      move: locale.move,
      phrase: (key, vars) => format(locale.phrases[key], vars),
    });
  }

  // Only a handful of language/fraction combinations exist; reuse them instead of rebuilding per phrase.
  const speakers = new Map();

  function speaker(settings) {
    const lang = speechLang(settings);
    const skipFraction = TTA.skipsFraction(settings);
    const key = `${lang}|${skipFraction}`;
    if (!speakers.has(key)) speakers.set(key, createSpeaker(LOCALES[lang], skipFraction));
    return speakers.get(key);
  }

  // --- voices ---

  // Widespread languages that have built-in Windows voices; the voice list is limited to them.
  const POPULAR_LANGS = Object.freeze(['en', 'ru', 'es', 'de', 'fr', 'it', 'pt', 'zh', 'ja', 'ko']);
  const VOICES_PER_LANG = 2;
  const GENDER = Object.freeze({ FEMALE: 'female', MALE: 'male' });

  // chrome.tts dropped the gender field, so it is guessed from well-known Windows and Google voice names.
  const FEMALE_HINTS = [
    'female', 'zira', 'hazel', 'susan', 'heather', 'linda', 'catherine', 'irina', 'svetlana', 'ekaterina',
    'helena', 'laura', 'sabina', 'hedda', 'katja', 'hortense', 'julie', 'elsa', 'maria', 'francisca',
    'huihui', 'yaoyao', 'xiaoxiao', 'haruka', 'ayumi', 'sayaka', 'nanami', 'heami', 'sunhi', 'aria', 'jenny',
    'google us english', 'google русский', 'google deutsch', 'google français', 'google italiano',
    'google 日本語', 'google 한국의', 'google 普通话', 'google português do brasil',
  ];
  const MALE_HINTS = [
    'male', 'david', 'mark', 'george', 'james', 'richard', 'pavel', 'dmitry', 'pablo', 'raul', 'stefan',
    'paul', 'claude', 'cosimo', 'daniel', 'kangkang', 'yunxi', 'ichiro', 'keita', 'injoon', 'guy',
  ];

  /**
   * Only the name before the language part is matched: "Microsoft Helle - Danish (Denmark)" would hit "mark".
   * Female hints go first: "female" contains "male", "paulina" contains "paul".
   */
  function voiceGender(voice) {
    const name = voice.voiceName.toLowerCase().split(/\s[-(]/)[0];
    if (FEMALE_HINTS.some((hint) => name.includes(hint))) return GENDER.FEMALE;
    if (MALE_HINTS.some((hint) => name.includes(hint))) return GENDER.MALE;
    return null;
  }

  async function getVoices() {
    const voices = await chrome.tts.getVoices();
    return voices.filter((v) => v.voiceName);
  }

  // Online voices fail without network, so installed ones are preferred.
  const byLocalFirst = (a, b) => Number(Boolean(a.remote)) - Number(Boolean(b.remote));

  /** First installed voice for the language, an online one if nothing is installed. */
  function findVoice(voices, lang) {
    return voices.filter((v) => langBase(v.lang) === lang).sort(byLocalFirst)[0] ?? null;
  }

  /** A female and a male voice where the names tell them apart; free slots go to the remaining voices. */
  function pickPair(entries) {
    const picked = [GENDER.FEMALE, GENDER.MALE].map((g) => entries.find((e) => e.gender === g)).filter(Boolean);
    for (const entry of entries) {
      if (picked.length >= VOICES_PER_LANG) break;
      if (!picked.includes(entry)) picked.push(entry);
    }
    return picked;
  }

  /**
   * Voices offered in the settings: up to two per popular language, as [{ lang, voices: [{ voice, gender }] }].
   * The saved voice is always kept, even outside the shortlist, so the selection doesn't silently vanish.
   */
  function shortlistVoices(voices, savedName) {
    const entries = [...voices].sort(byLocalFirst).map((voice) => ({ voice, gender: voiceGender(voice) }));
    const groups = POPULAR_LANGS.map((lang) => ({
      lang,
      voices: pickPair(entries.filter((e) => langBase(e.voice.lang) === lang)),
    }));

    const saved = entries.find((e) => e.voice.voiceName === savedName);
    if (saved && !groups.some((g) => g.voices.includes(saved))) {
      const lang = langBase(saved.voice.lang);
      let group = groups.find((g) => g.lang === lang);
      if (!group) {
        group = { lang, voices: [] };
        groups.push(group);
      }
      group.voices.push(saved);
    }
    return groups.filter((g) => g.voices.length);
  }

  // --- speaking ---

  function speakOnce(text, options) {
    return new Promise((resolve, reject) => {
      chrome.tts.speak(text, options, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    });
  }

  /**
   * Speaks text with the saved voice, or the first voice of the speech language when none is saved.
   * Falls back to the engine's default voice for the phrase language if the saved voice disappeared
   * (e.g. an online Google voice while offline).
   */
  async function speak(text, settings, { interrupt = false } = {}) {
    const lang = speechLang(settings);
    const base = {
      lang: LOCALES[lang].tag,
      rate: settings.rate,
      pitch: settings.pitch,
      volume: settings.volume,
      enqueue: !interrupt,
    };
    let voice = settings.voiceName ? { voiceName: settings.voiceName, lang: settings.voiceLang } : null;
    voice ??= findVoice(await getVoices(), lang);
    if (!voice) return speakOnce(text, base);
    try {
      await speakOnce(text, { ...base, voiceName: voice.voiceName, lang: voice.lang || base.lang });
    } catch (err) {
      console.warn('[TTA] voice failed, falling back to default:', err.message);
      await speakOnce(text, base);
    }
  }

  globalThis.TTASpeech = Object.freeze({
    GENDER,
    speechLang,
    speaker,
    getVoices,
    findVoice,
    shortlistVoices,
    speak,
  });
})();
