import test from "node:test";
import assert from "node:assert/strict";
import { sealKey, openKey, keyHint } from "@app/db";

test("API keys are sealed with AES-GCM and can't be read with another secret or after tampering", () => {
  const saved = process.env.KEYS_SECRET;
  process.env.KEYS_SECRET = "a".repeat(40);
  try {
    const sealed = sealKey("AIzaSyEXAMPLEexample1234");
    assert.ok(!sealed.includes("AIza"));
    assert.notEqual(sealKey("AIzaSyEXAMPLEexample1234"), sealed); // random IV
    assert.equal(openKey(sealed), "AIzaSyEXAMPLEexample1234");
    const parts = sealed.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    assert.throws(() => openKey(parts.join(":")));
    process.env.KEYS_SECRET = "b".repeat(40);
    assert.throws(() => openKey(sealed));
    assert.equal(keyHint("AIzaSyEXAMPLEexample1234"), "AIza…1234");
  } finally {
    if (saved === undefined) delete process.env.KEYS_SECRET; else process.env.KEYS_SECRET = saved;
  }
});
