import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, LANG_FLAG } from "../api.js";
import { t } from "../i18n.js";
import Icon from "../icons.jsx";

/** where a product is in the flow: no script → script → video(s) */
function stageOf(p) {
  if (p.last_status === "running" || p.last_status === "queued") return { key: "making", tone: "warn", icon: "clock" };
  if (p.video_count > 0) return { key: "videos", tone: "ok", icon: "film" };
  if (p.script_langs?.length) return { key: "script", tone: "info", icon: "script" };
  return { key: "new", tone: "", icon: "sparkles" };
}

function ProductCard({ p }) {
  const stage = stageOf(p);
  return (
    <Link to={`/products/${p.id}`} className="product">
      <div className="product-img">
        {p.images[0]?.url ? <img src={p.images[0].url} alt="" loading="lazy" /> : <Icon name="package" size={36} />}
        {p.script_langs?.length > 0 && (
          <span className="product-flags" title={t("products.scriptsFor")}>{p.script_langs.map((l) => LANG_FLAG[l]).join(" ")}</span>
        )}
        {p.video_count > 0 && <span className="product-count"><Icon name="film" size={13} />{p.video_count}</span>}
      </div>
      <div className="product-body">
        <strong className="product-title">{p.title}</strong>
        <div className="product-foot">
          <span className="product-price">{p.price ? `${Number(p.price).toLocaleString()} ${p.currency}` : "—"}</span>
          <span className={`status-dot ${stage.tone}`}><Icon name={stage.icon} size={13} />{t(`products.stage.${stage.key}`)}</span>
        </div>
      </div>
    </Link>
  );
}

export default function Products() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { api("/products").then(setItems).catch((e) => setError(e.message)); }, []);
  const shown = (items || []).filter((p) => !q.trim() || p.title.toLowerCase().includes(q.trim().toLowerCase()));
  const videos = (items || []).reduce((a, p) => a + (p.video_count || 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow"><Icon name="package" size={14} />{t("nav.products")}</p>
          <h1>{t("products.title")}</h1>
          <p className="muted">{t("products.subtitle")}</p>
        </div>
        <div className="page-actions">
          {items?.length > 0 && (
            <label className="search-box">
              <Icon name="search" size={17} />
              <input type="search" placeholder={t("products.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("products.search")} />
            </label>
          )}
        </div>
      </div>
      {items?.length > 0 && (
        <p className="summary-line muted small">{t("products.summary", { n: items.length, v: videos })}</p>
      )}
      {error && <p className="alert bad">{error}</p>}
      {!items && !error && <div className="grid">{[0, 1, 2, 3].map((i) => <div key={i} className="product skeleton" />)}</div>}
      {items && !items.length && (
        <div className="card empty">
          <div className="empty-icon" aria-hidden><Icon name="package" size={30} /></div>
          <h2>{t("products.emptyTitle")}</h2>
          <p className="muted">{t("products.emptyText")}</p>
          <Link to="/products/new" className="btn primary lg"><Icon name="plus" size={18} />{t("products.add")}</Link>
        </div>
      )}
      {items?.length > 0 && (
        <div className="grid">
          {!q && (
            <Link to="/products/new" className="product add-card">
              <span className="add-icon"><Icon name="plus" size={26} /></span>
              <strong>{t("products.add")}</strong>
              <span className="muted small">{t("products.addHint")}</span>
            </Link>
          )}
          {shown.map((p) => <ProductCard key={p.id} p={p} />)}
        </div>
      )}
      {items?.length > 0 && !shown.length && <p className="muted center">{t("products.noMatch")}</p>}
    </>
  );
}
