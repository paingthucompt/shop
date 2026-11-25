import { useEffect, useState } from "react";
import { api, creditsChanged } from "../api.js";
import { t } from "../i18n.js";

const PROVIDERS = [
  { id: "gemini", link: "https://aistudio.google.com/apikey", placeholder: "AIza…" },
  { id: "seedance", link: "https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey", placeholder: "…" },
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
      <h2 className="card-title">{t(`keys.${p.id}.title`)}</h2>
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

export default function Settings() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = () => api("/keys").then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const changed = () => { load(); creditsChanged(); }; // the header switches between credits and "own key"

  const byId = Object.fromEntries((data?.keys || []).map((k) => [k.provider, k]));
  return (
    <div className="narrow">
      <div className="page-head"><div><h1>{t("keys.title")}</h1><p className="muted">{t("keys.subtitle")}</p></div></div>
      {error && <p className="alert bad">{error}</p>}
      {data && (
        <>
          <p className={`alert ${data.using_own_keys ? "ok" : "warn"}`}>
            {data.using_own_keys ? t("keys.usingOwn") : data.own_keys_only ? t("keys.required") : t("keys.usingCredits")}
          </p>
          {PROVIDERS.map((p) => (
            <KeyCard key={p.id} p={p} saved={byId[p.id]} locked={p.id !== "gemini" && !byId.gemini} onChanged={changed} />
          ))}
          <section className="card">
            <h2 className="card-title">{t("keys.safeTitle")}</h2>
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
