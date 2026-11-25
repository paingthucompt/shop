import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, creditsChanged, LANGS, LANG_FLAG } from "../api.js";
import { MAX_PHOTOS } from "../PhotoPicker.jsx";
import { ANGLE_KEYS, STYLE_KEYS, angleName, angleDesc, styleName, styleDesc } from "../options.js";
import { PHOTO_TYPES, pickPhotos, useFileDrop } from "../useFileDrop.js";
import { t } from "../i18n.js";

const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

// small per-browser memories (conveniences only — the page works without them)
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } },
};

/** rough API price of one AI clip (Gemini Omni / Seedance 2.5, Nov 2026) — shown before spending */
function aiClipUsd(provider, seconds = 10, resolution = "720p") {
  const r = String(resolution);
  const perSec = provider === "gemini" ? (r.startsWith("360") ? 0.0232 : r.startsWith("1080") ? 0.1043 : 0.0695)
    : provider === "seedance" ? (r.startsWith("480") ? 0.103 : 0.231) : 0;
  return perSec * (Number(seconds) || 10);
}

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  }
  return <button type="button" className={`btn sm ${copied ? "ok" : "secondary"}`} onClick={copy}>{copied ? `✓ ${t("common.copied")}` : `⧉ ${label}`}</button>;
}

/** one numbered step of the page; `state`: done | current | todo */
function Step({ n, id, state, title, hint, children }) {
  return (
    <section id={id} className={`card step ${state}`}>
      <header className="step-head">
        <span className="step-num">{state === "done" ? "✓" : n}</span>
        <div>
          <h2>{title}</h2>
          {hint && <p className="muted small">{hint}</p>}
        </div>
      </header>
      <div className="step-body">{children}</div>
    </section>
  );
}

function Stepper({ steps }) {
  return (
    <ol className="stepper">
      {steps.map((s, i) => (
        <li key={s.id} className={s.state}>
          <a href={`#${s.id}`}><span className="step-num">{s.state === "done" ? "✓" : i + 1}</span><span>{s.title}</span></a>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- step 1: script

function ScriptEditor({ productId, lang, script, onSaved }) {
  const [s, setS] = useState(script);
  const [msg, setMsg] = useState(null);
  useEffect(() => { setS(script); setMsg(null); }, [script]);
  if (!s) return <p className="muted">{t("script.none")}</p>;
  const caps = s.lines.map((_, i) => s.captions?.[i] ?? "");
  const dirty = JSON.stringify({ ...s, captions: caps }) !== JSON.stringify({ ...script, captions: script.lines.map((_, i) => script.captions?.[i] ?? "") });

  // the server drops empty lines together with their caption, so send both arrays as they are
  async function save() {
    setMsg(null);
    try {
      const r = await api(`/products/${productId}/scripts/${lang}`, { method: "PUT", body: { ...s, captions: caps } });
      onSaved(lang, r);
      setMsg({ ok: true, text: t("common.saved") });
    } catch (e) { setMsg({ ok: false, text: e.message }); }
  }
  const setLine = (i, v) => setS({ ...s, lines: s.lines.map((l, j) => (j === i ? v : l)) });
  const setCaption = (i, v) => setS({ ...s, captions: caps.map((c, j) => (j === i ? v : c)) });
  const removeLine = (i) => setS({ ...s, lines: s.lines.filter((_, j) => j !== i), captions: caps.filter((_, j) => j !== i) });

  return (
    <div className={`script lang-${lang}`}>
      <div className="beat hook">
        <span className="beat-tag">{t("script.hookTag")}</span>
        <label>{t("script.hook")}<input value={s.hook} maxLength={80} onChange={(e) => setS({ ...s, hook: e.target.value })} />
          <span className="hint">{t("script.hookHint")}</span></label>
      </div>
      {s.lines.map((l, i) => (
        <div key={i} className="beat">
          <span className="beat-tag">{t("script.lineTag", { n: i + 1 })}</span>
          {s.lines.length > 1 && <button type="button" className="beat-remove" title={t("script.removeLine")} aria-label={t("script.removeLine")} onClick={() => removeLine(i)}>✕</button>}
          <label>{t("script.spoken")}<input value={l} maxLength={160} onChange={(e) => setLine(i, e.target.value)} /></label>
          <label className="caption">{t("script.caption")}
            <input value={caps[i]} maxLength={60} placeholder={l} onChange={(e) => setCaption(i, e.target.value)} />
            {i === 0 && <span className="hint">{t("script.captionHint")}</span>}
          </label>
        </div>
      ))}
      {s.lines.length < 6 && <button type="button" className="btn subtle sm" onClick={() => setS({ ...s, lines: [...s.lines, ""], captions: [...caps, ""] })}>＋ {t("script.addLine")}</button>}
      <div className="beat cta">
        <span className="beat-tag">{t("script.ctaTag")}</span>
        <label>{t("script.cta")}<input value={s.cta} maxLength={80} onChange={(e) => setS({ ...s, cta: e.target.value })} />
          <span className="hint">{t("script.ctaHint")}</span></label>
      </div>
      <div className="row">
        {dirty && <button type="button" className="btn primary sm" onClick={save}>{t("script.save")}</button>}
        {dirty && <span className="hint">{t("script.unsaved")}</span>}
        {msg && <span className={msg.ok ? "ok-text small" : "bad-text small"}>{msg.ok ? "✓ " : ""}{msg.text}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- step 2: clip

const ROLE_KEY = { hook: "script.hookTag", intro: "scene.intro", feature: "scene.feature", use: "scene.use", value: "scene.value", cta: "script.ctaTag" };

/** on-screen text of scene i for the preview: the script beat it shows (caption wins over the spoken line) */
function sceneText(script, i, count) {
  if (!script) return "";
  if (i === 0) return script.hook;
  if (i === count - 1) return script.cta;
  return script.captions?.[i - 1]?.trim() || script.lines?.[i - 1] || "";
}

/** AI scene images made in the app: a storyboard you can check and redo scene by scene, then animate. */
function ScenesPanel({ scenes, scripts, busy, onMake, onRedo, notice }) {
  const langs = ["th", "my"].filter((l) => scripts?.[l]);
  const [tab, setTab] = useState(langs[0]);
  const lang = langs.includes(tab) ? tab : langs[0];
  const has = Array.isArray(scenes) && scenes.length > 0;
  const beats = (() => { const sc = scripts?.my || scripts?.th; return sc ? Math.min(6, 2 + (sc.lines?.length || 0)) : 0; })();
  return (
    <div className="panel">
      <div className="row between">
        <p className="muted small">{t("scenes.text")}</p>
        {has && langs.length > 1 && <Tabs value={lang} onChange={setTab} options={langs.map((l) => [l, `${LANG_FLAG[l]} ${LANGS[l]}`])} />}
      </div>
      <button type="button" className={`btn ${has ? "secondary" : "primary"}`} disabled={!!busy || !beats} onClick={onMake}>
        {busy === "scenes" ? t("scenes.making") : has ? t("scenes.again", { n: scenes.length }) : t("scenes.make", { n: beats })}
      </button>
      {has && (
        <div className="scenes">
          {scenes.map((sc, i) => (
            <div key={sc.n} className="scene-card">
              <div className="scene-label">{sc.n}. {t(ROLE_KEY[sc.role] || "scene.use")} <span>({sc.from}–{sc.to}s)</span></div>
              <div className="scene-frame">
                {sc.url ? <img src={sc.url} alt="" /> : <div className="scene-missing">{t("scenes.failed")}</div>}
                <div className={`scene-text lang-${lang}`}>{sceneText(scripts?.[lang], i, scenes.length)}</div>
              </div>
              <button type="button" className="btn subtle sm" disabled={!!busy} onClick={() => onRedo(sc.n)}>
                {busy === `scene-${sc.n}` ? t("scenes.making") : `↻ ${t("scenes.redo")}`}
              </button>
            </div>
          ))}
        </div>
      )}
      {notice && <p className="alert bad">{notice}</p>}
    </div>
  );
}

function Tabs({ value, onChange, options }) {
  return (
    <div className="tabs" role="tablist">
      {options.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={k === value} className={k === value ? "on" : ""} onClick={() => onChange(k)}>{label}</button>)}
    </div>
  );
}

/** Google Flow, per language: ① storyboard image → ② video from the storyboard → ③ upload the clip */
function FlowPanel({ prompts, talking, onTalking, clip, busy, onUpload, onRemove, notice }) {
  const langs = ["th", "my"].filter((l) => prompts?.[l]);
  const [tab, setTab] = useState(langs[0]);
  const { dragging, dropProps } = useFileDrop((files) => onUpload(files), { enabled: !busy, paste: false });
  if (!langs.length) return <p className="alert info">{t("flow.needScript")}</p>;
  const lang = langs.includes(tab) ? tab : langs[0];
  const fp = prompts[lang];
  const videoPrompt = talking && fp.video_talking ? fp.video_talking : fp.video;
  return (
    <div className="panel">
      <div className="row between">
        <div className="seg" role="radiogroup" aria-label={t("flow.voiceMode")}>
          <button type="button" role="radio" aria-checked={!talking} className={!talking ? "on" : ""} onClick={() => onTalking(false)}>🔇 {t("flow.silent")}</button>
          <button type="button" role="radio" aria-checked={talking} className={talking ? "on" : ""} onClick={() => onTalking(true)}>🗣 {t("flow.talking")}</button>
        </div>
        <a className="btn secondary sm" href="https://flow.google.com/" target="_blank" rel="noreferrer">{t("flow.open")} ↗</a>
      </div>
      <p className="hint">{talking ? t("flow.talkingHint", { n: langs.length }) : t("flow.silentHint")}</p>
      {langs.length > 1 && <Tabs value={lang} onChange={setTab} options={langs.map((l) => [l, `${LANG_FLAG[l]} ${LANGS[l]}`])} />}

      <ol className="flow-steps">
        <li>
          <div className="row between"><strong>{t("flow.s1")}</strong><CopyButton text={fp.storyboard} label={t("flow.copy")} /></div>
          <p className="hint">{t("flow.s1Hint")}{lang === "my" ? ` ${t("flow.s1HintMy")}` : ""}</p>
          <details><summary>{t("flow.showPrompt")}</summary><pre className="prompt">{fp.storyboard}</pre></details>
        </li>
        <li>
          <div className="row between"><strong>{t("flow.s2")}</strong><CopyButton text={videoPrompt} label={t("flow.copy")} /></div>
          <p className="hint">{t("flow.s2Hint", { s: fp.seconds })}{talking && lang === "my" ? ` ${t("flow.s2HintMy")}` : ""}</p>
          <details><summary>{t("flow.showPrompt")}</summary><pre className="prompt">{videoPrompt}</pre></details>
        </li>
        <li>
          <strong>{t("flow.s3")}</strong>
          <div className={`dropzone${dragging ? " dragging" : ""}${clip ? " has" : ""}`} {...dropProps}>
            {clip ? (
              <>
                <video className="clip-preview" src={clip.url} controls muted playsInline preload="metadata" />
                <div className="row">
                  <span className="ok-text small">✓ {t("flow.clipReady", { s: clip.seconds.toFixed(1) })}</span>
                  <label className="btn secondary sm">{busy ? t("flow.uploading") : t("flow.replace")}
                    <input type="file" accept={VIDEO_TYPES.join(",")} hidden disabled={busy} onChange={(e) => { onUpload([...e.target.files]); e.target.value = ""; }} /></label>
                  <button type="button" className="btn subtle sm danger" disabled={busy} onClick={onRemove}>{t("common.remove")}</button>
                </div>
              </>
            ) : (
              <>
                <div className="drop-icon" aria-hidden>⬆</div>
                <p>{dragging ? t("flow.dropNow") : t("flow.drop")}</p>
                <label className="btn primary sm">{busy ? t("flow.uploading") : t("flow.choose")}
                  <input type="file" accept={VIDEO_TYPES.join(",")} hidden disabled={busy} onChange={(e) => { onUpload([...e.target.files]); e.target.value = ""; }} /></label>
                <p className="hint">{t("flow.dropHint")}</p>
              </>
            )}
          </div>
          {notice && <p className="alert bad">{notice}</p>}
        </li>
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------- step 3: confirm and create

const VOICE_KEYS = ["none", "edge", "azure", "gemini"];
/** "gemini" or "th:gemini · my:edge" → readable text */
function voiceText(v) {
  if (VOICE_KEYS.includes(v)) return t(`voice.${v}`);
  return String(v).split(" · ").map((part) => { const [l, p] = part.split(":"); return `${LANG_FLAG[l] || l} ${VOICE_KEYS.includes(p) ? t(`voice.${p}`) : p}`; }).join(" · ");
}

/** Pre-spend gate: shows exactly what will be charged and generated; nothing is spent until "Confirm". */
function QuotePanel({ quote, busy, speeds, onSpeed, clipVoice, onClipVoice, onConfirm, onCancel }) {
  const c = quote.clip;
  const range = quote.voice_speed_range || { min: 0.8, max: 1.5 };
  const usd = c.mode === "gemini" || c.mode === "seedance" ? aiClipUsd(c.mode, c.duration_s, c.resolution) : 0;
  const blocked = (clipVoice && quote.langs.length > 1) || !quote.enough_credits || quote.missing_scripts.length > 0 || Object.keys(quote.script_issues || {}).length > 0;
  return (
    <div className="quote">
      <h3>{t("quote.title")}</h3>
      <dl className="kv">
        <dt>{t("quote.videos")}</dt><dd>{quote.langs.map((l) => `${LANG_FLAG[l]} ${LANGS[l]}`).join(" + ")}</dd>
        <dt>{t("quote.clip")}</dt><dd>{c.mode === "scenes" ? t("quote.clipScenes", { n: c.scene_count, s: Number(c.duration_s).toFixed(0) })
          : c.mode === "upload" ? t("quote.clipUpload", { s: Number(c.duration_s).toFixed(1) })
          : c.mode === "seedance" || c.mode === "gemini" ? t("quote.clipAi", { p: c.mode === "gemini" ? "Gemini" : "Seedance", s: c.duration_s, r: c.resolution })
          : c.mode === "photos" ? t("quote.clipPhotos", { n: c.reference_images, s: c.duration_s }) : "Sample clip (testing)"}</dd>
        {!["upload", "scenes", "photos"].includes(c.mode) && <><dt>{t("step1.style")}</dt><dd>{styleName(c.style)}</dd></>}
        <dt>{t("quote.voice")}</dt><dd>{clipVoice ? t("quote.voiceClip") : voiceText(quote.voiceover)}</dd>
        {quote.clip_source === "upload" && <><dt></dt><dd>
          <label className="check"><input type="checkbox" checked={clipVoice} disabled={busy} onChange={(e) => onClipVoice(e.target.checked)} /> {t("quote.clipHasVoice")}</label>
          {clipVoice && quote.langs.length > 1 && <p className="alert bad">{t("quote.oneLang")}</p>}
        </dd></>}
        {quote.voiceover !== "none" && !clipVoice && <><dt>{t("quote.speed")}</dt><dd>
          {quote.langs.map((l) => (
            <label key={l} className="speed">
              <span>{LANG_FLAG[l]} {LANGS[l].split(" ")[0]}</span>
              <input type="range" min={range.min} max={range.max} step="0.05" value={speeds[l] ?? 1} onChange={(e) => onSpeed(l, Number(e.target.value))} disabled={busy} />
              <strong>×{(speeds[l] ?? 1).toFixed(2)}</strong>
            </label>
          ))}
          <span className="hint">{t("quote.speedHint")}</span>
        </dd></>}
        <dt>{t("quote.cost")}</dt><dd><strong className="cost">{t("quote.credits", { n: quote.cost })}</strong> <span className="muted small">{quote.enough_credits ? t("quote.after", { b: quote.balance, a: quote.balance_after }) : t("quote.notEnough", { b: quote.balance })}</span>
          {usd > 0 && <p className="alert warn">💳 {t("quote.apiCost", { usd: usd.toFixed(2) })}</p>}</dd>
      </dl>
      {c.style_applies && <details><summary>{t("quote.prompt")}</summary><pre className="prompt">{c.prompt}</pre></details>}
      {Object.entries(quote.script_issues || {}).map(([lang, issue]) => <p key={lang} className="alert bad">⚠ {LANGS[lang]}: {issue}</p>)}
      <p className="hint">{t("quote.refund")}</p>
      <div className="row">
        <button type="button" className="btn primary lg" onClick={onConfirm} disabled={busy || blocked}>{busy ? t("quote.starting") : t("quote.confirm", { n: quote.cost })}</button>
        <button type="button" className="btn subtle" onClick={onCancel} disabled={busy}>{t("common.cancel")}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- page

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
  const [choice, setChoice] = useState(null); // clip source chosen in step 2 (null = suggested one)
  const [clipNotice, setClipNotice] = useState("");
  const [sceneNotice, setSceneNotice] = useState("");
  const [photoNotice, setPhotoNotice] = useState("");
  const [speeds, setSpeeds] = useState({});
  const [talking, setTalking] = useState(() => store.get("flowVoice", "silent") === "talking"); // Flow ②: silent clip or presenter speaking
  const [clipVoice, setClipVoice] = useState(false); // upload: the clip already has the voice
  const chooseTalking = (v) => { setTalking(v); store.set("flowVoice", v ? "talking" : "silent"); };
  const setSpeed = (l, v) => setSpeeds((cur) => { const next = { ...cur, [l]: v }; store.set("voiceSpeed", { ...store.get("voiceSpeed", {}), ...next }); return next; });

  useEffect(() => { api(`/products/${id}`).then(setP).catch((e) => setError(e.message)); }, [id]);
  const selected = Object.keys(langs).filter((l) => langs[l]);
  // a quote is only valid for the choices it was made for
  useEffect(() => setQuote(null), [langs, style, choice]);
  const scenesReady = Array.isArray(p?.scenes) && p.scenes.length > 0 && p.scenes.every((x) => x.url);
  const pick = choice || (p?.clip ? "flow" : scenesReady && p?.features?.scene_images ? "scenes" : "photos");
  const source = pick === "flow" ? "upload" : pick;

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
      const saved = store.get("voiceSpeed", {});
      setSpeeds(Object.fromEntries(q.langs.map((l) => [l, saved[l] ?? q.voice_speed_default?.[l] ?? 1])));
      setClipVoice(q.clip_source === "upload" && talking);
      setQuote(q);
    } catch (e) { setError(e.message); }
    setBusy("");
  }
  async function confirmVideo() {
    setBusy("video"); setError("");
    try {
      const job = await api("/jobs", { method: "POST", body: { product_id: Number(id), langs: quote.langs, style: quote.clip.style, clip_source: quote.clip_source, voice_speed: quote.voiceover !== "none" && !clipVoice ? speeds : undefined, clip_has_voice: quote.clip_source === "upload" && clipVoice, confirm_cost: quote.cost } });
      creditsChanged();
      nav(`/jobs/${job.id}`);
    } catch (e) { setError(e.message); setQuote(null); setBusy(""); }
  }
  // photo changes keep the scripts already loaded; a quote made before the change is no longer valid
  const keepScripts = (next) => setP((cur) => ({ ...next, scripts: cur.scripts, flow_prompts: cur.flow_prompts, features: cur.features }));
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
    try { keepScripts(await api(`/products/${id}/images/${index}`, { method: "DELETE" })); } catch (err) { setError(err.message); }
    setBusy("");
  }
  async function uploadClip(files) {
    const f = files.find((x) => VIDEO_TYPES.includes(x.type));
    setClipNotice(files.length && !f ? t("flow.onlyVideo") : "");
    if (!f) return;
    if (f.size > 200 * 1024 * 1024) return setClipNotice(t("flow.tooBig"));
    setBusy("clip"); setError(""); setQuote(null);
    try {
      const form = new FormData();
      form.append("clip", f);
      keepScripts(await api(`/products/${id}/clip`, { method: "POST", form }));
      setChoice("flow");
    } catch (err) { setClipNotice(err.message); }
    setBusy("");
  }
  async function removeClip() {
    setBusy("clip"); setError(""); setQuote(null);
    try { keepScripts(await api(`/products/${id}/clip`, { method: "DELETE" })); } catch (err) { setClipNotice(err.message); }
    setBusy("");
  }
  // scene images cost real money: credits are charged by the server (refunded for failed images)
  async function makeScenes() {
    const n = Array.isArray(p.scenes) && p.scenes.length ? p.scenes.length : null;
    if (n && !confirm(t("scenes.againConfirm", { n }))) return;
    setBusy("scenes"); setSceneNotice(""); setQuote(null);
    try {
      const r = await api(`/products/${id}/scenes`, { method: "POST", body: {} });
      keepScripts(r);
      creditsChanged();
      if (r.scenes_failed) setSceneNotice(t("scenes.someFailed", { n: r.scenes_failed }));
    } catch (err) { setSceneNotice(err.message); }
    setBusy("");
  }
  async function redoScene(n) {
    setBusy(`scene-${n}`); setSceneNotice(""); setQuote(null);
    try { keepScripts(await api(`/products/${id}/scenes/${n}`, { method: "POST", body: {} })); creditsChanged(); } catch (err) { setSceneNotice(err.message); }
    setBusy("");
  }
  async function remove() {
    if (!confirm(t("product.deleteConfirm", { title: p.title }))) return;
    setBusy("delete"); setError("");
    try { await api(`/products/${id}`, { method: "DELETE" }); nav("/"); } catch (e) { setError(e.message); setBusy(""); }
  }

  if (!p) return error ? <p className="alert bad">{error}</p> : <div className="card skeleton tall" />;

  const hasScripts = selected.length > 0 && selected.every((l) => p.scripts?.[l]);
  const missing = selected.filter((l) => !p.scripts?.[l]);
  const clipReady = pick === "photos" || pick === "ai_video" || (pick === "flow" && !!p.clip) || (pick === "scenes" && scenesReady);
  const s1 = hasScripts ? "done" : "current";
  const s2 = !hasScripts ? "todo" : clipReady ? "done" : "current";
  const s3 = hasScripts && clipReady ? "current" : "todo";
  const blockers = [
    !selected.length && t("step3.needLang"),
    missing.length > 0 && t("step3.needScript", { langs: missing.map((l) => LANGS[l]).join(", ") }),
    pick === "flow" && !p.clip && t("step3.needClip"),
    pick === "scenes" && !scenesReady && t("step3.needScenes"),
  ].filter(Boolean);
  const aiProvider = p.features?.ai_video;
  const choices = [
    { k: "photos", icon: "📷", badge: t("clip.free"), tone: "ok" },
    { k: "flow", icon: "🎬", badge: p.clip ? `✓ ${p.clip.seconds.toFixed(0)} s` : t("clip.flowPlan"), tone: p.clip ? "ok" : "" },
    ...(p.features?.scene_images ? [{ k: "scenes", icon: "🖼", badge: t("clip.perImage"), tone: "warn" }] : []),
    ...(aiProvider ? [{ k: "ai_video", icon: "✨", badge: `≈ US$${aiClipUsd(aiProvider).toFixed(2)}`, tone: "warn" }] : []),
  ];

  return (
    <>
      <Link to="/" className="back">← {t("nav.products")}</Link>
      <div className="page-head">
        <div className="product-head">
          {p.images[0]?.url && <img src={p.images[0].url} alt="" />}
          <div>
            <h1>{p.title}</h1>
            <p className="muted small">
              {p.price ? `${Number(p.price).toLocaleString()} ${p.currency}` : null}
              {p.product_url && <> · <a href={p.product_url} target="_blank" rel="noreferrer">{t("product.shopLink")} ↗</a></>}
              {p.affiliate_url && <> · <a href={p.affiliate_url} target="_blank" rel="noreferrer">{t("product.affiliateLink")} ↗</a></>}
            </p>
          </div>
        </div>
        <button className="btn subtle sm danger" onClick={remove} disabled={!!busy}>{busy === "delete" ? t("product.deleting") : `🗑 ${t("product.delete")}`}</button>
      </div>

      <details className="card photos-card">
        <summary><strong>{t("product.photos", { n: p.images.length, max: MAX_PHOTOS })}</strong> <span className="hint">{t("product.photosHint")}</span></summary>
        <div className={`photo-drop${dragging ? " dragging" : ""}`} {...dropProps}>
          <div className="photo-picker">
            {p.images.map((img, n) => (
              <div key={img.url} className="photo">
                <img src={img.url} alt="" />
                {n === 0 && <span className="photo-tag">{t("photos.main")}</span>}
                {p.images.length > 1 && <button type="button" className="remove" title={t("photos.remove")} aria-label={t("photos.remove")} disabled={!!busy} onClick={() => removePhoto(n)}>✕</button>}
              </div>
            ))}
            {p.images.length < MAX_PHOTOS && (
              <label className="photo add">
                <span>{busy === "photos" ? "…" : "＋"}</span>
                <small>{t("photos.add", { n: p.images.length, max: MAX_PHOTOS })}</small>
                <input type="file" accept={PHOTO_TYPES.join(",")} multiple hidden disabled={!!busy} onChange={(e) => { addPhotos([...e.target.files]); e.target.value = ""; }} />
              </label>
            )}
          </div>
          {p.images.length < MAX_PHOTOS && <p className="drop-hint">{dragging ? t("photos.drop") : t("photos.dropHint")}</p>}
          {photoNotice && <p className="alert bad">{photoNotice}</p>}
        </div>
      </details>

      <Stepper steps={[{ id: "step-1", title: t("step1.short"), state: s1 }, { id: "step-2", title: t("step2.short"), state: s2 }, { id: "step-3", title: t("step3.short"), state: s3 }]} />
      {error && <p className="alert bad">{error}</p>}

      <Step n={1} id="step-1" state={s1} title={t("step1.title")} hint={t("step1.hint")}>
        <div className="field">
          <span className="label">{t("step1.langs")}</span>
          <div className="chips">
            {Object.entries(LANGS).map(([k, label]) => (
              <label key={k} className={`chip${langs[k] ? " on" : ""}`}><input type="checkbox" checked={langs[k]} onChange={(e) => setLangs({ ...langs, [k]: e.target.checked })} />{LANG_FLAG[k]} {label}{p.scripts?.[k] ? " ✓" : ""}</label>
            ))}
          </div>
        </div>
        <div className="cols">
          <label>{t("step1.angle")}
            <select value={angle} onChange={(e) => setAngle(e.target.value)} disabled={!!busy}>{ANGLE_KEYS.map((k) => <option key={k} value={k}>{angleName(k)}</option>)}</select>
            <span className="hint">{angleDesc(angle)}</span>
          </label>
          <label>{t("step1.style")}
            <select value={style} onChange={(e) => setStyle(e.target.value)} disabled={!!busy}>{STYLE_KEYS.map((k) => <option key={k} value={k}>{styleName(k)}</option>)}</select>
            <span className="hint">{styleDesc(style)}</span>
          </label>
        </div>
        <div className="row">
          <button type="button" className={`btn ${hasScripts ? "secondary" : "primary"}`} disabled={!!busy || !selected.length}
            onClick={() => { if (!hasScripts || confirm(t("step1.rewriteConfirm"))) generate(); }}>
            {busy === "scripts" ? <><span className="spinner" /> {t("step1.writing")}</> : hasScripts ? `↻ ${t("step1.rewrite")}` : `✨ ${t("step1.write")}`}
          </button>
          {busy === "scripts" && <span className="hint">{t("step1.writingHint")}</span>}
        </div>
        {selected.some((l) => p.scripts?.[l]) && (
          <div className="two">
            {selected.map((lang) => (
              <div key={lang} className="script-card">
                <h3>{LANG_FLAG[lang]} {LANGS[lang]}{p.scripts?.[lang]?.angle && p.scripts[lang].angle !== "auto" ? <span className="muted small"> · {angleName(p.scripts[lang].angle)}</span> : null}</h3>
                <ScriptEditor productId={id} lang={lang} script={p.scripts?.[lang]}
                  onSaved={(l, { clip_prompt: cp, flow_prompts: fp, ...s }) => setP((cur) => ({ ...cur, scripts: { ...cur.scripts, [l]: s }, clip_prompt: cp ?? cur.clip_prompt, flow_prompts: fp ?? cur.flow_prompts }))} />
              </div>
            ))}
          </div>
        )}
      </Step>

      <Step n={2} id="step-2" state={s2} title={t("step2.title")} hint={t("step2.hint")}>
        <div className="choice-grid" role="radiogroup" aria-label={t("step2.title")}>
          {choices.map((c) => (
            <button key={c.k} type="button" role="radio" aria-checked={pick === c.k} className={`choice${pick === c.k ? " on" : ""}`} onClick={() => setChoice(c.k)}>
              <span className="choice-icon" aria-hidden>{c.icon}</span>
              <span className="choice-title">{c.k === "ai_video" ? t("clip.ai_video", { p: aiProvider === "gemini" ? "Gemini" : "Seedance" }) : t(`clip.${c.k}`)}</span>
              <span className="choice-desc">{t(`clip.${c.k}.desc`)}</span>
              <span className={`badge ${c.tone}`}>{c.badge}</span>
            </button>
          ))}
        </div>
        {pick === "photos" && <p className="alert info">{t("clip.photos.more")}</p>}
        {pick === "ai_video" && <p className="alert warn">💳 {t("clip.ai_video.more", { usd: aiClipUsd(aiProvider).toFixed(2), style: styleName(style) })}</p>}
        {pick === "flow" && <FlowPanel prompts={p.flow_prompts} talking={talking} onTalking={chooseTalking} clip={p.clip} busy={busy === "clip"} onUpload={uploadClip} onRemove={removeClip} notice={clipNotice} />}
        {pick === "scenes" && (p.clip_prompt
          ? <ScenesPanel scenes={p.scenes} scripts={p.scripts} busy={busy} onMake={makeScenes} onRedo={redoScene} notice={sceneNotice} />
          : <p className="alert info">{t("flow.needScript")}</p>)}
      </Step>

      <Step n={3} id="step-3" state={s3} title={t("step3.title")} hint={t("step3.hint")}>
        {quote ? (
          <QuotePanel quote={quote} busy={busy === "video"} speeds={speeds} onSpeed={setSpeed} clipVoice={clipVoice} onClipVoice={setClipVoice} onConfirm={confirmVideo} onCancel={() => setQuote(null)} />
        ) : (
          <>
            {blockers.length > 0 && <ul className="blockers">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
            <button type="button" className="btn primary lg" onClick={getQuote} disabled={!!busy || blockers.length > 0}>
              {busy === "quote" ? t("step3.checking") : `🎬 ${t("step3.button", { n: selected.length })}`}
            </button>
            <p className="hint">{t("step3.free")}</p>
          </>
        )}
      </Step>
    </>
  );
}
