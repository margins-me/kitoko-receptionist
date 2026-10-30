import { sendButtons, sendText } from "./whatsapp/send";
import type { ReplyButton } from "./whatsapp/render";
import type { SendDeps } from "./whatsapp/send";

export type Channel = "web" | "whatsapp" | "mcp";

export type DeliverResult =
  | { ok: true; providerId: string | null; text?: string }
  | { ok: false; error: string; retryable: boolean };

/**
 * Sends an agent reply on the conversation's channel. Web and MCP replies are already stored as conversation_messages
 * rows (the chat polls them, the MCP tool returns them), so there is nothing to send. WhatsApp sends the text, with
 * reply buttons when given.
 */
export async function deliver(
  msg: { channel: Channel; to: string; text: string; buttons?: readonly ReplyButton[] },
  deps?: SendDeps,
): Promise<DeliverResult> {
  switch (msg.channel) {
    case "web":
    case "mcp":
      return { ok: true, providerId: null };
    case "whatsapp": {
      const text = whatsappText(msg.text);
      return msg.buttons?.length ? sendButtons({ to: msg.to, text, buttons: msg.buttons }, deps) : sendText({ to: msg.to, text }, deps);
    }
  }
}

/** Markdown a model may still write, in WhatsApp's own formatting: **bold** → *bold*, [label](url) → label: url. */
export function whatsappText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label: string, url: string) => (label === url ? url : `${label}: ${url}`))
    .trim();
}
