// Telegram Bot API notifications. Loaded only by the service worker and the popup:
// content scripts never send anything to Telegram.
(() => {
  if (globalThis.TTATelegram) return;

  const API = 'https://api.telegram.org';
  const MAX_TEXT = 4096; // Telegram's sendMessage limit

  const isConfigured = (settings) => TTA.isBotToken(settings.tgToken) && TTA.isChatId(settings.tgChatId);

  async function call(token, method, body) {
    if (!TTA.isBotToken(token)) throw new Error(TTAI18n.t('tgBadToken'));
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    // Only Telegram's own description is surfaced: the request URL contains the token.
    if (!data?.ok) throw new Error(data?.description ?? `HTTP ${res.status}`);
    return data.result;
  }

  function send(settings, text) {
    return call(settings.tgToken, 'sendMessage', {
      chat_id: settings.tgChatId,
      text: text.slice(0, MAX_TEXT),
      disable_web_page_preview: true,
    });
  }

  /** Chat of the latest message sent to the bot, so the user doesn't have to dig the id out of the API by hand. */
  async function findChatId(token) {
    const updates = await call(token, 'getUpdates', { limit: 100 });
    const chat = updates
      .map((u) => (u.message ?? u.channel_post ?? u.my_chat_member)?.chat)
      .filter(Boolean)
      .at(-1);
    return chat ? String(chat.id) : null;
  }

  globalThis.TTATelegram = Object.freeze({ isConfigured, send, findChatId });
})();
