// Why an AI provider call failed, in a form the app can act on — the same idea as the error table of
// Google's gemini-api CLI: Gemini puts a machine-readable reason in error.details[].reason
// (API_KEY_INVALID, BILLING_DISABLED, QUOTA_EXCEEDED …), OpenAI / BytePlus in error.code.
// With users' own API keys these are THEIR problems to fix (in Google AI Studio etc.), so they must see
// what is wrong instead of "rejected" or "busy".

/** a provider's error body (JSON text) → its reason code, e.g. "API_KEY_INVALID"; "" if none */
export function errorReason(text) {
  let j;
  try { j = typeof text === "string" ? JSON.parse(text) : text; } catch { return ""; }
  const e = Array.isArray(j) ? j[0]?.error : j?.error;
  if (!e || typeof e !== "object") return "";
  const detail = Array.isArray(e.details) ? e.details.find((d) => d?.reason)?.reason : "";
  return String(detail || e.code && typeof e.code === "string" && e.code || e.status || "");
}

/** "Gemini 400 [API_KEY_INVALID]: API key not valid…" — the reason goes first so a cut-off message keeps it */
export function providerError(prefix, status, text) {
  const reason = errorReason(text);
  let msg = text;
  try { msg = JSON.parse(text)?.error?.message || text; } catch { /* not JSON */ }
  return `${prefix} ${status}${reason ? ` [${reason}]` : ""}: ${String(msg).slice(0, 300)}`;
}

// order matters: the first match wins
const RULES = [
  ["key_invalid", /API_KEY_INVALID|API_KEY_MISSING|CREDENTIALS_MISSING|API key not valid|invalid_api_key|Incorrect API key|AuthenticationError|\bUNAUTHENTICATED\b|Invalid credentials|^Higgsfield 401/i],
  ["key_restricted", /API_KEY_(SERVICE|IP_ADDRESS|HTTP_REFERRER)_BLOCKED/i],
  ["key_suspended", /CONSUMER_SUSPENDED/i],
  ["key_service_disabled", /SERVICE_DISABLED|API has not been used in project/i],
  // BytePlus: the key works but the account hasn't switched this model on in the ModelArk console
  ["key_model_off", /ModelNotOpen|has not activated the model|^Higgsfield 404/i],
  // free-tier keys get "limit: 0" for paid-only models such as Omni video; OpenAI: no credit balance
  // Higgsfield answers 403 when the prepaid balance is too low
  ["key_billing", /BILLING_DISABLED|billing (is )?(not enabled|disabled)|insufficient_quota|\blimit: 0\b|^Higgsfield 403|insufficient (balance|funds)/i],
  ["busy", /QUOTA_EXCEEDED|RESOURCE_EXHAUSTED|RATE_LIMIT_EXCEEDED|account_queue_full|high demand|\b429\b|\b503\b|^Higgsfield 423/i],
];

/**
 * an error message → "key_invalid" | "key_restricted" | "key_suspended" | "key_service_disabled" | "key_model_off" |
 * "key_billing" | "busy" | null. key_* = the API key / its project must be fixed by its owner.
 */
export function errorCode(message) {
  const m = String(message || "");
  return RULES.find(([, re]) => re.test(m))?.[0] || null;
}

export const isKeyProblem = (code) => Boolean(code?.startsWith("key_"));
