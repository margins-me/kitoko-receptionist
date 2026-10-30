import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { asLocale } from "@/i18n/locale";
import { TIME_ZONE } from "@/i18n/time-zone";
import { Chat } from "./chat";
import type { ChatAvatar, ChatService } from "./chat";

// Contract with the pro page (src/components/pro-page/pro-page-view.tsx):
// - it renders the mobile bar's button, styled with `className`;
// - the page's other booking links (desktop card, service rows) are <a data-booking href="…#chat">, with
//   ?service=<id> on a service row: clicking one opens the chat (with that service) instead of following the link.
// The chat is a client island: only its own messages (chat.json) go to the browser.

export type ChatLauncherProps = {
  handle: string;
  locale: string;
  /** "Chat to book", in the page's language. */
  label: string;
  className?: string;
  /** Shown in the chat's header. Defaults to the handle. */
  proName?: string;
  avatar?: ChatAvatar | null;
  /** Her services in the page's language: a service row's link prefills "I'd like <name>". */
  services?: ChatService[];
};

export async function ChatLauncher({ handle, locale, label, className, proName, avatar = null, services = [] }: ChatLauncherProps) {
  const lang = asLocale(locale);
  const messages = await getMessages({ locale: lang });
  return (
    <NextIntlClientProvider locale={lang} timeZone={TIME_ZONE} messages={{ chat: messages.chat ?? {} }}>
      <Chat handle={handle} locale={lang} label={label} className={className} proName={proName ?? handle} avatar={avatar} services={services} />
    </NextIntlClientProvider>
  );
}
