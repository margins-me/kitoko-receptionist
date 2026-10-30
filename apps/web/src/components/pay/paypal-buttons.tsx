"use client";

import { useEffect, useRef, useState } from "react";
import { loadCoreSdkScript } from "@paypal/paypal-js/sdk-v6";
import type { OneTimePaymentSession, PayLaterCountryCodes, PayLaterProductCodes } from "@paypal/paypal-js/sdk-v6";
import { cn } from "@kitoko/ui";
import { intlTag } from "@/i18n/locale";

// PayPal JS SDK v6 (packages/paypal/V6.md): the core script, an instance on the client id, eligibility for the
// currency, then the official <paypal-button> and, when eligible, <paypal-pay-later-button>. Each button starts its
// own one-time payment session on click with the order promise (never awaited before start(): that would lose the
// click's activation and the popup would be blocked).

export type PayPalButtonsProps = {
  clientId: string;
  currency: string;
  locale: string;
  /** Our server's order for this booking (amounts from the booking row). */
  createOrder: () => Promise<{ orderId: string }>;
  onApprove: (orderId: string) => Promise<void>;
  onCancel: () => void;
  onError: (code: string | null) => void;
  /** While capturing: the buttons stay in place (no jump) but cannot be pressed. */
  busy: boolean;
  /** Until her details are valid: shown dimmed, cannot be pressed. */
  disabled?: boolean;
  /** Called once when the SDK could not load or nothing is eligible. */
  onUnavailable: () => void;
  loadingLabel: string;
};

type Status = "loading" | "ready" | "failed";

export function PayPalButtons(props: PayPalButtonsProps) {
  const { clientId, currency, locale, busy, disabled } = props;
  const [status, setStatus] = useState<Status>("loading");
  const paypalSlot = useRef<HTMLDivElement>(null);
  const payLaterSlot = useRef<HTMLDivElement>(null);
  // The latest callbacks, read by the sessions created once.
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    let cancelled = false;
    const cleanups: (() => void)[] = [];

    const options = {
      onApprove: async ({ orderId }: { orderId: string }) => latest.current.onApprove(orderId),
      onCancel: () => latest.current.onCancel(),
      onError: (error: { code?: string }) => latest.current.onError(error?.code ?? null),
    };

    /** Puts a button in its slot and starts its session on click. */
    function mount<K extends "paypal-button" | "paypal-pay-later-button">(
      slot: HTMLDivElement | null,
      tag: K,
      setup: (el: HTMLElementTagNameMap[K]) => void,
      session: OneTimePaymentSession,
    ) {
      if (!slot) return;
      const el = document.createElement(tag);
      setup(el);
      el.className = "block w-full";
      const onClick = () => {
        if (latest.current.busy || latest.current.disabled) return;
        void session.start({ presentationMode: "auto" }, latest.current.createOrder()).catch((error: { code?: string }) => {
          latest.current.onError(error?.code ?? null);
        });
      };
      el.addEventListener("click", onClick);
      slot.replaceChildren(el);
      cleanups.push(() => {
        el.removeEventListener("click", onClick);
        el.remove();
      });
    }

    (async () => {
      try {
        const paypal = await loadCoreSdkScript({ environment: "sandbox" });
        if (!paypal || cancelled) return;
        const sdk = await paypal.createInstance({
          clientId,
          components: ["paypal-payments"],
          pageType: "checkout",
          locale: intlTag(locale),
        });
        const methods = await sdk.findEligibleMethods({ currencyCode: currency });
        if (cancelled) return;
        let shown = 0;
        if (methods.isEligible("paypal")) {
          mount(paypalSlot.current, "paypal-button", (el) => (el.type = "pay"), sdk.createPayPalOneTimePaymentSession(options));
          shown++;
        }
        if (methods.isEligible("paylater")) {
          const details = methods.getDetails("paylater") as { countryCode?: string; productCode?: string } | undefined;
          mount(
            payLaterSlot.current,
            "paypal-pay-later-button",
            (el) => {
              if (details?.countryCode) el.countryCode = details.countryCode as PayLaterCountryCodes;
              if (details?.productCode) el.productCode = details.productCode as PayLaterProductCodes;
            },
            sdk.createPayLaterOneTimePaymentSession(options),
          );
          shown++;
        }
        if (shown === 0) throw new Error("no eligible method");
        setStatus("ready");
      } catch {
        if (cancelled) return;
        setStatus("failed");
        latest.current.onUnavailable();
      }
    })();

    return () => {
      cancelled = true;
      for (const cleanup of cleanups) cleanup();
    };
  }, [clientId, currency, locale]);

  if (status === "failed") return null;
  return (
    // Fixed height for two buttons: the placeholders, the buttons and the busy state all fill the same box.
    <div className="relative min-h-29" aria-busy={status === "loading" || busy} aria-disabled={disabled || undefined}>
      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col gap-3" role="status">
          <span className="sr-only">{props.loadingLabel}</span>
          <span aria-hidden className="h-12 animate-pulse rounded-full bg-soft" />
          <span aria-hidden className="h-12 animate-pulse rounded-full bg-soft" />
        </div>
      )}
      <div className={cn("flex flex-col gap-3 transition-opacity", status !== "ready" && "invisible", (busy || disabled) && "pointer-events-none opacity-40")}>
        <div ref={paypalSlot} />
        <div ref={payLaterSlot} />
      </div>
    </div>
  );
}
