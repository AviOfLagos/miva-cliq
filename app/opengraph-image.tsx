import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "Miva Cliq — Your coursework, on autopilot.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * next/og can't read globals.css, so the palette is inlined here. These values
 * mirror :root in app/globals.css — keep them in sync if the brand changes.
 */
const BG = "#0a0b14";
const VIOLET = "#8b5cf6";
const INDIGO = "#6366f1";
const TEAL = "#2dd4bf";
const TEXT = "#eef0fb";
const TEXT_DIM = "#a6abce";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: BG,
          padding: "0 88px",
          position: "relative",
        }}
      >
        {/* Brand orbs, echoing the app's background */}
        <div
          style={{
            position: "absolute",
            top: -160,
            right: -120,
            width: 560,
            height: 560,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${VIOLET}88, ${BG}00 70%)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -200,
            left: -140,
            width: 520,
            height: 520,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${TEAL}66, ${BG}00 70%)`,
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 92,
              height: 92,
              borderRadius: 26,
              background: `linear-gradient(120deg, ${VIOLET} 0%, ${INDIGO} 48%, ${TEAL} 100%)`,
              fontSize: 52,
            }}
          >
            ⚡
          </div>
          <div
            style={{
              fontSize: 76,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              color: TEXT,
            }}
          >
            Miva Cliq
          </div>
        </div>

        <div
          style={{
            marginTop: 28,
            fontSize: 44,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: TEXT,
          }}
        >
          Your coursework, on autopilot.
        </div>

        <div
          style={{
            marginTop: 16,
            fontSize: 28,
            color: TEXT_DIM,
            maxWidth: 900,
          }}
        >
          Auto-complete your Miva coursework in minutes, not hours. Graded tests
          are never touched.
        </div>

        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 10,
            background: `linear-gradient(120deg, ${VIOLET} 0%, ${INDIGO} 48%, ${TEAL} 100%)`,
          }}
        />
      </div>
    ),
    size,
  );
}