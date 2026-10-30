import { describe, expect, it } from "vitest";
import { prepareHistory, textOf } from "../src/core/history";
import type { AgentMessage } from "../src/model/types";

const user = (text: string): AgentMessage => ({ role: "user", content: [{ type: "text", text }] });
const say = (text: string): AgentMessage => ({ role: "assistant", content: [{ type: "text", text }] });
const call = (id: string, name = "get_availability"): AgentMessage => ({
  role: "assistant",
  content: [{ type: "tool_use", id, name, input: {} }],
});
const result = (id: string): AgentMessage => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "[]" }] });

/** A turn with a tool round: user, tool_use, tool_result, answer. */
const turn = (n: number): AgentMessage[] => [user(`q${n}`), call(`t${n}`), result(`t${n}`), say(`a${n}`)];

describe("prepareHistory", () => {
  it("keeps the last N turns, cutting at a turn start so tool_use keeps its tool_result", () => {
    const history = [1, 2, 3, 4].flatMap(turn);
    const kept = prepareHistory(history, 2);
    expect(kept).toEqual([...turn(3), ...turn(4)]);
  });

  it("keeps everything under the limit and accepts string content", () => {
    const history: AgentMessage[] = [{ role: "user", content: "hi" }, { role: "assistant", content: "Hello!" }];
    expect(prepareHistory(history, 20)).toEqual([user("hi"), say("Hello!")]);
  });

  it("counts [event] messages as turns", () => {
    const history = [user("book"), say("Held."), user("[event] payment_captured {}"), say("Confirmed!")];
    expect(prepareHistory(history, 1)).toEqual([user("[event] payment_captured {}"), say("Confirmed!")]);
  });

  it("drops a tool_use whose tool_result never came, and an orphan tool_result", () => {
    const crashed: AgentMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "Let me check." },
        { type: "tool_use", id: "lost", name: "hold_slot", input: {} },
      ],
    };
    const history = [user("q1"), crashed, user("hello?"), result("ghost"), say("a")];
    expect(prepareHistory(history)).toEqual([user("q1"), say("Let me check."), user("hello?"), say("a")]);
  });

  it("drops thinking blocks and the messages they leave empty", () => {
    const history: AgentMessage[] = [
      user("q"),
      { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "sig" }] },
      {
        role: "assistant",
        content: [
          { type: "redacted_thinking", data: "x" },
          { type: "text", text: "a" },
        ],
      },
    ];
    expect(prepareHistory(history)).toEqual([user("q"), say("a")]);
  });

  it("starts with a user message", () => {
    expect(prepareHistory([say("orphan"), result("t0"), ...turn(1)])).toEqual(turn(1));
    expect(prepareHistory([say("only the assistant")])).toEqual([]);
  });

  it("puts tool results first in their message", () => {
    const mixed: AgentMessage = {
      role: "user",
      content: [
        { type: "text", text: "and also" },
        { type: "tool_result", tool_use_id: "t1", content: "{}" },
      ],
    };
    expect(prepareHistory([user("q"), call("t1"), mixed])[2]?.content).toEqual([
      { type: "tool_result", tool_use_id: "t1", content: "{}" },
      { type: "text", text: "and also" },
    ]);
  });
});

describe("textOf", () => {
  it("joins the text blocks", () => {
    expect(textOf([{ type: "text", text: "a" }, { type: "tool_use", id: "x", name: "y", input: {} }, { type: "text", text: "b" }])).toBe("a\n\nb");
    expect(textOf("plain")).toBe("plain");
  });
});
