"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { getExampleNumber, isSupportedCountry, parsePhoneNumberFromString } from "libphonenumber-js";
import type { CountryCode } from "libphonenumber-js";
import examples from "libphonenumber-js/mobile/examples";
import { Field, Input } from "@kitoko/ui";
import type { PayActions } from "./types";

// "Your details" on the deposit page: first name (required) and mobile (optional, normalised to E.164), saved on the
// booking's conversation before PayPal opens, so the capture confirms the booking with them (PayPal fills the e-mail).

/** The pro's country, for numbers typed without their +code: from her time zone, else her currency. */
const ZONES: Record<string, CountryCode> = {
  "Europe/Rome": "IT",
  "Europe/Paris": "FR",
  "Europe/London": "GB",
  "Europe/Madrid": "ES",
  "Europe/Lisbon": "PT",
  "Europe/Brussels": "BE",
  "Europe/Zurich": "CH",
  "Europe/Berlin": "DE",
  "Europe/Amsterdam": "NL",
  "Europe/Dublin": "IE",
  "Europe/Luxembourg": "LU",
};

export function countryOf(timeZone: string | null | undefined, currency: string): CountryCode | undefined {
  const fromZone = timeZone ? ZONES[timeZone] : undefined;
  if (fromZone) return fromZone;
  return currency === "GBP" ? "GB" : undefined;
}

type Phone = { empty: boolean; e164: string | null };

function readPhone(value: string, country: CountryCode | undefined): Phone {
  const raw = value.trim();
  if (!raw) return { empty: true, e164: null };
  const parsed = parsePhoneNumberFromString(raw, country && isSupportedCountry(country) ? country : undefined);
  return { empty: false, e164: parsed?.isValid() ? parsed.number : null };
}

const display = (e164: string | null | undefined): string => (e164 ? (parsePhoneNumberFromString(e164)?.formatInternational() ?? e164) : "");

const keyOf = (firstName: string, phone: string | null) => `${firstName}\n${phone ?? ""}`;

export type ClientDetails = ReturnType<typeof useClientDetails>;

/** The form's state, and `commit()`: saves what changed, resolves false only when a field needs fixing. */
export function useClientDetails({
  bookingId,
  initial,
  country,
  save,
}: {
  bookingId: string;
  initial: { firstName: string | null; phone: string | null } | null | undefined;
  country: CountryCode | undefined;
  save: PayActions["saveClientDetails"];
}) {
  const [firstName, setFirstName] = useState(initial?.firstName ?? "");
  const [phone, setPhone] = useState(() => display(initial?.phone));
  const [touched, setTouched] = useState({ name: false, phone: false });
  const [rejected, setRejected] = useState<"name" | "phone" | null>(null);
  const phoneState = useMemo(() => readPhone(phone, country), [phone, country]);
  // What the server already has: the prefill, then each successful save.
  const saved = useRef<string | null>(initial?.firstName ? keyOf(initial.firstName.trim(), initial.phone ?? null) : null);

  const name = firstName.trim();
  const nameOk = name.length > 0 && name.length <= 80;
  const phoneOk = phoneState.empty || phoneState.e164 !== null;
  const ready = nameOk && phoneOk;

  const commit = useCallback(async (): Promise<boolean> => {
    if (!ready) {
      setTouched({ name: true, phone: true });
      return false;
    }
    const key = keyOf(name, phoneState.e164);
    if (saved.current === key) return true;
    const result = await save(bookingId, { firstName: name, phone: phoneState.e164 }).catch(() => ({ ok: false as const, error: "network" }));
    if (result.ok) {
      saved.current = key;
      setRejected(null);
      return true;
    }
    if (result.error === "invalid_phone" || result.error === "invalid_name") {
      setRejected(result.error === "invalid_phone" ? "phone" : "name");
      return false;
    }
    // Anything else (network, the booking moved on) never blocks the payment: PayPal's payer name is the fallback.
    return true;
  }, [bookingId, name, phoneState.e164, ready, save]);

  return {
    firstName,
    phone,
    setFirstName: (value: string) => {
      setFirstName(value);
      if (rejected === "name") setRejected(null);
    },
    setPhone: (value: string) => {
      setPhone(value);
      if (rejected === "phone") setRejected(null);
    },
    /** Shows a field's error once it was left (or a payment was attempted). */
    touch: (field: "name" | "phone") => setTouched((t) => ({ ...t, [field]: true })),
    nameError: (touched.name && !nameOk) || rejected === "name",
    phoneError: (touched.phone && !phoneOk) || rejected === "phone",
    nameOk,
    ready,
    commit,
    country,
  };
}

export function ClientDetailsFields({ details, proName, disabled }: { details: ClientDetails; proName: string; disabled?: boolean }) {
  const t = useTranslations("pay.details");
  const example = details.country ? getExampleNumber(details.country, examples)?.formatInternational() : undefined;
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-3">
      <legend className="mb-3 text-ui font-semibold">{t("title")}</legend>
      <Field label={t("firstName")} error={details.nameError ? t("firstNameError") : undefined}>
        <Input
          id="pay-first-name"
          name="given-name"
          autoComplete="given-name"
          autoCapitalize="words"
          enterKeyHint="next"
          required
          maxLength={80}
          value={details.firstName}
          onChange={(e) => details.setFirstName(e.target.value)}
          onBlur={() => {
            details.touch("name");
            if (details.ready) void details.commit();
          }}
        />
      </Field>
      <Field
        label={t("phone")}
        hint={t("phoneHint", { pro: proName })}
        error={details.phoneError ? (example ? t("phoneError", { example }) : t("phoneErrorPlain")) : undefined}
      >
        <Input
          id="pay-phone"
          type="tel"
          name="tel"
          inputMode="tel"
          autoComplete="tel"
          enterKeyHint="done"
          maxLength={32}
          placeholder={example}
          value={details.phone}
          onChange={(e) => details.setPhone(e.target.value)}
          onBlur={() => {
            details.touch("phone");
            if (details.ready) void details.commit();
          }}
        />
      </Field>
    </fieldset>
  );
}
