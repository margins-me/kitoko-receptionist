import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

/** Adds and strips the language prefix: /aicha.braids is English, /fr/studio-nala French (src/i18n/routing.ts). */
export default createMiddleware(routing);

export const config = {
  // Skipped: the API, the dashboard and the "How it works" page (English only, no prefix), the dev-only fake PayPal
  // approval route (/pay/fake-approve, not a deposit page), Next's own files, the
  // photos and any path ending in a real file extension. Handles may contain dots (/kemi.nails), so only these
  // extensions count. "api/" with its slash, so a handle such as "apinya" still gets a locale.
  matcher:
    "/((?!api/|api$|dashboard/|dashboard$|how-it-works/|how-it-works$|pay/fake-approve|_next|_vercel|photos/|.*\\.(?:ico|png|jpe?g|gif|webp|avif|svg|json|webmanifest|txt|xml|ics|css|js|map|woff2?)$).*)",
};
