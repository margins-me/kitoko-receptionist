import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { listStaff } from "@kitoko/db";
import { DashboardApp } from "@/components/dashboard/dashboard-app";
import { loadWeek } from "@/components/dashboard/load";
import { addDays, weekStartOf } from "@/components/dashboard/time";
import { fetchProChat } from "./actions";
import { getProSession } from "./session";

export const metadata: Metadata = { title: "Calendar" };

export default async function DashboardPage() {
  const session = await getProSession();
  if (!session) redirect("/dashboard/login");
  const { db, pro } = session;
  const weekStart = weekStartOf(Date.now(), pro.timezone);
  const [staff, week, chat] = await Promise.all([
    listStaff(db, pro.id),
    loadWeek(db, pro.id, weekStart, addDays(weekStart, 7, pro.timezone)),
    fetchProChat().catch(() => []),
  ]);
  return (
    <DashboardApp
      pro={pro}
      staff={staff.map((s) => ({ id: s.id, name: s.name, color: s.color }))}
      initialWeek={week}
      initialChat={chat}
    />
  );
}
