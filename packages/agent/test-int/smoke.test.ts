// REAL smoke test (costs cents): real Claude, fake PayPal, local DB. Skipped unless SMOKE=1 and ANTHROPIC_API_KEY set:
//   SMOKE=1 ANTHROPIC_API_KEY=… pnpm --filter @kitoko/agent test:int smoke
import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { listConversationBookings, releaseHold } from "@kitoko/db";
import { handleMessage } from "../src/services/conversation";
import { testCtx } from "./fixtures";

const run = process.env.SMOKE === "1" && !!process.env.ANTHROPIC_API_KEY;
const ctx = testCtx();

type Turn = { user: string; tools: string[]; reply: string };

async function converse(handle: string, messages: readonly string[], until: (t: Turn) => boolean, locale: "en" | "it" | "fr" = "en") {
  let token: string | undefined;
  const turns: Turn[] = [];
  let conversationId = "";
  for (const text of messages) {
    const tools: string[] = [];
    const r = await handleMessage(ctx, {
      channel: "web",
      kind: "client",
      proHandle: handle,
      text,
      locale,
      ...(token ? { token } : {}),
      onEvent: (e) => {
        if (e.type === "tool_call") tools.push(`${e.name}(${JSON.stringify(e.input)})`);
        if (e.type === "tool_result" && e.isError) tools.push(`  ↳ ${e.name} ERROR ${JSON.stringify(e.output)}`);
      },
    });
    if (!r.ok) throw new Error(r.error);
    token = r.value.token;
    conversationId = r.value.conversationId;
    const turn = { user: text, tools, reply: r.value.text };
    turns.push(turn);
    const line = `\n[${handle}] CLIENT: ${text}\n${tools.map((t) => `  tool: ${t}`).join("\n")}\n[${handle}] AGENT: ${turn.reply}\n`;
    if (process.env.SMOKE_OUT) appendFileSync(process.env.SMOKE_OUT, line);
    else console.info(line);
    if (until(turn)) break;
  }
  // Leave no live hold behind for the other demos.
  for (const b of await listConversationBookings(ctx.db, conversationId)) if (b.status === "held") await releaseHold(ctx.db, b.id);
  return turns;
}

describe.skipIf(!run)("smoke: real Claude + fake PayPal", () => {
  it("Aïcha, in Italian, to a deposit link", async () => {
    const turns = await converse(
      "aicha.braids",
      [
        "Ciao, vorrei delle knotless braids sabato mattina",
        "Misura media, lunghezza a metà schiena, con le extension incluse. Il primo orario di sabato mattina va benissimo.",
        "Sì, va bene, confermo. Mi chiamo Giulia.",
        "Sì, procedi pure con il link per l'acconto.",
        "Sì.",
      ],
      (t) => t.tools.some((x) => x.startsWith("create_deposit_link")) && /\/pay\//.test(t.reply),
      "en",
    );
    const all = turns.flatMap((t) => t.tools);
    expect(all.some((x) => x.startsWith("hold_slot"))).toBe(true);
    expect(turns.at(-1)!.reply).toMatch(/\/it\/pay\/|\/pay\//);
  }, 300_000);

  it("English opener (Kemi)", async () => {
    await converse("kemi.nails", ["Hi! Could I get gel extensions next Thursday afternoon?"], () => true);
  }, 120_000);

  it("French opener (Studio Nala)", async () => {
    await converse("studio-nala", ["Bonjour, je voudrais des nattes collées mardi prochain en fin de matinée, c'est possible ?"], () => true, "fr");
  }, 120_000);
});
