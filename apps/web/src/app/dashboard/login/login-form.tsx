"use client";

import { useActionState, useRef } from "react";
import { signIn } from "../actions";
import type { LoginState } from "../actions";

// The judges' logins, published in the README (fictional pros, sandbox money only).
const DEMO_PASSWORD = "kitoko-demo-2026";
const DEMOS = [
  { email: "aicha@demo.kitoko.page", name: "Aïcha Braids", place: "Milan · EUR · 1 chair" },
  { email: "nala@demo.kitoko.page", name: "Studio Nala", place: "Lyon · EUR · 2 staff" },
  { email: "kemi@demo.kitoko.page", name: "Kemi Nails", place: "London · GBP · 1 chair" },
];

const field =
  "min-h-12 w-full rounded-input border border-outline bg-surface px-4 text-ui text-ink outline-none placeholder:text-placeholder focus-visible:border-ink";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, { error: null, email: "" });
  const form = useRef<HTMLFormElement>(null);

  const signInAs = (email: string) => {
    const el = form.current;
    if (!el) return;
    (el.elements.namedItem("email") as HTMLInputElement).value = email;
    (el.elements.namedItem("password") as HTMLInputElement).value = DEMO_PASSWORD;
    el.requestSubmit();
  };

  return (
    <>
      <form ref={form} action={action} className="flex flex-col gap-3 rounded-card bg-surface p-6 shadow-raise">
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-semibold">E-mail</span>
          <input name="email" type="email" autoComplete="username" required defaultValue={state.email} className={field} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-semibold">Password</span>
          <input name="password" type="password" autoComplete="current-password" required className={field} />
        </label>
        {state.error && (
          <p role="alert" className="rounded-input bg-error-bg px-3 py-2 text-caption font-medium text-error">
            {state.error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="mt-1 inline-flex min-h-12 items-center justify-center rounded-full bg-ink px-5 text-ui font-semibold text-on-inverse transition-opacity disabled:opacity-60"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <section aria-labelledby="demo-logins" className="flex flex-col gap-3 rounded-card border border-stone-line bg-stone p-5">
        <div className="flex flex-col gap-0.5">
          <h2 id="demo-logins" className="text-ui font-semibold">
            Demo logins
          </h2>
          <p className="text-caption text-muted">
            Password for all three: <code className="font-semibold text-ink">{DEMO_PASSWORD}</code>
          </p>
        </div>
        <ul className="flex flex-col gap-2">
          {DEMOS.map((demo) => (
            <li key={demo.email} className="flex items-center justify-between gap-3 rounded-input bg-surface px-3.5 py-2.5">
              <div className="flex min-w-0 flex-col">
                <span className="text-ui font-semibold">{demo.name}</span>
                <span className="truncate text-caption text-muted">
                  {demo.email} · {demo.place}
                </span>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => signInAs(demo.email)}
                className="min-h-10 shrink-0 rounded-full border border-outline px-4 text-caption font-semibold hover:border-ink disabled:opacity-60"
              >
                Use
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
