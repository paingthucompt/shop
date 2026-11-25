// Cost tracking: providers report each billable call here; the API / worker decide where it is stored.
// Who the call is for (user / product / job) comes from the surrounding withUsage() context, so a
// provider function doesn't need extra parameters — e.g. the worker wraps a whole job:
//   withUsage({ userId, productId, jobId }, () => processJob(id))
import { AsyncLocalStorage } from "node:async_hooks";
import { priceUsage } from "./pricing.js";

const als = new AsyncLocalStorage();
let sink = null;

/** where usage rows go (e.g. an INSERT into api_usage); null → only priced, not stored */
export function setUsageSink(fn) { sink = fn; }

/** run fn with this user / product / job attached to every usage reported inside it (nests) */
export const withUsage = (ctx, fn) => als.run({ ...als.getStore(), ...ctx }, fn);

export const usageContext = () => als.getStore() || {};

/**
 * Record one billable call: { kind, provider, model, input_tokens?, output_tokens?, seconds?,
 * resolution?, images?, size? }. Never throws and never delays the caller: a failed insert only warns.
 * Returns the priced row.
 */
export function reportUsage(entry) {
  const row = { ...usageContext(), ...entry, ...priceUsage(entry) };
  if (sink) {
    Promise.resolve()
      .then(() => sink(row))
      .catch((err) => console.warn(`[usage] not recorded (${row.kind} ${row.model}): ${err.message}`));
  }
  return row;
}

/** Gemini usage blocks → token counts (Interactions API `usage` and generateContent `usageMetadata`) */
export function geminiTokens(u) {
  if (!u) return {};
  const input = u.total_input_tokens ?? u.promptTokenCount;
  const output = (u.total_output_tokens ?? u.candidatesTokenCount ?? 0) + (u.total_thought_tokens ?? u.thoughtsTokenCount ?? 0);
  return { input_tokens: input ?? null, output_tokens: input == null && !output ? null : output };
}
