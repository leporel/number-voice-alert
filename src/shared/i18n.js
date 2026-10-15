// Interface and notification strings. Classic script shared by the service worker, content scripts and the popup.
// Own dictionary instead of chrome.i18n.getMessage: that one always follows the browser language
// and can't be switched from the extension settings. _locales only covers the manifest.
(() => {
  if (globalThis.TTAI18n) return;

  const LANGS = Object.freeze(['en', 'ru']);
  const FALLBACK_LANG = 'en';

  const MESSAGES = Object.freeze({
    en: {
      // units
      unitPt: 'pt',
      unitPoints: 'points',
      unit_s: 's',
      unit_m: 'min',
      unit_h: 'h',

      // header and main screen
      muteTitle: 'Turn sound on / off. Telegram keeps working',
      powerTitle: 'Turn the extension on / off: number tracking, voice and Telegram',
      soundOn: 'Sound on',
      soundOff: 'Sound off',
      powerOn: 'On',
      powerOff: 'Off',
      pick: 'Pick a number on the page',
      pickTitle: 'Click a number on the open page to add it to the watch list. Esc cancels',
      emptyLine1: 'Nothing is being watched yet.',
      emptyLine2: 'Open the site, press the button above and click the number you want to watch.',
      lastPhrase: 'Last phrase: ',

      // global settings
      settingsSummary: 'Voice and alerts',
      uiLang: 'Interface language',
      uiLangTitle: 'Language of the interface and Telegram messages. Spoken phrases follow the selected voice',
      uiLangAuto: 'Auto (browser language)',
      voice: 'Voice',
      voiceTitle:
        'Speech synthesizer voice. Phrases are spoken in Russian with Russian voices and in English with all others. ' +
        '“Auto” takes the first installed voice for the interface language',
      voiceAuto: 'Auto ({lang})',
      voiceOnline: 'online',
      voiceFemale: 'female',
      voiceMale: 'male',
      voiceOther: 'Other',
      noVoices: 'No {lang} voices found. Windows: Settings → Time & language → Speech → Add voices.',
      rate: 'Rate',
      rateTitle: 'Speech rate: 1 is normal, higher is faster, lower is slower',
      volume: 'Volume',
      volumeTitle: 'Volume of voice alerts relative to the system volume',
      pitch: 'Pitch',
      pitchTitle: 'Voice pitch: 1 is normal, lower is deeper, higher is higher',
      cooldown: 'Pause between phrases, s',
      cooldownTitle:
        'Minimum pause between step alerts for one number. If the number moved back during the pause, no extra alert is spoken',
      template: 'Phrase template',
      templateTitle: 'What a step alert is built from. Placeholders in braces are replaced with the values listed below',
      tplName: 'name',
      tplValue: 'number',
      tplDir: 'up/down',
      tplDelta: 'change',
      heartbeat: 'Repeat the current value every N minutes (0 — off)',
      heartbeatTitle:
        'Periodically speak the current values of all enabled numbers, even if they did not change. Minimum 0.5 min. Silent while muted or off',
      speakFraction: 'Speak the fractional part (off: 2388.5 → “2388”)',
      speakFractionTitle: 'When off, the fraction is not spoken and phrases get shorter. Steps and percents are still computed exactly',
      announceOnStart: 'Speak the value when tracking starts',
      announceOnStartTitle: 'Speak the number right after the element is picked and after the page with it reloads',
      lostAlert: 'Warn if the element disappears or the tab is closed',
      lostAlertTitle:
        'Say so when the number vanishes from the page (e.g. the site changed its layout) or its tab is closed, i.e. tracking stopped',
      highlight: 'Highlight watched elements on the page',
      highlightTitle: 'Outline watched numbers on the page with a yellow dashed frame, so it is clear what is being tracked',
      testVoice: 'Test voice',
      testVoiceTitle: 'Speak a test phrase with the current voice settings',

      // telegram
      tgToken: 'Bot token or a link containing it',
      tgTokenTitle:
        'Bot token from @BotFather (like 123456:ABC…). A whole api.telegram.org link works too, the token is extracted. Stored only in this browser',
      tgChatIdTitle: 'Where the bot sends messages: your numeric id, a group id or @name of a public channel',
      tgHint: 'Create a bot with @BotFather and paste its token. Send the bot any message and press “Find chat_id”. Messages arrive even while muted.',
      tgFind: 'Find chat_id',
      tgFindTitle: 'Take the chat_id from the latest message the bot received. Write something to the bot first',
      tgTest: 'Send test',
      tgTestTitle: 'Send a test message to check the token and chat_id',
      tgWait: 'Please wait…',
      tgError: 'Telegram error: {message}',
      tgNoChat: 'Nobody has written to the bot yet. Send it any message and press the button again.',
      tgChatFound: 'chat_id found: {id}',
      tgTestMessage: 'Number Voice Alert: connection test',
      tgTestSent: 'Test message sent.',
      tgBadToken: 'Invalid bot token',
      tgMove: '{label}: {dir} {amount} in {period} → {value}',
      moveUp: 'up',
      moveDown: 'down',

      // footer
      shortcuts: 'Keyboard shortcuts',
      shortcutsTitle: 'Open the browser page where extension shortcuts are assigned',
      shortcutsNone: 'not assigned',
      cmdMute: 'sound',
      cmdPause: 'on / off',
      cmdSpeak: 'speak',

      // watcher card
      enabledTitle: 'Turn tracking of this number on / off',
      namePlaceholder: 'Name',
      nameTitle: 'The name is spoken before the number and used in Telegram messages',
      speakTitle: 'Speak the current value',
      reconnectTitle: 'Reconnect to the tab if data stops arriving',
      repickTitle: 'Pick the number again on the active tab, e.g. if the site changed its layout',
      deleteTitle: 'Delete. Press again to confirm',
      deleteConfirm: 'Delete?',
      speakName: 'Speak the name',
      speakNameTitle: 'Say the name before the number. Turn off if there is only one number and the name is redundant',
      stepEnabled: 'Speak on step',
      stepEnabledTitle: 'Speak every time the number moves by a step',
      tgSend: 'Send to Telegram',
      tgStepTitle: 'Send step alerts to Telegram. Works while muted too',
      step: 'Step',
      stepTitle: 'How much the number must change for an alert: in points or percent. 0 means an alert on every change',
      decimals: 'Decimal places',
      decimalsTitle: 'How many decimal places to show and speak. “As on the page” takes the precision from the site',
      decimalsAuto: 'as on the page',
      skipDigits: 'Skip leading digits',
      skipDigitsTitle: 'How many leading digits not to speak, to keep phrases short. Handy when the first digits barely change. When tracking the fraction, its digits are skipped: 1.12260 with 1 → “2260”',
      skipDigitsHint: 'For example, 1: 2388 → “388”, without the thousands.',
      trackFraction: 'Track the fractional part (1.12260 → “12260”)',
      trackFractionTitle:
        'For quotes whose integer part barely changes. Steps and changes in points count in units of the last digit: ' +
        '3 means 0.00003 for 1.12260. The voice speaks only the fraction as a whole number, overriding the global fraction ' +
        'setting; “Skip leading digits” shortens it further (1: “2260”). Telegram messages keep the full number',
      snapToGrid: 'Snap to the step grid (2380, 2390, 2400…)',
      snapToGridTitle:
        'Alert on round levels that are multiples of the step, not one step away from the last spoken value. Works only for steps in points',
      moveSection: 'Sharp move',
      moveEnabled: 'Speak when the number changes by an amount within a time window',
      moveEnabledTitle: 'Speak about a sharp move: the number rose or fell by the given amount within the given time',
      tgMoveTitle: 'Send sharp move alerts to Telegram. Works while muted too',
      moveSize: 'Change by',
      moveSizeTitle: 'How far the number must move either way from the window’s low or high',
      moveWindow: 'Within',
      moveWindowTitle: 'Time window the change is measured over',
      moveHint: 'For example, 1% in 5 min: “Up 1 percent in 5 minutes, 2388”. After an alert the window starts over.',
      selector: 'CSS selector',
      selectorTitle: 'How the extension finds the number on the page. Usually changed by picking the element again; edit by hand only if you know CSS',

      // card status
      summaryStepOff: 'Step off',
      summaryStep: 'Step {step}',
      summaryEveryChange: 'Every change',
      summaryMove: 'Move {size} / {window}',
      summaryTgToo: ' + TG',
      summaryTgOnly: ' (TG only)',
      statusWaiting: 'waiting for data',
      statusExtensionOff: 'extension is off',
      statusOff: 'off',
      statusLost: 'element not found',
      statusClosed: 'tab closed',
      secondsAgo: '{n} s ago',
      minutesAgo: '{n} min ago',

      // notices
      errorGeneric: 'Something went wrong. Details are in the extension console.',
      noSiteAccess: 'No access to sites. Open the extension settings and set “Site access” to “On all sites”.',
      noOpenTab: 'No open tab for {host}. Open the page with the number.',
      noActiveTab: 'Could not determine the active tab.',
      pickFailed: 'Could not start picking on {url}: {message}',
      pickBlocked:
        'The browser blocks extensions on this tab. Yandex Browser opens banking sites in “Protected mode” — ' +
        'turn it off for the site via the icon on the left of the address bar and reload the page.',

      // picker on the page
      pickerHint: 'Hover a number and click.',
      pickerHintNav: 'parent/child',
      pickerHintCancel: 'cancel',
      pickerTitle: 'Watch this number',
      pickerNow: 'Now:',
      pickerName: 'Name (will be spoken)',
      pickerNamePlaceholder: 'e.g. Index',
      pickerStep: 'Alert step (0 — every change)',
      pickerCancel: 'Cancel',
      pickerSave: 'Save',
      pickerSaved: 'Saved — watching the value',
      pickerNumber: 'Number: {value}',
      pickerNoNumber: 'No number found',
    },

    ru: {
      unitPt: 'пт',
      unitPoints: 'пунктов',
      unit_s: 'с',
      unit_m: 'мин',
      unit_h: 'ч',

      muteTitle: 'Включить / выключить звук. Telegram продолжит работать',
      powerTitle: 'Включить / выключить расширение: слежение за числами, голос и Telegram',
      soundOn: 'Звук вкл.',
      soundOff: 'Звук выкл.',
      powerOn: 'Включено',
      powerOff: 'Выключено',
      pick: 'Выбрать число на странице',
      pickTitle: 'Кликните по числу на открытой странице, и оно добавится в список отслеживаемых. Esc отменяет выбор',
      emptyLine1: 'Пока ничего не отслеживается.',
      emptyLine2: 'Откройте нужный сайт, нажмите кнопку выше и кликните по числу, за которым нужно следить.',
      lastPhrase: 'Последняя фраза: ',

      settingsSummary: 'Голос и оповещения',
      uiLang: 'Язык интерфейса',
      uiLangTitle: 'Язык интерфейса и сообщений Telegram. Язык озвучки определяется выбранным голосом',
      uiLangAuto: 'Авто (язык браузера)',
      voice: 'Голос',
      voiceTitle:
        'Голос синтезатора речи. С русскими голосами фразы произносятся по-русски, с остальными — по-английски. ' +
        '«Авто» берёт первый установленный голос для языка интерфейса',
      voiceAuto: 'Авто ({lang})',
      voiceOnline: 'онлайн',
      voiceFemale: 'женский',
      voiceMale: 'мужской',
      voiceOther: 'Другие',
      noVoices: 'Голоса для языка «{lang}» не найдены. Windows: Параметры → Время и язык → Речь → Добавить голоса.',
      rate: 'Скорость',
      rateTitle: 'Скорость речи: 1 обычная, больше быстрее, меньше медленнее',
      volume: 'Громкость',
      volumeTitle: 'Громкость голосовых оповещений относительно системной громкости',
      pitch: 'Тон',
      pitchTitle: 'Высота голоса: 1 обычная, меньше ниже, больше выше',
      cooldown: 'Пауза между фразами, с',
      cooldownTitle:
        'Минимальная пауза между оповещениями по шагу для одного числа. Если за паузу число вернулось назад, лишнего оповещения не будет',
      template: 'Шаблон фразы',
      templateTitle: 'Из чего собирается фраза оповещения по шагу. Подстановки в фигурных скобках заменяются значениями, перечисленными ниже',
      tplName: 'название',
      tplValue: 'число',
      tplDir: 'вверх/вниз',
      tplDelta: 'изменение',
      heartbeat: 'Напоминать текущее значение каждые N минут (0 — выкл.)',
      heartbeatTitle:
        'Периодически озвучивать текущие значения всех включённых чисел, даже если они не менялись. Минимум 0,5 мин. Молчит при выключенном звуке или расширении',
      speakFraction: 'Озвучивать дробную часть (выкл.: 2388,5 → «2388»)',
      speakFractionTitle: 'Если выключено, дробная часть не произносится, и фразы получаются короче. Шаг и проценты при этом считаются точно',
      announceOnStart: 'Озвучивать значение при начале слежения',
      announceOnStartTitle: 'Произносить число сразу после выбора элемента и после перезагрузки страницы с ним',
      lostAlert: 'Предупреждать, если элемент пропал или вкладка закрыта',
      lostAlertTitle:
        'Голосом сообщать, если число пропало со страницы (например, сайт поменял вёрстку) или вкладка с ним закрыта, то есть слежение остановилось',
      highlight: 'Подсвечивать отслеживаемые элементы на странице',
      highlightTitle: 'Обводить отслеживаемые числа на странице жёлтой пунктирной рамкой, чтобы было видно, за чем идёт слежение',
      testVoice: 'Проверить голос',
      testVoiceTitle: 'Произнести тестовую фразу с текущими настройками голоса',

      tgToken: 'Токен бота или ссылка с ним',
      tgTokenTitle:
        'Токен бота от @BotFather (вида 123456:ABC…). Можно вставить целую ссылку api.telegram.org, токен извлечётся сам. Хранится только в этом браузере',
      tgChatIdTitle: 'Куда бот отправляет сообщения: ваш числовой id, id группы или @имя публичного канала',
      tgHint: 'Создайте бота у @BotFather и вставьте токен. Напишите боту любое сообщение и нажмите «Найти chat_id». Сообщения приходят и при выключенном звуке.',
      tgFind: 'Найти chat_id',
      tgFindTitle: 'Взять chat_id из последнего сообщения, которое получил бот. Сначала напишите боту что-нибудь',
      tgTest: 'Отправить тест',
      tgTestTitle: 'Отправить тестовое сообщение, чтобы проверить токен и chat_id',
      tgWait: 'Подождите…',
      tgError: 'Ошибка Telegram: {message}',
      tgNoChat: 'Боту ещё никто не писал. Отправьте ему любое сообщение и нажмите ещё раз.',
      tgChatFound: 'chat_id найден: {id}',
      tgTestMessage: 'Number Voice Alert: проверка связи',
      tgTestSent: 'Тестовое сообщение отправлено.',
      tgBadToken: 'Неверный токен бота',
      tgMove: '{label}: {dir} {amount} за {period} → {value}',
      moveUp: 'рост',
      moveDown: 'падение',

      shortcuts: 'Горячие клавиши',
      shortcutsTitle: 'Открыть страницу браузера, где назначаются горячие клавиши расширения',
      shortcutsNone: 'не назначены',
      cmdMute: 'звук',
      cmdPause: 'вкл / выкл',
      cmdSpeak: 'озвучить',

      enabledTitle: 'Включить / выключить слежение за этим числом',
      namePlaceholder: 'Название',
      nameTitle: 'Название произносится перед числом и подставляется в сообщения Telegram',
      speakTitle: 'Озвучить текущее значение',
      reconnectTitle: 'Переподключиться к вкладке, если данные не приходят',
      repickTitle: 'Заново выбрать число на активной вкладке, например если сайт поменял вёрстку',
      deleteTitle: 'Удалить. Для подтверждения нажмите ещё раз',
      deleteConfirm: 'Удалить?',
      speakName: 'Озвучивать название',
      speakNameTitle: 'Произносить название перед числом. Выключите, если число одно и название лишнее',
      stepEnabled: 'Озвучивать по шагу',
      stepEnabledTitle: 'Голосом сообщать каждый раз, когда число сдвинулось на шаг',
      tgSend: 'Отправлять в Telegram',
      tgStepTitle: 'Отправлять оповещения по шагу в Telegram. Работает и при выключенном звуке',
      step: 'Шаг',
      stepTitle: 'На сколько должно измениться число, чтобы прозвучало оповещение: в пунктах или процентах. 0 означает оповещение при каждом изменении',
      decimals: 'Знаков после запятой',
      decimalsTitle: 'Сколько знаков после запятой показывать и произносить. «Как на странице» берёт точность с сайта',
      decimalsAuto: 'как на странице',
      skipDigits: 'Не озвучивать первые цифры',
      skipDigitsTitle: 'Сколько старших цифр не произносить, чтобы фраза была короче. Удобно, когда первые цифры почти не меняются. При отслеживании дробной части пропускаются её цифры: 1,12260 с 1 → «2260»',
      skipDigitsHint: 'Например, 1: 2388 → «триста восемьдесят восемь», без «двух тысяч».',
      trackFraction: 'Отслеживать дробную часть (1,12260 → «12260»)',
      trackFractionTitle:
        'Для котировок, у которых целая часть почти не меняется. Шаг и изменение в пунктах считаются в единицах последней цифры: ' +
        '3 означает 0,00003 для 1,12260. Голосом произносится только дробь целым числом, вместо общей настройки дробной части; ' +
        '«Не озвучивать первые цифры» сокращает её ещё сильнее (1: «2260»). В Telegram приходит полное число',
      snapToGrid: 'Привязка к сетке шага (2380, 2390, 2400…)',
      snapToGridTitle:
        'Оповещать на круглых уровнях, кратных шагу, а не через шаг от последнего названного значения. Работает только для шага в пунктах',
      moveSection: 'Резкое движение',
      moveEnabled: 'Озвучивать, если число изменилось на величину за время',
      moveEnabledTitle: 'Голосом сообщать о резком движении: число выросло или упало на заданную величину за заданное время',
      tgMoveTitle: 'Отправлять оповещения о резком движении в Telegram. Работает и при выключенном звуке',
      moveSize: 'Изменение на',
      moveSizeTitle: 'Насколько должно измениться число в любую сторону от минимума или максимума за окно времени',
      moveWindow: 'За время',
      moveWindowTitle: 'Окно времени, за которое считается изменение',
      moveHint: 'Например, 1% за 5 мин: «Рост на процент за пять минут, две тысячи…». После оповещения отсчёт начинается заново.',
      selector: 'CSS-селектор',
      selectorTitle: 'Как расширение находит число на странице. Обычно меняется кнопкой выбора элемента заново; правьте вручную, только если знаете CSS',

      summaryStepOff: 'Шаг выкл.',
      summaryStep: 'Шаг {step}',
      summaryEveryChange: 'Каждое изменение',
      summaryMove: 'Рывок {size} / {window}',
      summaryTgToo: ' + TG',
      summaryTgOnly: ' (только TG)',
      statusWaiting: 'ожидание данных',
      statusExtensionOff: 'расширение выключено',
      statusOff: 'выключено',
      statusLost: 'элемент не найден',
      statusClosed: 'вкладка закрыта',
      secondsAgo: '{n} с назад',
      minutesAgo: '{n} мин назад',

      errorGeneric: 'Что-то пошло не так. Подробности в консоли расширения.',
      noSiteAccess: 'Нет доступа к сайтам. Откройте настройки расширения и в «Доступ к сайтам» выберите «На всех сайтах».',
      noOpenTab: 'Не найдено открытой вкладки {host}. Откройте страницу с числом.',
      noActiveTab: 'Не удалось определить активную вкладку.',
      pickFailed: 'Не удалось запустить выбор на {url}: {message}',
      pickBlocked:
        'Браузер запрещает расширениям доступ к этой вкладке. В Яндекс Браузере банковские сайты ' +
        'открываются в «Защищённом режиме» — отключите его для сайта через значок слева в адресной строке и перезагрузите страницу.',

      pickerHint: 'Наведите на число и кликните.',
      pickerHintNav: 'родитель/потомок',
      pickerHintCancel: 'отмена',
      pickerTitle: 'Следить за этим числом',
      pickerNow: 'Сейчас:',
      pickerName: 'Название (будет произноситься)',
      pickerNamePlaceholder: 'например: Индекс',
      pickerStep: 'Шаг оповещения (0 — каждое изменение)',
      pickerCancel: 'Отмена',
      pickerSave: 'Сохранить',
      pickerSaved: 'Сохранено — слежу за значением',
      pickerNumber: 'Число: {value}',
      pickerNoNumber: 'Число не найдено',
    },
  });

  /** "en-US" -> "en" */
  const langBase = (tag) => (typeof tag === 'string' ? tag.split(/[-_]/)[0].toLowerCase() : '');

  const isSupported = (lang) => LANGS.includes(lang);

  function browserLang() {
    const lang = langBase(chrome.i18n.getUILanguage());
    return isSupported(lang) ? lang : FALLBACK_LANG;
  }

  /** A saved preference wins; an empty one ("auto") follows the browser, falling back to English. */
  const resolveLang = (preference) => (isSupported(preference) ? preference : browserLang());

  let currentLang = browserLang();

  function setLang(preference) {
    currentLang = resolveLang(preference);
    return currentLang;
  }

  const getLang = () => currentLang;

  /** Fills {placeholders}; unknown ones stay as typed so a missing var is visible instead of silently empty. */
  const format = (text, vars) =>
    vars ? text.replace(/\{(\w+)\}/g, (match, key) => (Object.hasOwn(vars, key) ? String(vars[key]) : match)) : text;

  function t(key, vars) {
    const text = MESSAGES[currentLang][key] ?? MESSAGES[FALLBACK_LANG][key] ?? key;
    return format(text, vars);
  }

  globalThis.TTAI18n = Object.freeze({ LANGS, langBase, isSupported, resolveLang, setLang, getLang, format, t });
})();
