import type { Metadata } from "next";
import PracticeClient from "./PracticeClient";

export const metadata: Metadata = {
  title: "Practice",
  description: "Five quick questions on one week of your Miva course, with the answer and why after each one.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default function PracticePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const course = one(searchParams.course).toLowerCase();
  const week = Number(one(searchParams.week));
  const valid = /^[a-z]{2,5}\d{3}$/.test(course) && Number.isInteger(week) && week > 0 && week < 100;
  // Keyed so "Next week" starts a fresh screen instead of carrying the last set's state.
  return <PracticeClient key={`${course}-${week}`} course={valid ? course : ""} week={valid ? week : 0} />;
}
