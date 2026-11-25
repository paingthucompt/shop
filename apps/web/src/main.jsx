import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link, NavLink, Navigate, useNavigate } from "react-router-dom";
import { api, auth, onCreditsChanged } from "./api.js";
import { t, getLang, setLang, UI_LANGS } from "./i18n.js";
import Login from "./pages/Login.jsx";
import Products from "./pages/Products.jsx";
import NewProduct from "./pages/NewProduct.jsx";
import Product from "./pages/Product.jsx";
import Jobs from "./pages/Jobs.jsx";
import Settings from "./pages/Settings.jsx";
import Icon from "./icons.jsx";
import "./style.css";

function LangSwitch({ lang, onChange }) {
  return (
    <div className="lang-switch" role="group" aria-label={t("nav.language")}>
      {Object.entries(UI_LANGS).map(([k, label]) => (
        <button key={k} type="button" className={k === lang ? "on" : ""} aria-pressed={k === lang} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  );
}

const NAV = [
  { to: "/", end: true, icon: "package", label: "nav.products" },
  { to: "/jobs", icon: "film", label: "nav.videos" },
  { to: "/settings", icon: "settings", label: "nav.settings" },
];

/** credits, or "own API key" — the one number the seller watches */
function Balance({ me, compact = false }) {
  if (!me) return <span className="balance skeleton-line" />;
  return me.own_key ? (
    <Link to="/settings" className={`balance own${compact ? " compact" : ""}`} title={t("nav.ownKeyHint")}>
      <Icon name="key" size={16} /><span>{t("nav.ownKey")}</span>
    </Link>
  ) : (
    <span className={`balance${compact ? " compact" : ""}`} title={t("nav.creditsHint")}>
      <Icon name="coins" size={16} /><strong>{me.credits}</strong><span>credits</span>
    </span>
  );
}

function Shell({ children, lang, onLang }) {
  const [me, setMe] = useState(null);
  const nav = useNavigate();
  useEffect(() => {
    const load = () => api("/auth/me").then(setMe).catch(() => {});
    load();
    return onCreditsChanged(load); // refresh the balance after spending / refunds
  }, []);
  if (!auth.token) return <Navigate to="/login" />;
  const logout = () => { auth.token = null; nav("/login"); };
  return (
    <div className="app">
      {/* desktop: sidebar */}
      <aside className="sidebar">
        <Link to="/" className="brand"><span className="logo" aria-hidden><Icon name="play" size={14} /></span><span>{t("app.name")}</span></Link>
        <Link to="/products/new" className="btn primary block new-btn"><Icon name="plus" size={18} />{t("products.add")}</Link>
        <nav className="side-nav" aria-label={t("nav.main")}>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}><Icon name={n.icon} size={19} /><span>{t(n.label)}</span></NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="account-card">
            <span className="muted small">{t("nav.balance")}</span>
            <Balance me={me} />
          </div>
          <LangSwitch lang={lang} onChange={onLang} />
          <div className="me-row">
            <span className="avatar" aria-hidden>{(me?.email || "?")[0].toUpperCase()}</span>
            <span className="me-email" title={me?.email}>{me?.email || " "}</span>
            <button className="icon-btn" onClick={logout} title={t("nav.logout")} aria-label={t("nav.logout")}><Icon name="logout" size={18} /></button>
          </div>
        </div>
      </aside>

      <div className="app-body">
        {/* phone: slim top bar */}
        <header className="mobile-top">
          <Link to="/" className="brand"><span className="logo" aria-hidden><Icon name="play" size={13} /></span><span>{t("app.name")}</span></Link>
          <div className="mobile-top-right">
            <Balance me={me} compact />
            <LangSwitch lang={lang} onChange={onLang} />
          </div>
        </header>
        <main>{children}</main>
      </div>

      {/* phone: bottom tab bar, the main action in the middle */}
      <nav className="tabbar" aria-label={t("nav.main")}>
        <NavLink to="/" end><Icon name="package" size={22} /><span>{t("nav.products")}</span></NavLink>
        <NavLink to="/jobs"><Icon name="film" size={22} /><span>{t("nav.videos")}</span></NavLink>
        <Link to="/products/new" className="tab-new" aria-label={t("products.add")}><Icon name="plus" size={26} /></Link>
        <NavLink to="/settings"><Icon name="settings" size={22} /><span>{t("nav.settings")}</span></NavLink>
        <button type="button" onClick={logout}><Icon name="logout" size={22} /><span>{t("nav.logout")}</span></button>
      </nav>
    </div>
  );
}

function App() {
  const [lang, setL] = useState(getLang());
  const change = (l) => { setLang(l); setL(l); };
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  // key={lang}: every page re-renders in the chosen language
  const shell = (page) => <Shell key={lang} lang={lang} onLang={change}>{page}</Shell>;
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login key={lang} lang={lang} onLang={change} LangSwitch={LangSwitch} />} />
        <Route path="/" element={shell(<Products />)} />
        <Route path="/products/new" element={shell(<NewProduct />)} />
        <Route path="/products/:id" element={shell(<Product />)} />
        <Route path="/jobs" element={shell(<Jobs />)} />
        <Route path="/jobs/:id" element={shell(<Jobs />)} />
        <Route path="/settings" element={shell(<Settings />)} />
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>);
