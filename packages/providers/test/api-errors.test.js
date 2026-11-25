import test from "node:test";
import assert from "node:assert/strict";
import { errorReason, providerError, errorCode, isKeyProblem } from "../src/api-errors.js";
import { publicError, publicErrorCode } from "../../../apps/api/src/validate.js";

// real error bodies (shortened) from Gemini, OpenAI and BytePlus
const GEMINI_BAD_KEY = JSON.stringify({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT",
  details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID", domain: "googleapis.com" }] } });
const GEMINI_BILLING = JSON.stringify({ error: { code: 403, message: "This API method requires billing to be enabled.", status: "PERMISSION_DENIED",
  details: [{ reason: "BILLING_DISABLED" }] } });
const GEMINI_FREE_OMNI = JSON.stringify({ error: { code: 429, message: "Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-omni-1.2-flash", status: "RESOURCE_EXHAUSTED" } });
const OPENAI_BAD_KEY = JSON.stringify({ error: { message: "Incorrect API key provided: sk-fake0****0000.", type: "invalid_request_error", code: "invalid_api_key" } });
const OPENAI_NO_CREDIT = JSON.stringify({ error: { message: "You exceeded your current quota.", type: "insufficient_quota", code: "insufficient_quota" } });
const ARK_BAD_KEY = JSON.stringify({ error: { code: "AuthenticationError", message: "The API key format is incorrect.", type: "Unauthorized" } });

test("the provider's reason is extracted and put first in the message", () => {
  assert.equal(errorReason(GEMINI_BAD_KEY), "API_KEY_INVALID");
  assert.equal(errorReason(OPENAI_BAD_KEY), "invalid_api_key");
  assert.equal(errorReason(ARK_BAD_KEY), "AuthenticationError");
  assert.equal(errorReason("<html>bad gateway</html>"), "");
  assert.equal(providerError("Gemini", 400, GEMINI_BAD_KEY), "Gemini 400 [API_KEY_INVALID]: API key not valid. Please pass a valid API key.");
});

test("error messages → what the user must fix", () => {
  assert.equal(errorCode(providerError("Gemini", 400, GEMINI_BAD_KEY)), "key_invalid");
  assert.equal(errorCode(providerError("LLM", 401, OPENAI_BAD_KEY)), "key_invalid");
  assert.equal(errorCode(providerError("Seedance", 401, ARK_BAD_KEY)), "key_invalid");
  assert.equal(errorCode(providerError("Gemini", 403, GEMINI_BILLING)), "key_billing");
  assert.equal(errorCode(providerError("Gemini", 429, GEMINI_FREE_OMNI)), "key_billing");
  assert.equal(errorCode(providerError("LLM", 429, OPENAI_NO_CREDIT)), "key_billing");
  assert.equal(errorCode("Gemini 503: The model is overloaded (high demand)"), "busy");
  assert.equal(errorCode("ffmpeg failed"), null);
  assert.ok(isKeyProblem("key_billing") && !isKeyProblem("busy") && !isKeyProblem(null));
});

test("job errors: key problems say what to fix; own-key jobs never mention refunded credits", () => {
  const tts = "video-engine exited 1: Gemini TTS 400 [API_KEY_INVALID]: {...}";
  assert.equal(publicErrorCode(tts), "key_invalid");
  assert.match(publicError(tts), /Settings/);
  const busy = "Gemini 429 [RATE_LIMIT_EXCEEDED]: slow down";
  assert.match(publicError(busy), /credits were refunded/);
  assert.doesNotMatch(publicError(busy, { ownKey: true }), /credits/);
});
