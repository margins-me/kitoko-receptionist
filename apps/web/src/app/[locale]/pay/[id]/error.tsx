"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { buttonStyles, cn } from "@kitoko/ui";

export default function PayError({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations("pay.error");
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-140 flex-col justify-center gap-4 px-4 py-12">
      <h1 className="text-page-title font-semibold">{t("title")}</h1>
      <p className="text-ui text-body">{t("body")}</p>
      <button type="button" onClick={() => retry()} className={cn(buttonStyles(), "self-start rounded-full")}>
        {t("retry")}
      </button>
    </main>
  );
}
