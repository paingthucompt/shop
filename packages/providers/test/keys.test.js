import test from "node:test";
import assert from "node:assert/strict";
import { env, withKeys, userKeyContext, usingOwnKeys, keyMissing } from "../src/keys.js";
import { llmConfig } from "../src/llm.js";
import { aiVideoProvider } from "../src/seedance.js";

const saved = { ...process.env };
const restore = () => { for (const k of ["GEMINI_API_KEY", "SEEDANCE_API_KEY", "LLM_API_KEY", "OWN_KEYS_ONLY", "AI_VIDEO_PROVIDER", "LLM_MODEL_MY"]) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };

test("own Gemini key replaces every server key; server keys are never used for that user", () => {
  Object.assign(process.env, { GEMINI_API_KEY: "server-g", SEEDANCE_API_KEY: "server-s", LLM_API_KEY: "server-llm" });
  delete process.env.AI_VIDEO_PROVIDER;
  try {
    assert.equal(env().GEMINI_API_KEY, "server-g"); // no context → .env
    withKeys(userKeyContext({ gemini: "user-g" }), () => {
      assert.equal(usingOwnKeys(), true);
      assert.equal(env().GEMINI_API_KEY, "user-g");
      assert.equal(env().SEEDANCE_API_KEY, "");
      assert.equal(env().LLM_API_KEY, "");
      assert.equal(llmConfig(undefined, "th").key, "user-g");
      assert.equal(aiVideoProvider(), "gemini");
    });
    // Higgsfield replaced BytePlus: an old Seedance key is ignored, a Higgsfield key is used
    withKeys(userKeyContext({ gemini: "user-g", seedance: "user-s", higgsfield: "id:secret" }), () => {
      assert.equal(env().SEEDANCE_API_KEY, "");
      assert.equal(env().HIGGSFIELD_API_KEY, "id:secret");
    });
    // an OpenAI key alone doesn't take over: scripts stay on Gemini (better Burmese) unless the user picks OpenAI
    process.env.LLM_MODEL_MY = "gemini-3.6-flash";
    withKeys(userKeyContext({ gemini: "user-g", openai: "user-o" }), () => {
      assert.equal(llmConfig(undefined, "my").key, "user-g");
      assert.equal(llmConfig(undefined, "my").model, "gemini-3.6-flash");
    });
    withKeys(userKeyContext({ gemini: "user-g", openai: "user-o" }, { script: "openai:gpt-4.1" }), () => {
      const c = llmConfig(undefined, "my");
      assert.deepEqual([c.key, c.baseUrl, c.model, c.fallbacks], ["user-o", "https://api.openai.com/v1", "gpt-4.1", []]);
      assert.equal(env().GEMINI_API_KEY, "user-g"); // voices / pictures stay on Gemini
    });
    // picking OpenAI without an OpenAI key → still Gemini; a Gemini model → that model for both languages
    withKeys(userKeyContext({ gemini: "user-g" }, { script: "openai:gpt-4.1" }), () => assert.equal(llmConfig(undefined, "th").key, "user-g"));
    withKeys(userKeyContext({ gemini: "user-g" }, { script: "gemini-flash-lite-latest" }), () => assert.equal(llmConfig(undefined, "my").model, "gemini-flash-lite-latest"));
    // a Seedance key alone doesn't switch to own keys
    withKeys(userKeyContext({ seedance: "user-s" }), () => {
      assert.equal(usingOwnKeys(), false);
      assert.equal(env().GEMINI_API_KEY, "server-g");
    });
  } finally { restore(); }
});

test("OWN_KEYS_ONLY: a user without a key gets no keys at all", () => {
  Object.assign(process.env, { GEMINI_API_KEY: "server-g", OWN_KEYS_ONLY: "1" });
  try {
    withKeys(userKeyContext({}), () => {
      assert.equal(keyMissing(), true);
      assert.equal(env().GEMINI_API_KEY, "");
      assert.equal(llmConfig(undefined, "th"), null);
    });
    withKeys(userKeyContext({ gemini: "user-g" }), () => assert.equal(keyMissing(), false));
  } finally { restore(); }
});

test("AI prefs: only known choices are kept; voices and video defaults reach the providers", async () => {
  const { cleanPrefs } = await import("../src/ai-catalog.js");
  const { geminiSettings } = await import("../src/gemini-video.js");
  const { higgsfieldSettings } = await import("../src/higgsfield.js");
  const { aiVideoProvider } = await import("../src/seedance.js");
  assert.deepEqual(cleanPrefs({ script: "evil", voice: "Puck", voice_b: "Nope", gemini_video: "1080p", video_provider: "x", higgsfield_model: "kling-video/v4.0/image-to-video" }),
    { voice: "Puck", gemini_video: "1080p", higgsfield_model: "kling-video/v4.0/image-to-video" });
  const prefs = { voice: "Kore", voice_b: "Charon", video_provider: "higgsfield", gemini_video: "360p", higgsfield_model: "bytedance/seedance-2.5/image-to-video" };
  withKeys(userKeyContext({ gemini: "g", higgsfield: "id:s" }, prefs), () => {
    assert.equal(env().GEMINI_TTS_VOICE, "Kore");
    assert.equal(env().GEMINI_TTS_VOICE_B, "Charon");
    assert.equal(aiVideoProvider(), "higgsfield");
    assert.equal(aiVideoProvider("gemini"), "gemini"); // the per-video pick still wins
    assert.equal(geminiSettings().resolution, "360p");
    assert.equal(geminiSettings("1080p").resolution, "1080p");
    assert.equal(higgsfieldSettings().name, "Seedance 2.5");
  });
  // server keys (credits): prefs are ignored
  withKeys(userKeyContext({}, prefs), () => assert.notEqual(env().GEMINI_TTS_VOICE, "Kore"));
});
