import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { asLocale, localePath } from "@/i18n/locale";

// Most 404s here are an unknown /<handle>: the copy speaks to a client who followed a link.
export default async function NotFound() {
  const t = await getTranslations("common");
  const locale = asLocale(await getLocale());
  return (
    <main className="flex min-h-dvh flex-col justify-center gap-5 bg-stone px-4 py-16 text-ink">
      <div className="mx-auto flex w-full max-w-page flex-col gap-5">
        <p className="text-ui font-medium text-muted">404</p>
        <h1 className="max-w-[14em] text-[34px] leading-tight font-bold tracking-hero">{t("notFound.title")}</h1>
        <p className="max-w-[29em] text-body">{t("notFound.body")}</p>
        <Link
          href={localePath("/", locale)}
          className="inline-flex min-h-12 items-center self-start rounded-full bg-ink px-6 text-ui font-semibold text-on-inverse no-underline"
        >
          {t("crash.home")}
        </Link>
      </div>
    </main>
  );
}
