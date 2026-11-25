// Whose API keys a provider call uses: the user's own (Bring Your Own Key) or the server's .env keys.
// The API / worker wrap each request or job:  withKeys(await loadUserKeys(userId), () => …)
// and every provider reads its key through env() instead of process.env.
//   no context            → process.env (CLI tools, tests)
//   { gemini, seedance?, openai? } → the user's own keys; the server's keys are never used for them
//                         (openai → their scripts are written by OWN_OPENAI_MODEL, default gpt-4.1-mini)
//   { none: true }        → no keys at all (OWN_KEYS_ONLY=1 and the user has not added a key)
//   {}                    → the server's keys (paid with credits)
import { AsyncLocalStorage } from "node:async_hooks";
import { providerError, errorCode } from "./api-errors.js";

const als = new AsyncLocalStorage();

/** OWN_KEYS_ONLY=1: every user must bring their own Gemini key (the server's keys are for nobody) */
export const ownKeysOnly = () => /^(1|true|yes|on)$/i.test(process.env.OWN_KEYS_ONLY || "");

/** the keys a request / job runs with: the user's own when they have a Gemini key, else the server's */
export function userKeyContext(userKeys) {
  if (userKeys?.gemini) return { gemini: userKeys.gemini, seedance: userKeys.seedance || "", openai: userKeys.openai || "" };
  return ownKeysOnly() ? { none: true } : {};
}

export const withKeys = (ctx, fn) => als.run(ctx || {}, fn);

/** this request / job uses the user's own keys (→ no credits are charged) */
export const usingOwnKeys = () => Boolean(als.getStore()?.gemini);

/** OWN_KEYS_ONLY and the user hasn't added a key yet */
export const keyMissing = () => Boolean(als.getStore()?.none);

const BLANK = { GEMINI_API_KEY: "", SEEDANCE_API_KEY: "", LLM_API_KEY: "", AZURE_SPEECH_KEY: "" };

/** the environment provider calls read their API keys from */
export function env() {
  const k = als.getStore();
  if (k?.gemini) {
    return {
      ...process.env, ...BLANK, GEMINI_API_KEY: k.gemini, SEEDANCE_API_KEY: k.seedance || "",
      // their own OpenAI key writes the scripts; the server's LLM model / URL settings don't apply to it
      ...(k.openai ? {
        LLM_API_KEY: k.openai, LLM_BASE_URL: "", LLM_MODEL: process.env.OWN_OPENAI_MODEL || "gpt-4.1-mini",
        LLM_MODEL_TH: "", LLM_MODEL_MY: "", LLM_FALLBACK_MODELS: "",
      } : {}),
    };
  }
  if (k?.none) return { ...process.env, ...BLANK };
  return process.env;
}

const GEMINI_BASE = () => (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
const SEEDANCE_BASE = () => (process.env.SEEDANCE_BASE_URL || "https://ark.ap-southeast.bytepluses.com/api/v3").replace(/\/$/, "");

/**
 * Ask the provider whether a key works, without spending anything (lists models / tasks).
 * → { ok: true } | { ok: false, reason } (rejected) | { ok: null, reason } (couldn't tell, e.g. network)
 */
export async function checkKey(provider, key) {
  const req = {
    gemini: [`${GEMINI_BASE()}/models?pageSize=1`, { headers: { "x-goog-api-key": key } }],
    seedance: [`${SEEDANCE_BASE()}/contents/generations/tasks?page_num=1&page_size=1`, { headers: { Authorization: `Bearer ${key}` } }],
    openai: ["https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } }],
  }[provider];
  if (!req) return { ok: false, reason: `unknown provider ${provider}` };
  try {
    const res = await fetch(req[0], { ...req[1], signal: AbortSignal.timeout(15_000) });
    if (res.ok) return { ok: true };
    const text = await res.text();
    const reason = providerError(provider, res.status, text);
    // code: key_invalid / key_billing / … (see api-errors.js) — what the user has to fix
    return [400, 401, 403].includes(res.status) ? { ok: false, reason, code: errorCode(reason) || "key_invalid" } : { ok: null, reason };
  } catch (err) {
    return { ok: null, reason: err.message };
  }
}
