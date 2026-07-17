import { NextResponse } from "next/server";
import { readMetrics } from "@/lib/store/metrics";

export const runtime = "nodejs";
// The footer metric is decorative — a minute of staleness is free, and it keeps
// every page load from hitting Redis.
export const revalidate = 60;

export async function GET() {
  const metrics = await readMetrics();
  return NextResponse.json(metrics, {
    headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
}