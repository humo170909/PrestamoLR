// A-01: higiene de secretos en el repositorio y en el despliegue (sin leer .env.local).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const lines = (p: string) => read(p).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

test(".gitignore excluye .env*, seed, node_modules, .next y tsbuildinfo, pero permite .env.example", () => {
  const g = lines(".gitignore");
  for (const rule of [".env*", "!.env.example", "supabase/seed/", "node_modules", ".next", "*.tsbuildinfo", ".vercel"]) assert.ok(g.includes(rule), `falta ${rule}`);
});

test(".vercelignore excluye secretos, seed, auditoría y pruebas de UI", () => {
  const v = lines(".vercelignore");
  for (const rule of [".env*", "supabase/seed/", "auditoria-output/", "tests-responsive/"]) assert.ok(v.includes(rule), `falta ${rule}`);
});

test(".env.example documenta todas las variables que el código lee, sin valores", () => {
  const ex = read(".env.example");
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET", "TELEGRAM_ENCRYPTION_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NEXT_PUBLIC_ENABLE_DEMO_AUTH"]) {
    assert.match(ex, new RegExp(`^${name}=`, "m"), `${name} debe estar activa (no comentada) en .env.example`);
  }
  assert.doesNotMatch(ex, /NO se usa en este proyecto/, "nota obsoleta sobre service_role");
  for (const l of ex.split(/\r?\n/).filter((x) => /^[A-Z_]+=/.test(x))) {
    const value = l.split("=")[1].split("#")[0].trim();
    assert.ok(value === "" || value === "false", `${l.split("=")[0]} no debe llevar valor real`);
  }
});
