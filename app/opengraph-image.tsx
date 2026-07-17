import { ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const runtime = "nodejs";
export const alt = "Miva Cliq — Your coursework, on autopilot.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OpengraphImage() {
  return ogImage({
    heading: "Your coursework, on autopilot.",
    sub: "Auto-complete your Miva coursework in minutes, not hours — plus Miva Gists & Events, an anonymous board for students. Graded tests are never touched.",
  });
}