import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

/**
 * Shared 1200×630 social card renderer, used by the root image and every
 * per-page opengraph-image. next/og can't read globals.css, so the palette is
 * inlined — these mirror :root in app/globals.css; keep them in sync.
 */
const BG = "#0a0b14";
const VIOLET = "#8b5cf6";
const INDIGO = "#6366f1";
const TEAL = "#2dd4bf";
const TEXT = "#eef0fb";
const TEXT_DIM = "#a6abce";
const GRAD = `linear-gradient(120deg, ${VIOLET} 0%, ${INDIGO} 48%, ${TEAL} 100%)`;

export function ogImage(opts: {
  /** Small uppercase label above the heading, e.g. "MIVA GISTS". */
  kicker?: string;
  heading: string;
  sub?: string;
  emoji?: string;
}): ImageResponse {
  const { kicker, heading, sub, emoji = "⚡" } = opts;
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
              background: GRAD,
              fontSize: 52,
            }}
          >
            {emoji}
          </div>
          <div
            style={{
              fontSize: 40,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: TEXT_DIM,
            }}
          >
            Miva Cliq
          </div>
        </div>

        {kicker ? (
          <div
            style={{
              marginTop: 40,
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: "0.14em",
              color: TEAL,
            }}
          >
            {kicker}
          </div>
        ) : null}

        <div
          style={{
            marginTop: kicker ? 8 : 32,
            fontSize: 68,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            color: TEXT,
            lineHeight: 1.05,
            // Long gist/event text must not overflow the card.
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {heading}
        </div>

        {sub ? (
          <div
            style={{
              marginTop: 20,
              fontSize: 28,
              color: TEXT_DIM,
              maxWidth: 960,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {sub}
          </div>
        ) : null}

        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 10,
            background: GRAD,
          }}
        />
      </div>
    ),
    OG_SIZE,
  );
}