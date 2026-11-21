import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api, LANGS } from "../api.js";
import { MAX_PHOTOS } from "../PhotoPicker.jsx";
import { ANGLES, STYLES } from "../options.js";
import { PHOTO_TYPES, pickPhotos, useFileDrop } from "../useFileDrop.js";

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


function CopyButton({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { setCopied(false); }
  }
  return <button type="button" className="ghost small" onClick={copy}>{copied ? "Copied ✓" : label}</button>;
}

const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

const ROLE_LABEL = { hook: "Hook", intro: "Product", feature: "Highlight", use: "In use", value: "Value", cta: "Call to action" };

/** on-screen text of scene i for the preview: the script beat it shows (caption wins over the spoken line) */
function sceneText(script, i, count) {
  if (!script) return "";
  if (i === 0) return script.hook;
  if (i === count - 1) return script.cta;
  return script.captions?.[i - 1]?.trim() || script.lines?.[i - 1] || "";
}

/** AI scene images made in the app: a storyboard you can check and redo scene by scene, then animate. */
function ScenesCard({ scenes, scripts, busy, onMake, onRedo, notice }) {
  const langs = ["th", "my"].filter((l) => scripts?.[l]);
  const [tab, setTab] = useState(langs[0]);
  const lang = langs.includes(tab) ? tab : langs[0];
  const has = Array.isArray(scenes) && scenes.length > 0;
  const beats = (() => { const sc = scripts?.my || scripts?.th; return sc ? Math.min(6, 2 + (sc.lines?.length || 0)) : 0; })();
  return (
    <div className="card flow">
      <div className="row between">
        <h3>🖼 AI scene images <span className="muted">· made here, ~1 credit per image</span></h3>
        <div className="row">
          {has && langs.length > 1 && langs.map((l) => (
            <button key={l} type="button" className={`small${l === lang ? "" : " ghost"}`} onClick={() => setTab(l)}>{LANGS[l]}</button>
          ))}
          <button type="button" className={`small${has ? " ghost" : ""}`} disabled={!!busy || !beats} onClick={onMake}>
            {busy === "scenes" ? "Making images…" : has ? `Make all again (${scenes.length} credits)` : `Make ${beats} scene images (${beats} credits)`}
          </button>
        </div>
      </div>
      {!has && <p className="muted small-text">One photorealistic 9:16 image per part of the script, made from your product photos. Check them here, redo any you don't like, then choose “AI scene images” and Create videos — the app adds the voiceover and the {LANGS.th} / {LANGS.my} captions.</p>}
      {has && (
        <div className="scenes">
          {scenes.map((sc, i) => (
            <div key={sc.n} className="scene-card">
              <div className="scene-label">{sc.n}. {ROLE_LABEL[sc.role] || sc.role} <span>({sc.from}–{sc.to}s)</span></div>
              <div className="scene-frame">
                {sc.url ? <img src={sc.url} alt="" /> : <div className="scene-missing">image failed</div>}
                <div className={`scene-text lang-${lang}`}>{sceneText(scripts?.[lang], i, scenes.length)}</div>
              </div>
              <button type="button" className="ghost small" disabled={!!busy} onClick={() => onRedo(sc.n)}>
                {busy === `scene-${sc.n}` ? "Making…" : "↻ Redo (1)"}
              </button>
            </div>
          ))}
        </div>
      )}
      {notice && <p className="error small-text">{notice}</p>}
    </div>
  );
}

/**
 * Google Flow, step by step, per language: ① storyboard image prompt → ② video prompt that animates that
 * storyboard (silent clip) → ③ upload the clip below. Flow runs on the user's own plan: no API cost here.
 */
function FlowCard({ prompts, style }) {
  const langs = ["th", "my"].filter((l) => prompts?.[l]);
  const [tab, setTab] = useState(langs[0]);
  if (!langs.length) return null;
  const lang = langs.includes(tab) ? tab : langs[0];
  const fp = prompts[lang];
  return (
    <div className="card flow">
      <div className="row between">
        <h3>🎬 Make the clip in Google Flow <span className="muted">· {STYLES[style]?.split(" (")[0] || style}</span></h3>
        <div className="row">
          {langs.length > 1 && langs.map((l) => (
            <button key={l} type="button" className={`small${l === lang ? "" : " ghost"}`} onClick={() => setTab(l)}>{LANGS[l]}</button>
          ))}
          <a className="button ghost small" href="https://flow.google.com/" target="_blank" rel="noreferrer">Open Flow ↗</a>
        </div>
      </div>

      <div className="flow-step">
        <div className="row between">
          <strong>① Storyboard image</strong>
          <CopyButton text={fp.storyboard} label="Copy storyboard prompt" />
        </div>
        <p className="muted small-text">Flow → <strong>Image · 16:9</strong> · add the product photos · paste · generate. Regenerate until the panels look right.
          {lang === "my" ? " (AI images sometimes misspell Myanmar letters — that's fine, the final captions come from the app.)" : ""}</p>
        <details><summary>Show prompt</summary><pre className="prompt">{fp.storyboard}</pre></details>
      </div>

      <div className="flow-step">
        <div className="row between">
          <strong>② Video from the storyboard</strong>
          <CopyButton text={fp.video} label="Copy video prompt" />
        </div>
        <p className="muted small-text">Flow → <strong>Video · Ingredients · 9:16 · Omni 1.2 Flash · 720p · Length {fp.seconds} s</strong> · add the <strong>storyboard image from ①</strong> + the product photos · paste · generate · download.</p>
        <details><summary>Show prompt</summary><pre className="prompt">{fp.video}</pre></details>
      </div>

      <p className="muted small-text"><strong>③</strong> Drop the downloaded clip below → Create videos: the app adds the {LANGS.th} / {LANGS.my} voiceover, captions, hook and CTA.</p>
    </div>
  );
}

/** Step 2 — upload the clip (button or drag & drop) and preview it. */
function ClipUpload({ clip, busy, onUpload, onRemove, notice }) {
  const { dragging, dropProps } = useFileDrop((files) => onUpload(files), { enabled: !busy, paste: false });
  return (
    <div className={`card clip-drop${dragging ? " dragging" : ""}`} {...dropProps}>
      <div className="row between">
        <h3>③ Your clip from Flow {clip ? <span className="muted">· {clip.seconds.toFixed(1)} s</span> : null}</h3>
        {clip && <button className="ghost small danger" disabled={busy} onClick={onRemove}>Remove</button>}
      </div>
      {clip && <video className="clip-preview" src={clip.url} controls muted playsInline preload="metadata" />}
      <label className="button ghost small">
        {busy ? "Uploading…" : clip ? "Replace clip" : "Choose video"}
        <input type="file" accept={VIDEO_TYPES.join(",")} hidden disabled={busy}
          onChange={(e) => { onUpload([...e.target.files]); e.target.value = ""; }} />
      </label>
      <p className="drop-hint">{dragging ? "Drop the video here" : "or drag & drop the MP4 from Flow here (2–60 s, any size is cropped to 9:16)"}</p>
      {notice && <p className="error small-text">{notice}</p>}
    </div>
  );
}

/** Pre-spend gate: shows exactly what will be charged and generated; nothing is spent until "Confirm". */
// the last speed chosen per language is remembered in this browser (a convenience only)
const SPEED_KEY = "voiceSpeed";
const loadSpeeds = () => { try { return JSON.parse(localStorage.getItem(SPEED_KEY) || "{}") || {}; } catch { return {}; } };
const saveSpeeds = (v) => { try { localStorage.setItem(SPEED_KEY, JSON.stringify(v)); } catch { /* private window */ } };

function QuotePanel({ quote, busy, speeds, onSpeed, onConfirm, onCancel }) {
  const c = quote.clip;
  const range = quote.voice_speed_range || { min: 0.8, max: 1.5 };
  return (
    <div className="card quote">
      <h3>Confirm before spending</h3>
      <table className="kv">
        <tbody>
          <tr><th>Videos</th><td>{quote.langs.map((l) => LANGS[l]).join(" + ")} (one separate video each)</td></tr>
          <tr><th>Cost</th><td><strong>{quote.cost} credits</strong> — you have {quote.balance}, {quote.enough_credits ? `${quote.balance_after} left after` : "not enough credits"}</td></tr>
          <tr><th>Product clip</th><td>{c.mode === "scenes"
            ? `Your ${c.scene_count} AI scene images with zoom / pan · ${c.duration_s.toFixed(0)}s · images already paid`
            : c.mode === "upload"
            ? `Your uploaded clip · ${c.duration_s.toFixed(1)}s · cropped to 9:16 720p · no AI video cost`
            : c.mode === "seedance" || c.mode === "gemini"
            ? `AI video (${c.mode === "gemini" ? "Gemini" : "Seedance"} ${c.model || ""}) · ${c.duration_s}s · ${c.resolution} · ${c.reference_images} reference photo(s)`
            : c.mode === "photos"
              ? `Your ${c.reference_images} photo(s) with zoom/pan motion · ${c.duration_s}s · free (no AI video)`
              : "Sample clip (CLIP_MODE=sample — for testing only)"}</td></tr>
          {!["upload", "scenes", "photos"].includes(c.mode) && <tr><th>Style</th><td>{STYLES[c.style]}{!c.style_applies && c.style !== "product"
            ? <span className="error"> — needs an AI video key (Seedance or Gemini); this video uses your photos with zoom/pan instead</span> : null}</td></tr>}
          <tr><th>Voiceover</th><td>{{
            none: "None (product sound + text only)",
            edge: "Free AI voice (Edge) — Thai: Premwadee · Myanmar: Nilar",
            azure: "AI voice (Azure Speech) — Thai: Premwadee · Myanmar: Nilar",
            gemini: "Natural AI voice (Gemini) — creator-style delivery",
            voxcpm: "Local VoxCPM2 voice (your computer) — free, can be your own cloned voice",
          }[quote.voiceover] || quote.voiceover}</td></tr>
          {quote.voiceover !== "none" && <tr><th>Voice speed</th><td>{quote.langs.map((l) => (
            <label key={l} className="speed">
              <span>{LANGS[l]}</span>
              <input type="range" min={range.min} max={range.max} step="0.05" value={speeds[l] ?? 1}
                onChange={(e) => onSpeed(l, Number(e.target.value))} disabled={busy} />
              <strong>×{(speeds[l] ?? 1).toFixed(2)}</strong>
            </label>
          ))}<span className="muted small-text">1.00 = natural pace · higher = faster (the pitch stays the same)</span></td></tr>}
        </tbody>
      </table>
      {c.style_applies && <details><summary>Prompt sent to the video AI</summary><pre className="prompt">{c.prompt}</pre></details>}
      {Object.entries(quote.script_issues || {}).map(([lang, issue]) => (
        <p key={lang} className="error">⚠ {LANGS[lang]}: {issue}. Fix the script below, save it, then try again.</p>
      ))}
      {quote.clip_source === "ai_video" && (
        <p className="error">⚠ AI video uses the paid Google / BytePlus API — about ฿130 per clip on your bill, on top of the credits.</p>
      )}
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
  const [angle, setAngle] = useState("auto");
  const [clipSource, setClipSource] = useState(null); // null = follow whether a clip is uploaded
  const [clipNotice, setClipNotice] = useState("");
  const [speeds, setSpeeds] = useState({});
  const setSpeed = (l, v) => setSpeeds((cur) => { const next = { ...cur, [l]: v }; saveSpeeds({ ...loadSpeeds(), ...next }); return next; });

  useEffect(() => { api(`/products/${id}`).then(setP).catch((e) => setError(e.message)); }, [id]);
  const selected = Object.keys(langs).filter((l) => langs[l]);
  // a quote is only valid for the language selection and style it was made for
  useEffect(() => setQuote(null), [langs, style, clipSource]);
  const scenesReady = Array.isArray(p?.scenes) && p.scenes.length > 0 && p.scenes.every((x) => x.url);
  const source = clipSource || (p?.clip ? "upload" : scenesReady && p?.features?.scene_images ? "scenes" : "photos");
  const [sceneNotice, setSceneNotice] = useState("");

  async function generate(opts = { langs: selected, angle, style }) {
    setBusy("scripts"); setError("");
    try {
      const r = await api(`/products/${id}/scripts/generate`, { method: "POST", body: opts });
      setP((cur) => ({ ...cur, scripts: { ...cur.scripts, ...r.scripts }, clip_prompt: r.clip_prompt ?? cur.clip_prompt, flow_prompts: r.flow_prompts ?? cur.flow_prompts }));
    } catch (e) { setError(e.message); }
    setBusy("");
  }

  // coming from "Add product": write the scripts + Flow prompts right away with the choices made there
  const location = useLocation();
  const auto = location.state?.autoGenerate;
  useEffect(() => {
    if (!auto || !p) return;
    nav(location.pathname, { replace: true, state: null }); // run once, also after a reload
    const l = auto.langs?.length ? auto.langs : ["th", "my"];
    setLangs({ th: l.includes("th"), my: l.includes("my") });
    setAngle(auto.angle || "auto");
    setStyle(auto.style || "product");
    generate({ langs: l, angle: auto.angle || "auto", style: auto.style || "product" });
  }, [auto, p]); // eslint-disable-line react-hooks/exhaustive-deps
  async function getQuote() {
    setBusy("quote"); setError("");
    try {
      const q = await api(`/jobs/quote?product_id=${id}&langs=${selected.join(",")}&style=${style}&clip_source=${source}`);
      const saved = loadSpeeds();
      setSpeeds(Object.fromEntries(q.langs.map((l) => [l, saved[l] ?? q.voice_speed_default?.[l] ?? 1])));
      setQuote(q);
    } catch (e) { setError(e.message); }
    setBusy("");
  }
  async function confirmVideo() {
    setBusy("video"); setError("");
    try {
      const job = await api("/jobs", { method: "POST", body: { product_id: Number(id), langs: quote.langs, style: quote.clip.style, clip_source: quote.clip_source, voice_speed: quote.voiceover !== "none" ? speeds : undefined, confirm_cost: quote.cost } });
      nav(`/jobs/${job.id}`);
    } catch (e) { setError(e.message); setQuote(null); setBusy(""); }
  }
  // photo changes keep the scripts already loaded; a quote made before the change is no longer valid
  const keepScripts = (next) => setP((cur) => ({ ...next, scripts: cur.scripts, flow_prompts: cur.flow_prompts, features: cur.features }));
  const [photoNotice, setPhotoNotice] = useState("");
  // from the file picker, drag & drop or paste (⌘V); uploads straight away
  async function addPhotos(list, opts) {
    const { photos: picked, notice } = pickPhotos(list, MAX_PHOTOS - (p?.images.length || 0), opts);
    setPhotoNotice(notice);
    if (!picked.length) return;
    setBusy("photos"); setError(""); setQuote(null);
    try {
      const form = new FormData();
      for (const f of picked) form.append("images", f);
      keepScripts(await api(`/products/${id}/images`, { method: "POST", form }));
    } catch (err) { setError(err.message); }
    setBusy("");
  }
  const { dragging, dropProps } = useFileDrop(addPhotos, { enabled: !!p && !busy });
  async function removePhoto(index) {
    setBusy("photos"); setError(""); setQuote(null);
    try {
      keepScripts(await api(`/products/${id}/images/${index}`, { method: "DELETE" }));
    } catch (err) { setError(err.message); }
    setBusy("");
  }

  async function uploadClip(files) {
    const f = files.find((x) => VIDEO_TYPES.includes(x.type));
    setClipNotice(files.length && !f ? "Only MP4, MOV or WebM videos" : "");
    if (!f) return;
    if (f.size > 200 * 1024 * 1024) return setClipNotice("The video is larger than 200 MB");
    setBusy("clip"); setError(""); setQuote(null);
    try {
      const form = new FormData();
      form.append("clip", f);
      keepScripts(await api(`/products/${id}/clip`, { method: "POST", form }));
      setClipSource(null);
    } catch (err) { setClipNotice(err.message); }
    setBusy("");
  }
  // scene images cost real money: credits are charged by the server (refunded for failed images)
  async function makeScenes() {
    const n = Array.isArray(p.scenes) && p.scenes.length ? p.scenes.length : null;
    if (n && !confirm(`Make all ${n} scene images again? This uses ${n} credits.`)) return;
    setBusy("scenes"); setSceneNotice(""); setQuote(null);
    try {
      const r = await api(`/products/${id}/scenes`, { method: "POST", body: {} });
      keepScripts(r);
      setClipSource(null);
      if (r.scenes_failed) setSceneNotice(`${r.scenes_failed} image(s) failed (credits refunded) — press Redo on them.`);
    } catch (err) { setSceneNotice(err.message); }
    setBusy("");
  }
  async function redoScene(n) {
    setBusy(`scene-${n}`); setSceneNotice(""); setQuote(null);
    try {
      keepScripts(await api(`/products/${id}/scenes/${n}`, { method: "POST", body: {} }));
    } catch (err) { setSceneNotice(err.message); }
    setBusy("");
  }

  async function removeClip() {
    setBusy("clip"); setError(""); setQuote(null);
    try {
      keepScripts(await api(`/products/${id}/clip`, { method: "DELETE" }));
      setClipSource(null);
    } catch (err) { setClipNotice(err.message); }
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
      <div className={`photo-drop${dragging ? " dragging" : ""}`} {...dropProps}>
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
            <input type="file" accept={PHOTO_TYPES.join(",")} multiple hidden disabled={!!busy}
              onChange={(e) => { addPhotos([...e.target.files]); e.target.value = ""; }} />
          </label>
        )}
      </div>
      {p.images.length < MAX_PHOTOS && (
        <p className="drop-hint">{dragging ? "Drop the photos here" : "or drag & drop photos here · paste a copied image with ⌘V / Ctrl+V"}</p>
      )}
      {photoNotice && <p className="error small-text">{photoNotice}</p>}
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
          <label className="check"><strong>Script angle:</strong>
            <select value={angle} onChange={(e) => setAngle(e.target.value)} disabled={!!busy}>
              {Object.entries(ANGLES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <label className="check"><strong>AI video style:</strong>
            <select value={style} onChange={(e) => setStyle(e.target.value)} disabled={!!busy}>
              {Object.entries(STYLES).map(([k, label]) => <option key={k} value={k}>{label.split(" (")[0]}</option>)}
            </select>
          </label>
        </div>
        <p className="muted">{STYLES[style]}</p>
        <div className="row">
          <strong>Clip:</strong>
          {p.clip && <label className="check"><input type="radio" name="src" checked={source === "upload"} onChange={() => setClipSource("upload")} /> My Flow clip</label>}
          {scenesReady && p.features?.scene_images && <label className="check"><input type="radio" name="src" checked={source === "scenes"} onChange={() => setClipSource("scenes")} /> AI scene images</label>}
          <label className="check"><input type="radio" name="src" checked={source === "photos"} onChange={() => setClipSource("photos")} /> Product photos (zoom/pan · no API cost)</label>
          {p.features?.ai_video && (
            <label className="check"><input type="radio" name="src" checked={source === "ai_video"} onChange={() => setClipSource("ai_video")} /> AI video ({p.features.ai_video === "gemini" ? "Gemini" : "Seedance"} · <span className="error">paid API ≈ ฿130</span>)</label>
          )}
        </div>
        <div className="row">
          <button className="ghost" onClick={() => generate()} disabled={!!busy || !selected.length}>{busy === "scripts" ? "Writing scripts + Flow prompts…" : "✨ AI write scripts + Flow prompts"}</button>
          <button onClick={getQuote} disabled={!!busy || !!quote || !selected.length || selected.some((l) => !p.scripts?.[l])}>
            {busy === "quote" ? "Checking…" : "🎬 Create videos"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <FlowCard prompts={p.flow_prompts} style={p.clip_prompt?.style} />
      {(p.clip_prompt || p.clip) && (
        <ClipUpload clip={p.clip} busy={busy === "clip"} onUpload={uploadClip} onRemove={removeClip} notice={clipNotice} />
      )}
      {p.features?.scene_images && p.clip_prompt && (
        <ScenesCard scenes={p.scenes} scripts={p.scripts} busy={busy} onMake={makeScenes} onRedo={redoScene} notice={sceneNotice} />
      )}

      {quote && <QuotePanel quote={quote} busy={busy === "video"} speeds={speeds} onSpeed={setSpeed} onConfirm={confirmVideo} onCancel={() => setQuote(null)} />}

      <div className="two">
        {selected.map((lang) => (
          <div key={lang} className="card">
            <h3>{LANGS[lang]}{p.scripts?.[lang]?.angle && p.scripts[lang].angle !== "auto"
              ? <span className="muted"> · {ANGLES[p.scripts[lang].angle]}</span> : null}</h3>
            <ScriptEditor productId={id} lang={lang} script={p.scripts?.[lang]}
              onSaved={(l, { clip_prompt: cp, flow_prompts: fp, ...s }) => setP((cur) => ({ ...cur, scripts: { ...cur.scripts, [l]: s }, clip_prompt: cp ?? cur.clip_prompt, flow_prompts: fp ?? cur.flow_prompts }))} />
          </div>
        ))}
      </div>
    </>
  );
}
