import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, creditsChanged, LANGS, LANG_FLAG } from "../api.js";
import { t, getLang, errorText } from "../i18n.js";
import Icon from "../icons.jsx";

const WORKING = new Set(["queued", "running"]);
const SOURCE_ICON = { photos: "camera", upload: "upload", scenes: "image", ai_video: "sparkles", auto: "settings" };
const locale = () => (getLang() === "my" ? "my-MM" : undefined);
const shortLang = (l) => LANGS[l].split(" ")[0];

/** "3 min ago" for today's jobs, otherwise the clock time (the day is the group heading) */
function when(iso) {
  const d = new Date(iso);
  const min = Math.round((Date.now() - d) / 60000);
  if (min < 1) return t("jobs.justNow");
  if (min < 60) return t("jobs.minAgo", { n: min });
  if (min < 6 * 60 && d.toDateString() === new Date().toDateString()) return t("jobs.hAgo", { n: Math.round(min / 60) });
  return d.toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" });
}

/** group heading: Today / Yesterday / weekday + date */
function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return t("jobs.today");
  if (diff === 1) return t("jobs.yesterday");
  return d.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long", year: day.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

/** clip → one render per language → done, as a row of steps */
function Progress({ job }) {
  const steps = [{ key: "clip", label: t("jobs.stage.clip") }, ...job.langs.map((l) => ({ key: `render:${l}`, label: t("jobs.stage.render", { lang: shortLang(l) }) })), { key: "done", label: t("jobs.stage.done") }];
  const at = job.status === "succeeded" ? steps.length - 1 : Math.max(0, steps.findIndex((s) => s.key === job.stage));
  return (
    <ol className="progress">
      {steps.map((s, i) => {
        const state = job.status === "failed" && i === at ? "bad" : i < at || job.status === "succeeded" ? "done" : i === at && job.status !== "queued" ? "now" : "todo";
        return <li key={s.key} className={state}><span className="dot">{state === "done" ? "✓" : state === "bad" ? "!" : i + 1}</span>{s.label}</li>;
      })}
    </ol>
  );
}

/** small inline progress for a row in the list: how far along clip → languages it is */
function MiniProgress({ job }) {
  const keys = ["clip", ...job.langs.map((l) => `render:${l}`)];
  const at = Math.max(0, keys.indexOf(job.stage));
  const pct = job.status === "queued" ? 4 : Math.round(((at + 0.5) / (keys.length + 0.5)) * 100);
  const label = job.status === "queued" ? t("jobs.status.queued") : job.stage === "clip" ? t("jobs.stage.clip") : t("jobs.stage.render", { lang: shortLang(job.stage?.split(":")[1] || job.langs[0]) });
  return (
    <span className="mini-progress" title={label}>
      <span className="bar"><span style={{ width: `${pct}%` }} /></span>
      <span className="small">{label}…</span>
    </span>
  );
}

const StatusBadge = ({ status }) => <span className={`badge ${status}`}>{t(`jobs.status.${status}`)}</span>;

function JobDetail({ id, onStatus, onClose }) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [tg, setTg] = useState({ busy: false, msg: null }); // (re)send to Telegram
  async function sendTelegram() {
    setTg({ busy: true, msg: null });
    try {
      const r = await api(`/jobs/${id}/telegram`, { method: "POST" });
      setTg({ busy: false, msg: { ok: true, text: t("tg.sent", { n: r.sent }) } });
      setJob((j) => ({ ...j, videos: j.videos.map((v) => ({ ...v, telegram_sent_at: new Date().toISOString() })) }));
    } catch (e) { setTg({ busy: false, msg: { ok: false, text: e.message, code: e.code } }); }
  }
  const box = useRef(null);
  useEffect(() => {
    let timer, cancelled = false;
    setJob(null); setError("");
    box.current?.scrollIntoView({ block: "start" });
    const load = () => api(`/jobs/${id}`).then((j) => {
      if (cancelled) return; // a response for a job we already navigated away from
      setJob(j);
      onStatus?.(j);
      if (WORKING.has(j.status)) timer = setTimeout(load, 3000);
      else if (j.refunded) creditsChanged();
    }).catch((e) => !cancelled && setError(e.message));
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="card job" ref={box}>
      {error && <p className="alert bad">{error}</p>}
      {!job && !error && <div className="skeleton" />}
      {job && <>
        <div className="row between">
          <h2>{t("jobs.job", { id: job.id })} <StatusBadge status={job.status} /></h2>
          <div className="row">
            <Link to={`/products/${job.product_id}`} className="btn secondary sm">{t("jobs.toProduct")} →</Link>
            <button type="button" className="btn subtle sm" onClick={onClose} aria-label={t("jobs.close")}>✕</button>
          </div>
        </div>
        <Progress job={job} />
        {WORKING.has(job.status) && <p className="muted small center">{t("jobs.wait")}</p>}
        {job.api_usd > 0 && (
          <p className="muted small meta-i"><Icon name="dollar" size={14} />{t("cost.job", { usd: usd(job.api_usd) })}
            {job.api_cost.length > 0 && ` (${job.api_cost.map((c) => `${t(`cost.kind.${c.kind}`)} ${usd(c.usd)}`).join(" · ")})`}</p>
        )}
        {job.error && (
          <p className="alert bad">{errorText(job.error_code, job.error)}{job.refunded ? ` — ${t("jobs.refunded", { n: job.credits_charged })}` : ""}
            {job.error_code?.startsWith("key_") && <> <Link to="/settings">{t("err.openSettings")} →</Link></>}</p>
        )}
        {job.videos.length > 0 && (
          <div className="videos">
            {job.videos.map((v) => (
              <div key={v.lang} className="video">
                <h3>{LANG_FLAG[v.lang]} {LANGS[v.lang]} {v.duration ? <span className="muted small">· {Number(v.duration).toFixed(0)} s</span> : null}</h3>
                <video src={v.url} controls playsInline preload="metadata" />
                <div className="row">
                  <a className="btn primary" href={`${v.url}&download=1`}><Icon name="download" size={17} />{t("jobs.download")}</a>
                  {v.srt_url && <a className="btn subtle" href={`${v.srt_url}&download=1`}>{t("jobs.srt")}</a>}
                </div>
              </div>
            ))}
          </div>
        )}
        {job.status === "succeeded" && job.videos.length > 0 && (
          <div className="row tg-row">
            <button type="button" className="btn secondary sm" onClick={sendTelegram} disabled={tg.busy}>
              <Icon name="upload" size={15} />{tg.busy ? t("tg.sending") : job.videos.every((v) => v.telegram_sent_at) ? t("tg.resend") : t("tg.send")}
            </button>
            {job.videos.some((v) => v.telegram_sent_at) && !tg.msg && <span className="ok-text small">✓ {t("tg.alreadySent")}</span>}
            {tg.msg && <span className={tg.msg.ok ? "ok-text small" : "bad-text small"}>{tg.msg.text}
              {tg.msg.code === "telegram_not_connected" && <> <Link to="/settings">{t("err.openSettings")} →</Link></>}</span>}
          </div>
        )}
        {job.status === "succeeded" && <p className="alert info">💡 {t("jobs.next")}</p>}
      </>}
    </section>
  );
}

/** US$ with enough digits for cents and fractions of a cent */
const usd = (n) => `$${Number(n) >= 1 ? Number(n).toFixed(2) : Number(n).toFixed(3)}`;

/** this month's API spend: per video, by kind, and the previous months */
function CostSummary({ spend }) {
  const m = spend.month;
  return (
    <details className="card cost-summary">
      <summary>
        <Icon name="dollar" size={16} /> {t("cost.summary", { usd: usd(m.usd), n: m.videos })}
        {m.usd_per_video != null && <> · <strong>{t("cost.perVideo", { usd: usd(m.usd_per_video) })}</strong></>}
      </summary>
      <ul className="cost-kinds">
        {m.by_kind.map((k) => (
          <li key={k.kind}><span>{t(`cost.kind.${k.kind}`)}</span><span className="muted small">× {k.calls}</span><span>{usd(k.usd)}{k.unpriced ? " *" : ""}</span></li>
        ))}
      </ul>
      {m.unpriced_calls > 0 && <p className="muted small">* {t("cost.unpriced", { n: m.unpriced_calls })}</p>}
      {spend.months.length > 1 && (
        <p className="muted small">{spend.months.map((x) => `${x.month}: ${usd(x.usd)} (${x.videos})`).join(" · ")}</p>
      )}
      <p className="muted small">{t("cost.note")}</p>
    </details>
  );
}

/** one number on the Videos page, with an icon in its colour */
function Stat({ tone, icon, n, label, title }) {
  return (
    <div className={`stat ${tone}`} title={title}>
      <span className="stat-icon"><Icon name={icon} size={17} /></span>
      <span className="stat-n">{n}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function JobRow({ j, current }) {
  const nav = useNavigate();
  const used = j.refunded ? 0 : j.credits_charged;
  return (
    <li className={`job-card ${j.status}${current ? " current" : ""}`}>
      <Link to={`/jobs/${j.id}`} className="job-main" title={j.product_title}>
        <span className="job-thumb">{j.image_url ? <img src={j.image_url} alt="" loading="lazy" /> : <Icon name="package" size={22} />}<span className="job-flags">{j.langs.map((l) => LANG_FLAG[l]).join("")}</span></span>
        <span className="job-text">
          <span className="job-title">{j.product_title}</span>
          <span className="job-meta">
            <span>#{j.id}</span>
            <span className="meta-i"><Icon name={SOURCE_ICON[j.clip_source] || "settings"} size={14} />{t(`jobs.src.${j.clip_source}`)}{j.clip_has_voice && <Icon name="mic" size={14} />}</span>
            <span className="meta-i">{j.own_key ? <><Icon name="key" size={14} />{t("jobs.ownKey")}</> : <><Icon name="coins" size={14} />{j.refunded ? t("jobs.refundedShort") : t("jobs.creditsN", { n: used })}</>}</span>
            {j.api_usd > 0 && <span className="meta-i" title={t("cost.jobTitle")}><Icon name="dollar" size={14} />{usd(j.api_usd)}</span>}
            <span>{when(j.created_at)}</span>
          </span>
        </span>
      </Link>
      <span className="job-side">
        {WORKING.has(j.status) ? <MiniProgress job={j} /> : <StatusBadge status={j.status} />}
        {j.status === "succeeded" && [...j.videos].sort((a, b) => j.langs.indexOf(a.lang) - j.langs.indexOf(b.lang)).map((v) => (
          <a key={v.lang} className="btn secondary sm" href={`${v.url}&download=1`} title={t("jobs.downloadLang", { lang: LANGS[v.lang] })}><Icon name="download" size={15} />{LANG_FLAG[v.lang]} {shortLang(v.lang)}</a>
        ))}
        {j.status === "failed" && <button type="button" className="btn secondary sm" onClick={() => nav(`/products/${j.product_id}#step-3`)}>↻ {t("jobs.retry")}</button>}
      </span>
    </li>
  );
}

export default function Jobs() {
  const { id } = useParams();
  const nav = useNavigate();
  const [jobs, setJobs] = useState(null);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [spend, setSpend] = useState(null);
  useEffect(() => { api("/usage").then(setSpend).catch(() => setSpend(null)); }, [id]);

  // the list refreshes itself while something is still being made
  useEffect(() => {
    let timer, cancelled = false;
    const load = () => api("/jobs").then((list) => {
      if (cancelled) return;
      setJobs(list);
      if (list.some((j) => WORKING.has(j.status))) timer = setTimeout(load, 5000);
    }).catch(() => !cancelled && setJobs((cur) => cur || []));
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id]);
  // keep the row of the job being watched in sync
  const onStatus = (job) => setJobs((list) => list?.map((j) => (j.id === job.id ? { ...j, status: job.status, stage: job.stage, refunded: job.refunded, videos: job.videos.map(({ lang, duration, url }) => ({ lang, duration, url })) } : j)));

  const counts = useMemo(() => {
    const c = { all: 0, succeeded: 0, working: 0, failed: 0, videos: 0, credits: 0 };
    for (const j of jobs || []) {
      c.all++;
      if (j.status === "succeeded") { c.succeeded++; c.videos += j.videos.length; }
      else if (j.status === "failed") c.failed++;
      else c.working++;
      if (!j.refunded) c.credits += j.credits_charged || 0;
    }
    return c;
  }, [jobs]);

  const shown = (jobs || []).filter((j) =>
    (filter === "all" || (filter === "working" ? WORKING.has(j.status) : j.status === filter)) &&
    (!q.trim() || j.product_title.toLowerCase().includes(q.trim().toLowerCase()) || String(j.id) === q.trim().replace("#", "")));
  const groups = [];
  for (const j of shown) {
    const label = dayLabel(j.created_at);
    if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
    groups.at(-1).items.push(j);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow"><Icon name="film" size={14} />{t("nav.videos")}</p>
          <h1>{t("jobs.title")}</h1>
          <p className="muted">{t("jobs.subtitle")}</p>
        </div>
        <Link to="/" className="btn primary"><Icon name="plus" size={18} />{t("jobs.new")}</Link>
      </div>

      {id && <JobDetail id={id} onStatus={onStatus} onClose={() => nav("/jobs")} />}

      {jobs?.length > 0 && (
        <div className="stats">
          <Stat tone="ok" icon="check" n={counts.videos} label={t("jobs.stats.videos")} />
          <Stat tone="warn" icon="clock" n={counts.working} label={t("jobs.stats.working")} />
          <Stat tone="bad" icon="alert" n={counts.failed} label={t("jobs.stats.failed")} />
          <Stat tone="" icon="coins" n={counts.credits} label={t("jobs.stats.credits")} />
          {spend && <Stat tone="info" icon="dollar" n={usd(spend.month.usd)} label={t("cost.month")} title={t("cost.monthTitle")} />}
        </div>
      )}
      {spend?.month.usd > 0 && <CostSummary spend={spend} />}

      {jobs?.length > 0 && (
        <div className="toolbar">
          <div className="seg" role="tablist" aria-label={t("jobs.filter")}>
            {[["all", counts.all], ["succeeded", counts.succeeded], ["working", counts.working], ["failed", counts.failed]].map(([k, n]) => (
              <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>
                {t(`jobs.filter.${k}`)} <span className="count">{n}</span>
              </button>
            ))}
          </div>
          <label className="search-box">
            <Icon name="search" size={17} />
            <input type="search" placeholder={t("jobs.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("jobs.search")} />
          </label>
        </div>
      )}

      {!jobs && <div className="card skeleton" />}
      {jobs && !jobs.length && (
        <div className="card empty">
          <div className="empty-icon" aria-hidden><Icon name="film" size={30} /></div>
          <h2>{t("jobs.emptyTitle")}</h2>
          <p className="muted">{t("jobs.emptyText")}</p>
          <Link to="/" className="btn primary">{t("jobs.toProducts")}</Link>
        </div>
      )}
      {jobs?.length > 0 && !shown.length && <p className="muted center">{t("jobs.noMatch")}</p>}

      {groups.map((g) => (
        <section key={g.label} className="job-group">
          <h2 className="group-title">{g.label} <span className="muted small">· {g.items.length}</span></h2>
          <ul className="job-list">{g.items.map((j) => <JobRow key={j.id} j={j} current={String(j.id) === id} />)}</ul>
        </section>
      ))}
    </>
  );
}
