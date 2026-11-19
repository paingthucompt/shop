// Container entrypoint (Cloud Run): run DB migrations, then the API (+ dashboard) and the video worker
// side by side in one instance. If either process dies the container exits, so Cloud Run restarts it.
//   ROLE=all (default) | api | worker   — split them into separate services later if you need to scale
import { spawn, spawnSync } from "node:child_process";

const role = (process.env.ROLE || "all").toLowerCase();

if (role !== "worker") {
  const m = spawnSync(process.execPath, ["packages/db/migrate.js"], { stdio: "inherit" });
  if (m.status !== 0) process.exit(m.status || 1);
}

const procs = [];
const start = (name, file) => {
  const p = spawn(process.execPath, [file], { stdio: "inherit" });
  p.on("exit", (code, signal) => {
    console.error(`✖ ${name} exited (${signal || code}) — stopping the container`);
    for (const o of procs) if (o !== p) o.kill("SIGTERM");
    process.exit(code || 1);
  });
  procs.push(p);
};

if (role === "all" || role === "api") start("api", "apps/api/src/server.js");
if (role === "all" || role === "worker") start("worker", "apps/worker/src/worker.js");

// Cloud Run sends SIGTERM before stopping an instance: let the worker finish its BullMQ shutdown
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => procs.forEach((p) => p.kill(sig)));
