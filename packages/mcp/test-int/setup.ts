import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Points the tests at the local stack (`pnpm db:start` from the repo root), with the in-process fake PayPal.
export default function setup() {
  let out: string;
  try {
    out = execFileSync("supabase", ["status", "-o", "env"], {
      cwd: fileURLToPath(new URL("../../..", import.meta.url)),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (cause) {
    throw new Error("`supabase status` failed: install the Supabase CLI and run `pnpm db:start` from the repo root.", { cause });
  }
  const vars = new Map(Array.from(out.matchAll(/^(\w+)="(.*)"$/gm), (m) => [m[1], m[2]]));
  for (const [name, key] of [
    ["SUPABASE_URL", "API_URL"],
    ["SUPABASE_ANON_KEY", "ANON_KEY"],
    ["SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY"],
  ] as const) {
    const value = vars.get(key);
    if (!value) throw new Error(`\`supabase status -o env\` printed no ${key}; is the local stack running?`);
    process.env[name] = value;
  }
  process.env.PAYPAL_ENV = "fake";
  process.env.AGENT_FAKE = "1";
  process.env.SITE_URL ??= "http://localhost:3300";
}
