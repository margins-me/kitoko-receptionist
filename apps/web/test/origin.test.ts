import { describe, expect, it } from "vitest";
import { originFromHeaders, trustedOrigin } from "../src/lib/origin";

const headers = (h: Record<string, string>) => ({ get: (name: string) => h[name] ?? null });

describe("trustedOrigin", () => {
  const env = { SITE_URL: "https://receptionist.kitoko.page", VERCEL_URL: "kitoko-receptionist-abc123.vercel.app" };

  it("keeps a local dev server's origin, whatever its port", () => {
    expect(trustedOrigin("http://localhost:3301", env)).toBe("http://localhost:3301");
    expect(trustedOrigin("http://127.0.0.1:4000", env)).toBe("http://127.0.0.1:4000");
    expect(trustedOrigin("http://app.localhost:3300", env)).toBe("http://app.localhost:3300");
  });

  it("keeps SITE_URL's host and this deployment's Vercel hosts over https", () => {
    expect(trustedOrigin("https://receptionist.kitoko.page", env)).toBe("https://receptionist.kitoko.page");
    expect(trustedOrigin("https://kitoko-receptionist-abc123.vercel.app", env)).toBe("https://kitoko-receptionist-abc123.vercel.app");
    expect(trustedOrigin("http://receptionist.kitoko.page", env)).toBeNull();
  });

  it("refuses any other host (a forged Host header) and junk", () => {
    expect(trustedOrigin("https://evil.example", env)).toBeNull();
    expect(trustedOrigin("javascript:alert(1)", env)).toBeNull();
    expect(trustedOrigin("not a url", env)).toBeNull();
    expect(trustedOrigin(null, env)).toBeNull();
  });
});

describe("originFromHeaders", () => {
  it("prefers Origin, then the forwarded host, then Host", () => {
    expect(originFromHeaders(headers({ origin: "http://localhost:3301", host: "localhost:3301" }))).toBe("http://localhost:3301");
    expect(originFromHeaders(headers({ "x-forwarded-host": "a.vercel.app", "x-forwarded-proto": "https", host: "internal" }))).toBe("https://a.vercel.app");
    expect(originFromHeaders(headers({ host: "localhost:3302" }))).toBe("http://localhost:3302");
    expect(originFromHeaders(headers({}))).toBeNull();
  });
});
