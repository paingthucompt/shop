import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { query, tx, changeCredits } from "@app/db";
import { ah, signToken, requireAuth } from "../lib.js";

const r = Router();
const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

r.post("/register", limiter, ah(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!EMAIL.test(email)) return res.status(400).json({ error: "invalid email" });
  if (password.length < 8) return res.status(400).json({ error: "password must be at least 8 characters" });
  const hash = await bcrypt.hash(password, 11);
  const free = Number(process.env.SIGNUP_FREE_CREDITS || 30);
  try {
    const user = await tx(async (c) => {
      const { rows } = await c.query(
        "INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name",
        [email, hash, req.body.name || null],
      );
      if (free > 0) await changeCredits(c, rows[0].id, free, "signup");
      return rows[0];
    });
    res.status(201).json({ token: signToken(user), user });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "email already registered" });
    throw e;
  }
}));

r.post("/login", limiter, ah(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const { rows } = await query("SELECT id, email, name, password_hash FROM users WHERE email = $1", [email]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(String(req.body.password || ""), u.password_hash))) {
    return res.status(401).json({ error: "wrong email or password" });
  }
  res.json({ token: signToken(u), user: { id: u.id, email: u.email, name: u.name } });
}));

r.get("/me", requireAuth, ah(async (req, res) => {
  const { rows } = await query("SELECT id, email, name, credits, created_at FROM users WHERE id = $1", [req.userId]);
  if (!rows[0]) return res.status(404).json({ error: "user not found" });
  res.json(rows[0]);
}));

export default r;
