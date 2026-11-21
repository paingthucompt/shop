import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { t } from "../i18n.js";

export default function Products() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { api("/products").then(setItems).catch((e) => setError(e.message)); }, []);
  const shown = (items || []).filter((p) => !q.trim() || p.title.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("products.title")}</h1>
          <p className="muted">{t("products.subtitle")}</p>
        </div>
        <Link to="/products/new" className="btn primary">＋ {t("products.add")}</Link>
      </div>
      {error && <p className="alert bad">{error}</p>}
      {!items && !error && <div className="grid">{[0, 1, 2, 3].map((i) => <div key={i} className="card product skeleton" />)}</div>}
      {items && !items.length && (
        <div className="card empty">
          <div className="empty-icon" aria-hidden>📦</div>
          <h2>{t("products.emptyTitle")}</h2>
          <p className="muted">{t("products.emptyText")}</p>
          <Link to="/products/new" className="btn primary">＋ {t("products.add")}</Link>
        </div>
      )}
      {items?.length > 6 && (
        <input className="search" type="search" placeholder={t("products.search")} value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      <div className="grid">
        {shown.map((p) => (
          <Link key={p.id} to={`/products/${p.id}`} className="card product">
            <div className="product-img">{p.images[0]?.url ? <img src={p.images[0].url} alt="" loading="lazy" /> : <span aria-hidden>📦</span>}</div>
            <strong className="product-title">{p.title}</strong>
            <span className="muted small">{p.price ? `${Number(p.price).toLocaleString()} ${p.currency}` : " "}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
