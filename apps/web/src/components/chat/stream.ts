// The web chat's wire format (docs/architecture.md, "HTTP routes"): POST /api/chat answers NDJSON, one event per line.

export type ChatEvent =
  | { type: "token"; token: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; status: "start" | "done" | "error" }
  /** Tap-to-reply options for the reply being streamed. */
  | { type: "choices"; choices: string[] }
  | { type: "done" };

/** A visible message, as GET /api/chat returns it. */
export type ServerMessage = { id: string; role: "user" | "assistant"; text: string; createdAt: string; choices?: string[] };

function parse(line: string): ChatEvent | null {
  try {
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== "object" || !("type" in value)) return null;
    const event = value as Record<string, unknown>;
    switch (event.type) {
      case "token":
        return typeof event.token === "string" ? { type: "token", token: event.token } : null;
      case "text":
        return typeof event.delta === "string" ? { type: "text", delta: event.delta } : null;
      case "tool":
        return typeof event.name === "string" && (event.status === "start" || event.status === "done" || event.status === "error")
          ? { type: "tool", name: event.name, status: event.status }
          : null;
      case "choices":
        return Array.isArray(event.choices) ? { type: "choices", choices: event.choices.filter((c): c is string => typeof c === "string") } : null;
      case "done":
        return { type: "done" };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** The events of an NDJSON body, as they arrive. A line that is not a known event is skipped. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      const event = line ? parse(line) : null;
      if (event) yield event;
      newline = buffer.indexOf("\n");
    }
    if (done) break;
  }
  const last = buffer.trim();
  const event = last ? parse(last) : null;
  if (event) yield event;
}

/** GET /api/chat's messages, or null when the answer is not that shape. */
export function parseHistory(value: unknown): ServerMessage[] | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as { messages?: unknown }).messages)) return null;
  return (value as { messages: unknown[] }).messages.flatMap((m) => {
    if (!m || typeof m !== "object") return [];
    const { id, role, text, createdAt, choices } = m as Record<string, unknown>;
    if (typeof id !== "string" || (role !== "user" && role !== "assistant") || typeof text !== "string" || typeof createdAt !== "string") return [];
    const options = Array.isArray(choices) ? choices.filter((c): c is string => typeof c === "string") : [];
    return [{ id, role, text, createdAt, ...(options.length ? { choices: options } : {}) }];
  });
}
