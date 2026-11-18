import { NextResponse } from "next/server";
import { PRESETS } from "@/lib/presets";

export const runtime = "nodejs";

export async function GET() {
  // The client's Preset type reads `subtitle` (lib/run/types.ts).
  return NextResponse.json({
    presets: PRESETS.map((p) => ({ ...p, subtitle: p.semester })),
  });
}
