import { expect, it } from "vitest";
import { createRateLimiter } from "../src/rate-limit";

it("allows max hits per window and key", () => {
  let t = 0;
  const limiter = createRateLimiter({ max: 2, windowMs: 1000, now: () => t });
  expect(limiter.take("a")).toBe(true);
  expect(limiter.take("a")).toBe(true);
  expect(limiter.take("a")).toBe(false);
  expect(limiter.take("b")).toBe(true);
  t = 1001;
  expect(limiter.take("a")).toBe(true);
});
