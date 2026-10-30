import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getProSession } from "../session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getProSession()) redirect("/dashboard");
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-[420px] flex-col gap-6">
        <div className="flex flex-col gap-2">
          <a href="/" className="text-caption font-semibold tracking-wide text-muted uppercase no-underline">
            Kitoko · AI front desk
          </a>
          <h1 className="text-[34px] leading-tight font-bold tracking-hero">Pro dashboard</h1>
          <p className="text-body">Her live calendar, deposits and assistant. Sign in as one of the demo pros.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
