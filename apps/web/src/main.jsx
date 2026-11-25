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

function Shell({ children, lang, onLang }) {
  const [me, setMe] = useState(null);
  const nav = useNavigate();
  useEffect(() => {
    const load = () => api("/auth/me").then(setMe).catch(() => {});
    load();
    return onCreditsChanged(load); // refresh the balance after spending / refunds
  }, []);
  if (!auth.token) return <Navigate to="/login" />;
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand"><span className="logo" aria-hidden>▶</span><span>{t("app.name")}</span></Link>
        <nav>
          <NavLink to="/" end>{t("nav.products")}</NavLink>
          <NavLink to="/jobs">{t("nav.videos")}</NavLink>
          <NavLink to="/settings">{t("nav.settings")}</NavLink>
        </nav>
        <div className="topbar-right">
          {me && (me.own_key
            ? <Link to="/settings" className="pill credits" title={t("nav.ownKeyHint")}>🔑 {t("nav.ownKey")}</Link>
            : <span className="pill credits" title={t("nav.creditsHint")}>🪙 {t("nav.credits", { n: me.credits })}</span>)}
          <LangSwitch lang={lang} onChange={onLang} />
          <button className="btn subtle sm" onClick={() => { auth.token = null; nav("/login"); }}>{t("nav.logout")}</button>
        </div>
      </header>
      <main>{children}</main>
    </>
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
