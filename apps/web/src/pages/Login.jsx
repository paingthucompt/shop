import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, auth } from "../api.js";
import { t } from "../i18n.js";

export default function Login({ lang, onLang, LangSwitch }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const r = await api(`/auth/${mode}`, { method: "POST", body: { email, password } });
      auth.token = r.token;
      nav("/");
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <div className="auth">
      <div className="auth-lang"><LangSwitch lang={lang} onChange={onLang} /></div>
      <div className="auth-hero">
        <span className="logo big" aria-hidden>▶</span>
        <h1>{t("app.name")}</h1>
        <p className="muted">{t("login.tagline")}</p>
        <ol className="how">
          <li><span>1</span>{t("login.how1")}</li>
          <li><span>2</span>{t("login.how2")}</li>
          <li><span>3</span>{t("login.how3")}</li>
        </ol>
      </div>
      <form onSubmit={submit} className="card auth-form">
        <h2>{mode === "login" ? t("login.title") : t("login.titleNew")}</h2>
        <label>{t("login.email")}<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>{t("login.password")}<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={t("login.passwordHint")} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></label>
        {error && <p className="alert bad">{error}</p>}
        <button type="submit" className="btn primary block" disabled={busy}>{busy ? "…" : mode === "login" ? t("login.submit") : t("login.submitNew")}</button>
        <button type="button" className="btn subtle block" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
          {mode === "login" ? t("login.toRegister") : t("login.toLogin")}
        </button>
      </form>
    </div>
  );
}
