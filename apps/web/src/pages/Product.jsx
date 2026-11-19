import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, LANGS } from "../api.js";
import { MAX_PHOTOS } from "../PhotoPicker.jsx";

function ScriptEditor({ productId, lang, script, onSaved }) {
  const [s, setS] = useState(script);
  const [msg, setMsg] = useState("");
  useEffect(() => setS(script), [script]);
  if (!s) return <p className="muted">No {LANGS[lang]} script yet — click “AI write scripts”.</p>;

  // the server drops empty lines together with their caption, so send both arrays as they are
  async function save() {
    setMsg("");
    try {
      const r = await api(`/products/${productId}/scripts/${lang}`, { method: "PUT", body: { ...s, captions: caps } });
      onSaved(lang, r);
      setMsg("Saved ✓");
    } catch (e) { setMsg(e.message); }
  }
  const caps = s.lines.map((_, i) => s.captions?.[i] ?? "");
  const setLine = (i, v) => setS({ ...s, lines: s.lines.map((l, j) => (j === i ? v : l)) });
  const setCaption = (i, v) => setS({ ...s, captions: caps.map((c, j) => (j === i ? v : c)) });

  return (
    <div className={`script lang-${lang}`}>
      <label>Hook (spoken first + top text)<input value={s.hook} maxLength={80} onChange={(e) => setS({ ...s, hook: e.target.value })} /></label>
      {s.lines.map((l, i) => (
        <div key={i} className="line-pair">
          <label>Line {i + 1} — spoken<input value={l} maxLength={160} onChange={(e) => setLine(i, e.target.value)} /></label>
          <label className="caption">On-screen text <span className="muted">(short key phrase · empty = show the spoken line)</span>
            <input value={caps[i]} maxLength={60} placeholder={l} onChange={(e) => setCaption(i, e.target.value)} />
          </label>
        </div>
      ))}
      {s.lines.length < 6 && <button className="ghost small" onClick={() => setS({ ...s, lines: [...s.lines, ""], captions: [...caps, ""] })}>+ line</button>}
      <label>Call to action<input value={s.cta} maxLength={80} onChange={(e) => setS({ ...s, cta: e.target.value })} /></label>
      <div className="row"><button onClick={save}>Save {LANGS[lang]}</button><span className="muted">{msg}</span></div>
    </div>
  );
}

const STYLES = {
  product: "Product demo (hands, close-ups, real use)",
  presenter: "With a presenter (AI person holds & shows the product, voiceover in each language)",
};

/** Pre-spend gate: shows exactly what will be charged and generated; nothing is spent until "Confirm". */
function QuotePanel({ quote, busy, onConfirm, onCancel }) {
  const c = quote.clip;
  return (
    <div className="card quote">
      <h3>Confirm before spending</h3>
      <table className="kv">
        <tbody>
          <tr><th>Videos</th><td>{quote.langs.map((l) => LANGS[l]).join(" + ")} (one separate video each)</td></tr>
          <tr><th>Cost</th><td><strong>{quote.cost} credits</strong> — you have {quote.balance}, {quote.enough_credits ? `${quote.balance_after} left after` : "not enough credits"}</td></tr>
          <tr><th>Product clip</th><td>{c.mode === "seedance"
            ? `AI video (Seedance ${c.model || ""}) · ${c.duration_s}s · ${c.resolution} · ${c.reference_images} reference photo(s)`
            : c.mode === "photos"
              ? `Your ${c.reference_images} photo(s) with zoom/pan motion · ${c.duration_s}s · free (no AI video)`
              : "Sample clip (CLIP_MODE=sample — for testing only)"}</td></tr>
          <tr><th>Style</th><td>{STYLES[c.style]}{!c.style_applies && c.style === "presenter"
            ? <span className="error"> — needs a Seedance key; this video uses your photos without a presenter</span> : null}</td></tr>
          <tr><th>Voiceover</th><td>{{
            none: "None (product sound + text only)",
            edge: "Free AI voice (Edge) — Thai: Premwadee · Myanmar: Nilar",
            azure: "AI voice (Azure Speech) — Thai: Premwadee · Myanmar: Nilar",
          }[quote.voiceover] || quote.voiceover}</td></tr>
        </tbody>
      </table>
      {c.mode === "seedance" && <details><summary>Prompt sent to the video AI</summary><pre className="prompt">{c.prompt}</pre></details>}
      {Object.entries(quote.script_issues || {}).map(([lang, issue]) => (
        <p key={lang} className="error">⚠ {LANGS[lang]}: {issue}. Fix the script below, save it, then try again.</p>
      ))}
      <p className="muted">Credits are refunded automatically if the video fails.</p>
      <div className="row">
        <button onClick={onConfirm} disabled={busy || !quote.enough_credits || quote.missing_scripts.length > 0 || Object.keys(quote.script_issues || {}).length > 0}>
          {busy ? "Starting…" : `Confirm — spend ${quote.cost} credits`}
        </button>
        <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

export default function Product() {
  const { id } = useParams();
  const nav = useNavigate();
  const [p, setP] = useState(null);
  const [langs, setLangs] = useState({ th: true, my: true });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [quote, setQuote] = useState(null);
  const [style, setStyle] = useState("product");

  useEffect(() => { api(`/products/${id}`).then(setP).catch((e) => setError(e.message)); }, [id]);
  const selected = Object.keys(langs).filter((l) => langs[l]);
  // a quote is only valid for the language selection and style it was made for
  useEffect(() => setQuote(null), [langs, style]);

  async function generate() {
    setBusy("scripts"); setError("");
    try {
      const r = await api(`/products/${id}/scripts/generate`, { method: "POST", body: { langs: selected } });
      setP((cur) => ({ ...cur, scripts: { ...cur.scripts, ...r } }));
    } catch (e) { setError(e.message); }
    setBusy("");
  }
  async function getQuote() {
    setBusy("quote"); setError("");
    try {
      setQuote(await api(`/jobs/quote?product_id=${id}&langs=${selected.join(",")}&style=${style}`));
    } catch (e) { setError(e.message); }
    setBusy("");
  }
  async function confirmVideo() {
    setBusy("video"); setError("");
    try {
      const job = await api("/jobs", { method: "POST", body: { product_id: Number(id), langs: quote.langs, style: quote.clip.style, confirm_cost: quote.cost } });
      nav(`/jobs/${job.id}`);
    } catch (e) { setError(e.message); setQuote(null); setBusy(""); }
  }
  // photo changes keep the scripts already loaded; a quote made before the change is no longer valid
  const keepScripts = (next) => setP((cur) => ({ ...next, scripts: cur.scripts }));
  async function addPhotos(e) {
    const picked = [...e.target.files].slice(0, MAX_PHOTOS - p.images.length);
    e.target.value = "";
    if (!picked.length) return;
    setBusy("photos"); setError(""); setQuote(null);
    try {
      const form = new FormData();
      for (const f of picked) form.append("images", f);
      keepScripts(await api(`/products/${id}/images`, { method: "POST", form }));
    } catch (err) { setError(err.message); }
    setBusy("");
  }
  async function removePhoto(index) {
    setBusy("photos"); setError(""); setQuote(null);
    try {
      keepScripts(await api(`/products/${id}/images/${index}`, { method: "DELETE" }));
    } catch (err) { setError(err.message); }
    setBusy("");
  }

  async function remove() {
    if (!confirm(`Delete "${p.title}" and all its videos? This cannot be undone.`)) return;
    setBusy("delete"); setError("");
    try {
      await api(`/products/${id}`, { method: "DELETE" });
      nav("/");
    } catch (e) { setError(e.message); setBusy(""); }
  }

  if (!p) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;
  return (
    <>
      <div className="row between">
        <h2>{p.title}</h2>
        <button className="ghost danger" onClick={remove} disabled={!!busy}>{busy === "delete" ? "Deleting…" : "Delete product"}</button>
      </div>
      <div className="photo-picker">
        {p.images.map((img, n) => (
          <div key={img.url} className="photo">
            <img src={img.url} alt="" />
            {p.images.length > 1 && (
              <button type="button" className="remove" title="Remove photo" disabled={!!busy} onClick={() => removePhoto(n)}>✕</button>
            )}
          </div>
        ))}
        {p.images.length < MAX_PHOTOS && (
          <label className="photo add">
            <span>{busy === "photos" ? "…" : "＋"}</span>
            <small>Add photo ({p.images.length}/{MAX_PHOTOS})</small>
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden disabled={!!busy} onChange={addPhotos} />
          </label>
        )}
      </div>
      {p.affiliate_url && <p>Affiliate link: <a href={p.affiliate_url} target="_blank" rel="noreferrer">{p.affiliate_url}</a></p>}

      <div className="card">
        <div className="row">
          <strong>Languages (one separate video each):</strong>
          {Object.entries(LANGS).map(([k, label]) => (
            <label key={k} className="check"><input type="checkbox" checked={langs[k]} onChange={(e) => setLangs({ ...langs, [k]: e.target.checked })} /> {label}</label>
          ))}
        </div>
        <div className="row">
          <strong>AI video style:</strong>
          {Object.entries(STYLES).map(([k, label]) => (
            <label key={k} className="check"><input type="radio" name="style" checked={style === k} onChange={() => setStyle(k)} /> {label.split(" (")[0]}</label>
          ))}
        </div>
        <div className="row">
          <button className="ghost" onClick={generate} disabled={!!busy || !selected.length}>{busy === "scripts" ? "Writing…" : "✨ AI write scripts"}</button>
          <button onClick={getQuote} disabled={!!busy || !!quote || !selected.length || selected.some((l) => !p.scripts?.[l])}>
            {busy === "quote" ? "Checking…" : "🎬 Create videos"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      {quote && <QuotePanel quote={quote} busy={busy === "video"} onConfirm={confirmVideo} onCancel={() => setQuote(null)} />}

      <div className="two">
        {selected.map((lang) => (
          <div key={lang} className="card">
            <h3>{LANGS[lang]}</h3>
            <ScriptEditor productId={id} lang={lang} script={p.scripts?.[lang]} onSaved={(l, s) => setP((cur) => ({ ...cur, scripts: { ...cur.scripts, [l]: s } }))} />
          </div>
        ))}
      </div>
    </>
  );
}
