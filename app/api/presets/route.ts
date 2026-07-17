import { NextResponse } from "next/server";
import { PRESETS } from "@/lib/presets";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ presets: PRESETS });
}
