import "server-only";
import { headers } from "next/headers";
import { after } from "next/server";
import { createServicesCtx } from "@kitoko/agent/services";
import type { ServicesCtx } from "@kitoko/agent/services";
import { originFromHeaders, trustedOrigin } from "./origin";

let shared: ServicesCtx | undefined;

/** The process-wide services context (service-role db, PayPal client, models), built once from the environment. */
export function getServicesCtx(): ServicesCtx {
  shared ??= createServicesCtx(process.env);
  return shared;
}

/**
 * The same context for one request, whose follow-up work (the agent's message after a capture, a sick-day cascade)
 * runs after the response with Next's `after()`. Use it in route handlers and server actions.
 *
 * `origin`: the request's origin (route handlers: `request.nextUrl.origin`). When trusted (lib/origin.ts), pay links
 * and PayPal return/cancel URLs are built from it instead of SITE_URL, so a dev server on another port keeps the buyer
 * on itself. WhatsApp, MCP, webhooks and the cron keep SITE_URL.
 */
export function requestServicesCtx(origin?: string | null): ServicesCtx {
  const base = getServicesCtx();
  const siteUrl = trustedOrigin(origin, process.env) ?? base.siteUrl;
  return {
    ...base,
    siteUrl,
    defer: async (task) => {
      const run = async () => {
        try {
          await task();
        } catch (e) {
          console.error("[services] deferred task failed", e);
        }
      };
      try {
        after(run);
      } catch {
        // Outside a request scope (a script): run it now.
        await run();
      }
    },
  };
}

/** requestServicesCtx for a server action: the origin comes from the request headers. */
export async function actionServicesCtx(): Promise<ServicesCtx> {
  let origin: string | null = null;
  try {
    origin = originFromHeaders(await headers());
  } catch {
    // Outside a request (a script): SITE_URL.
  }
  return requestServicesCtx(origin);
}
