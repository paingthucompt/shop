// Admin: give (or take) credits. Recorded in credit_ledger with reason "admin".
// Usage: npm run credits:add -- <email> <amount>      e.g. npm run credits:add -- me@example.com 100
import { pool, tx, changeCredits } from "./index.js";

const [email, amountArg] = process.argv.slice(2);
const amount = Number(amountArg);
if (!email || !Number.isInteger(amount) || amount === 0) {
  console.error("usage: npm run credits:add -- <email> <amount>   (amount: non-zero integer, negative to remove)");
  process.exit(1);
}

try {
  const balance = await tx(async (c) => {
    const { rows } = await c.query("SELECT id FROM users WHERE email = $1", [email.trim().toLowerCase()]);
    if (!rows[0]) throw new Error(`no user with email ${email}`);
    return changeCredits(c, rows[0].id, amount, "admin");
  });
  console.log(`✓ ${amount > 0 ? "+" : ""}${amount} credits → ${email} now has ${balance}`);
} catch (err) {
  console.error(`✖ ${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
