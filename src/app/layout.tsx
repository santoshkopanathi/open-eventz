import type { Metadata } from "next";
import { Instrument_Serif, DM_Sans, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { SITE_URL } from "@/lib/site";
import ConsentBanner from "@/components/ConsentBanner";

// Public GA4 Measurement ID (client-side by design). When unset, no tag is rendered and
// analytics helpers no-op, so local/dev without the var behaves normally.
const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

// Weekend Paper type system: Instrument Serif (display), DM Sans (UI/body), JetBrains Mono (meta).
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400", // Instrument Serif ships a single weight
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Open Eventz — Free Kids Activities in Plano & Frisco",
    template: "%s | Open Eventz",
  },
  description: "Discover free and low-cost events for kids in Plano and Frisco, TX — libraries, parks, and more in one place.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${instrumentSerif.variable} ${dmSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {GA_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga-init" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
// Consent Mode v2: default to denied until the user accepts (ConsentBanner grants it).
gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
  wait_for_update: 500
});
gtag('js', new Date());
gtag('config', '${GA_ID}');`}
            </Script>
          </>
        )}
        {GA_ID && <ConsentBanner />}
      </body>
    </html>
  );
}
