import type { Metadata } from "next";
import "./globals.css";
import { AppProvider } from "@/lib/run/AppContext";
import TopBar from "./components/TopBar";
import Footer from "./components/Footer";
import StudyAsk from "./components/StudyAsk";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

const title = "Miva Cliq";
const description =
  "Auto-complete your Miva coursework in minutes, not hours. Plus Miva Gists and Events — an anonymous board where students share news and meetups.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: title, template: "%s · Miva Cliq" },
  description,
  applicationName: title,
  keywords: [
    "Miva",
    "Miva Open University",
    "Moodle",
    "coursework",
    "LMS",
    "auto-complete",
    "Miva Gists",
    "Miva Events",
    "student forum",
  ],
  openGraph: {
    type: "website",
    siteName: title,
    title,
    description,
    url: siteUrl,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

/**
 * The shell lives here rather than in the page so that <AppProvider> stays
 * mounted across navigation — that's what keeps a run alive while the user
 * reads /gists or /how-it-works.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AppProvider>
          <main className="app">
            <div className="bg-orbs" aria-hidden="true">
              <span className="orb orb-a" />
              <span className="orb orb-b" />
              <span className="orb orb-c" />
            </div>

            <TopBar />
            <div className="stage">
              <StudyAsk />
              {children}
            </div>
            <Footer />
          </main>
        </AppProvider>
      </body>
    </html>
  );
}