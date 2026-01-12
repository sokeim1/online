import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

function getMetadataBase(): URL {
  const rawCandidates = [
    process.env.SITE_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
    process.env.URL,
    "http://localhost:3000",
  ];

  for (const raw of rawCandidates) {
    const s = (raw ?? "").trim();
    if (!s) continue;
    try {
      const url = new URL(s);
      const host = url.hostname;
      if (
        host &&
        !host.startsWith("www.") &&
        !host.startsWith("localhost") &&
        !host.startsWith("127.0.0.1") &&
        !host.endsWith(".vercel.app")
      ) {
        url.hostname = `www.${host}`;
      }
      return url;
    } catch {
    }
  }

  return new URL("http://localhost:3000");
}

export const metadata: Metadata = {
  metadataBase: getMetadataBase(),
  title: "Doramy Online - Смотри бесплатно дорамы и сериалы",
  description: "Смотри бесплатно дорамы и сериалы онлайн на Doramy Online",
  applicationName: "Doramy Online",
  manifest: "/manifest.webmanifest",
  keywords: [
    "дорамы онлайн",
    "doramy online",
    "смотреть видео онлайн",
    "смотреть сериалы онлайн",
    "корейские дорамы",
    "азиатские сериалы",
    "Vibix",
  ],
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: ["/favicon.ico"],
    apple: ["/icon.svg"],
  },
  openGraph: {
    siteName: "Doramy Online",
    type: "website",
    title: "Doramy Online - Смотри бесплатно дорамы и сериалы",
    description: "Смотри бесплатно дорамы и сериалы онлайн на Doramy Online",
    url: "/",
    images: [{ url: "/icon.svg" }],
  },
  twitter: {
    card: "summary",
    title: "Doramy Online - Смотри бесплатно дорамы и сериалы",
    description: "Смотри бесплатно дорамы и сериалы онлайн на Doramy Online",
    images: ["/icon.svg"],
  },
};

export const viewport: Viewport = {
  themeColor: "#2ee58a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" data-theme="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Script id="theme-init" strategy="beforeInteractive">
          {"(function(){function a(){try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t;}}catch(e){}}a();try{window.addEventListener('pageshow',a);}catch(e){}})();"}
        </Script>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
