import { useEffect, useState } from "react";
import { api, creditsChanged } from "../api.js";
import { t } from "../i18n.js";
import Icon from "../icons.jsx";

const PROVIDERS = [
  { id: "gemini", link: "https://aistudio.google.com/apikey", placeholder: "AIza…" },
  { id: "higgsfield", link: "https://open.higgsfield.ai", placeholder: "KEY_ID:KEY_SECRET" },
  { id: "openai", link: "https://platform.openai.com/api-keys", placeholder: "sk-…" },
];

/** one provider: shows the saved hint (never the key), or a box to paste a new key */
function KeyCard({ p, saved, locked, onChanged }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [editing, setEditing] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await api(`/keys/${p.id}`, { method: "PUT", body: { key } });
      setKey(""); setEditing(false);
      setMsg({ ok: true, text: r.note || t("keys.saved") });
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm(t(p.id === "gemini" ? "keys.removeGeminiConfirm" : "keys.removeConfirm"))) return;
    setBusy(true); setMsg(null);
    try { await api(`/keys/${p.id}`, { method: "DELETE" }); onChanged(); } catch (err) { setMsg({ ok: false, text: err.message }); } finally { setBusy(false); }
  }

  return (
    <section className="card">
      <h2 className="card-title"><span className="num"><Icon name="key" size={16} /></span>{t(`keys.${p.id}.title`)}</h2>
      <p className="muted small">{t(`keys.${p.id}.what`)}</p>
      {saved && !editing ? (
        <div className="key-saved">
          <code>{saved.hint}</code>
          <span className={saved.verified_at ? "pill ok" : "pill"}>{saved.verified_at ? t("keys.verified") : t("keys.unverified")}</span>
          <span className="key-actions">
            <button type="button" className="btn subtle sm" onClick={() => setEditing(true)} disabled={busy}>{t("keys.replace")}</button>
            <button type="button" className="btn subtle sm" onClick={remove} disabled={busy}>{t("keys.remove")}</button>
          </span>
        </div>
      ) : locked ? (
        <p className="hint">{t("keys.geminiFirst")}</p>
      ) : (
        <form onSubmit={save} className="field">
          <span className="hint">
            {t(`keys.${p.id}.how`)} <a href={p.link} target="_blank" rel="noreferrer">{t("keys.getKey")} ↗</a>
          </span>
          <div className="input-row">
            <input type="password" autoComplete="off" spellCheck={false} placeholder={p.placeholder} value={key} onChange={(e) => setKey(e.target.value)} />
            <button className="btn primary" disabled={busy || key.trim().length < 20}>{busy ? t("keys.checking") : t("keys.save")}</button>
            {saved && <button type="button" className="btn subtle" onClick={() => { setEditing(false); setKey(""); }}>{t("keys.cancel")}</button>}
          </div>
        </form>
      )}
      {msg && <p className={`alert ${msg.ok ? "ok" : "bad"}`}>{msg.text}</p>}
    </section>
  );
}

const usd = (n) => `≈ $${Number(n).toFixed(2)}`;

/** the user's AI choices: who writes the scripts, the voices, which AI video service + model (own keys only) */
function AiChoices({ prefs, catalog, has, onSaved }) {
  const def = {
    script: "auto", voice: "Leda", voice_b: "Puck",
    video_provider: "gemini", gemini_video: "720p", higgsfield_model: catalog.higgsfield_models[0]?.id,
  };
  const [v, setV] = useState({ ...def, ...prefs });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k, x) => { setV({ ...v, [k]: x }); setMsg(null); };
  const dirty = JSON.stringify({ ...def, ...prefs }) !== JSON.stringify(v);
  const videoProvider = v.video_provider === "higgsfield" && !has.higgsfield ? "gemini" : v.video_provider;

  async function save() {
    setBusy(true); setMsg(null);
    try { await api("/keys/prefs", { method: "PUT", body: v }); setMsg({ ok: true, text: t("ai.saved") }); onSaved(); } catch (e) { setMsg({ ok: false, text: e.message }); }
    setBusy(false);
  }

  return (
    <section className="card ai-choices">
      <h2 className="card-title"><span className="num"><Icon name="sparkles" size={16} /></span>{t("ai.title")}</h2>
      <p className="muted small">{t("ai.intro")}</p>

      <div className="ai-row">
        <span className="ai-label"><Icon name="script" size={17} />{t("ai.script")}</span>
        <select value={v.script} onChange={(e) => set("script", e.target.value)}>
          {catalog.script.map((c) => (
            <option key={c.id} value={c.id} disabled={c.provider === "openai" && !has.openai}>
              {c.name}{c.provider === "openai" && !has.openai ? ` — ${t("ai.needKey")}` : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="ai-row two-sel">
        <span className="ai-label"><Icon name="mic" size={17} />{t("ai.voice")}</span>
        <label className="mini">{t("ai.voiceA")}
          <select value={v.voice} onChange={(e) => set("voice", e.target.value)}>
            {catalog.voices.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.desc}</option>)}
          </select>
        </label>
        <label className="mini">{t("ai.voiceB")}
          <select value={v.voice_b} onChange={(e) => set("voice_b", e.target.value)}>
            {catalog.voices.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.desc}</option>)}
          </select>
        </label>
      </div>

      <div className="ai-row">
        <span className="ai-label"><Icon name="film" size={17} />{t("ai.video")}</span>
        <div className="seg" role="radiogroup" aria-label={t("ai.video")}>
          {[["gemini", "Gemini Omni"], ["higgsfield", "Higgsfield"]].map(([k, name]) => (
            <button key={k} type="button" role="radio" aria-checked={videoProvider === k} disabled={k === "higgsfield" && !has.higgsfield}
              className={videoProvider === k ? "on" : ""} onClick={() => set("video_provider", k)}>{name}</button>
          ))}
        </div>
      </div>
      <div className="ai-models" role="radiogroup" aria-label={t("ai.model")}>
        {(videoProvider === "higgsfield" ? catalog.higgsfield_models : catalog.gemini_video).map((m) => {
          const key = videoProvider === "higgsfield" ? "higgsfield_model" : "gemini_video";
          const on = v[key] === m.id;
          return (
            <button key={m.id} type="button" role="radio" aria-checked={on} className={`model-card${on ? " on" : ""}`} onClick={() => set(key, m.id)}>
              <strong>{m.name}</strong>
              <span className="muted small">{m.seconds} s · {usd(m.usd)} / {t("ai.perClip")}</span>
              {on && <span className="format-check"><Icon name="check" size={14} /></span>}
            </button>
          );
        })}
      </div>
      {videoProvider === "higgsfield" && <p className="hint">{t("ai.higgsfieldNote")}</p>}

      <div className="row">
        <button type="button" className="btn primary" disabled={busy || !dirty} onClick={save}>{busy ? t("keys.checking") : t("ai.save")}</button>
        {msg && <span className={msg.ok ? "ok-text small" : "bad-text small"}>{msg.text}</span>}
      </div>
    </section>
  );
}

export default function Settings() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = () => api("/keys").then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const changed = () => { load(); creditsChanged(); };
  // the old BytePlus key (Higgsfield replaced it) can only be removed
  const removeLegacy = () => api("/keys/seedance", { method: "DELETE" }).then(changed).catch((e) => setError(e.message));

  const byId = Object.fromEntries((data?.keys || []).map((k) => [k.provider, k]));
  return (
    <div className="narrow">
      <div className="page-head"><div><p className="eyebrow"><Icon name="settings" size={14} />{t("nav.settings")}</p><h1>{t("keys.title")}</h1><p className="muted">{t("keys.subtitle")}</p></div></div>
      {error && <p className="alert bad">{error}</p>}
      {data && (
        <>
          <p className={`alert ${data.using_own_keys ? "ok" : "warn"}`}>
            {data.using_own_keys ? t("keys.usingOwn") : data.own_keys_only ? t("keys.required") : t("keys.usingCredits")}
          </p>
          {PROVIDERS.map((p) => (
            <KeyCard key={p.id} p={p} saved={byId[p.id]} locked={p.id !== "gemini" && !byId.gemini} onChanged={changed} />
          ))}
          {data.using_own_keys && (
            <AiChoices key={JSON.stringify(data.prefs)} prefs={data.prefs || {}} catalog={data.catalog}
              has={{ openai: !!byId.openai, higgsfield: !!byId.higgsfield }} onSaved={load} />
          )}
          {byId.seedance && (
            <p className="alert info row between">
              <span>{t("keys.legacySeedance")}</span>
              <button type="button" className="btn subtle sm" onClick={removeLegacy}>
                <Icon name="trash" size={15} />{t("keys.remove")}
              </button>
            </p>
          )}
          <section className="card">
            <h2 className="card-title"><span className="num"><Icon name="shield" size={16} /></span>{t("keys.safeTitle")}</h2>
            <ul className="muted small">
              <li>{t("keys.safe1")}</li>
              <li>{t("keys.safe2")}</li>
              <li>{t("keys.safe3")}</li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
