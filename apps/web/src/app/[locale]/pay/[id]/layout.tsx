import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { asLocale } from "@/i18n/locale";
import { TIME_ZONE } from "@/i18n/time-zone";

// The deposit page's client parts (the page, its loading and error states) read pay.json, and only that.
export default async function PayLayout({ children, params }: LayoutProps<"/[locale]/pay/[id]">) {
  const locale = asLocale((await params).locale);
  const messages = await getMessages({ locale });
  return (
    <NextIntlClientProvider locale={locale} timeZone={TIME_ZONE} messages={{ pay: messages.pay ?? {} }}>
      <div className="min-h-dvh bg-ground text-ink">{children}</div>
    </NextIntlClientProvider>
  );
}
