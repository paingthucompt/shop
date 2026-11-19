import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, auth } from "../api.js";

export default function Login() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const nav = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setError("");
    try {
      const r = await api(`/auth/${mode}`, { method: "POST", body: { email, password } });
      auth.token = r.token;
      nav("/");
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="auth">
      <h1>Affiliate Video Studio</h1>
      <p className="muted">Product photos → Thai & Myanmar sales videos</p>
      <form onSubmit={submit} className="card">
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        {error && <p className="error">{error}</p>}
        <button type="submit">{mode === "login" ? "Log in" : "Create account"}</button>
        <button type="button" className="ghost" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "New here? Create an account" : "Have an account? Log in"}
        </button>
      </form>
    </div>
  );
}
