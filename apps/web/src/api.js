const TOKEN_KEY = "avs_token";

export const auth = {
  get token() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set token(v) { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch {} },
};

export async function api(path, { method = "GET", body, form } = {}) {
  const headers = {};
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`/api${path}`, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  if (res.status === 401) { auth.token = null; if (!location.pathname.startsWith("/login")) location.href = "/login"; }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// the header shows the credit balance; pages call creditsChanged() after spending or a refund
const CREDITS_EVENT = "avs:credits";
export const creditsChanged = () => window.dispatchEvent(new Event(CREDITS_EVENT));
export const onCreditsChanged = (fn) => { window.addEventListener(CREDITS_EVENT, fn); return () => window.removeEventListener(CREDITS_EVENT, fn); };

/** the language of the VIDEOS (not of the interface) */
export const LANGS = { th: "ไทย (Thai)", my: "မြန်မာ (Myanmar)" };
export const LANG_FLAG = { th: "🇹🇭", my: "🇲🇲" };
