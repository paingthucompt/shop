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
    withKeys(userKeyContext({ gemini: "user-g", seedance: "user-s" }), () => assert.equal(env().SEEDANCE_API_KEY, "user-s"));
    // own OpenAI key → scripts by OpenAI, whatever the server's LLM settings say
    process.env.LLM_MODEL_MY = "gemini-3.6-flash";
    withKeys(userKeyContext({ gemini: "user-g", openai: "user-o" }), () => {
      const c = llmConfig(undefined, "my");
      assert.deepEqual([c.key, c.baseUrl, c.model, c.fallbacks], ["user-o", "https://api.openai.com/v1", "gpt-4.1-mini", []]);
      assert.equal(env().GEMINI_API_KEY, "user-g"); // voices / pictures stay on Gemini
    });
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
