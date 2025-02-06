import { Analytics } from "@vercel/analytics/react";
import { GeistSans } from 'geist/font/sans';
import 'katex/dist/katex.min.css';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Metadata, Viewport } from "next";
import { Instrument_Serif, Syne } from 'next/font/google';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { Toaster } from "sonner";
import "./globals.css";
import { Providers } from './providers';
import { WelcomePopup } from './components/welcome-popup';
import { SupportMailButton } from './components/support-mail-button';

export const metadata: Metadata = {
  metadataBase: new URL("https://mojo.sixtyoneeightyai.com"),
  title: "Mojo - AI-Powered Search Engine",
  description: "Mojo is a minimalistic AI-powered search engine that helps you find information on the internet using natural language processing and advanced AI technology.",
  manifest: "/manifest.json",
  themeColor: "#000000",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Mojo",
    startupImage: [
      {
        url: "/splash/launch-1242x2688.png",
        media: "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)"
      }
    ]
  },
  openGraph: {
    type: "website",
    url: "https://mojo.sixtyoneeightyai.com",
    siteName: "Mojo",
    title: "Mojo - Intelligent Search Made Simple",
    description: "Experience a new way of searching the internet with Mojo's AI-powered search engine. Get more relevant results using natural language.",
    images: [
      {
        url: "/images/og-image.png",
        width: 1200,
        height: 630,
        alt: "Mojo Search Engine"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "Mojo - AI-Powered Search Engine",
    description: "Experience intelligent search with Mojo's AI technology. Get better results using natural language.",
    images: ["/images/twitter-image.png"],
    creator: "@sixtyoneeightyai"
  },
  keywords: [
    "Mojo",
    "Mojo.app",
    "Mojo ai app",
    "Mojo AI",
    "AI Search Engine",
    "search engine",
    "AI",
    "ai search engine",
    "natural language search",
    "intelligent search",
    "semantic search"
  ],
  authors: [{ name: "SixtyOneEighty AI" }],
  creator: "SixtyOneEighty AI",
  publisher: "SixtyOneEighty AI"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
}

const syne = Syne({ 
  subsets: ['latin'], 
  variable: '--font-syne',
   preload: true,
  display: 'swap',
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${GeistSans.variable} ${syne.variable} font-sans antialiased`}>
        <NuqsAdapter>
          <Providers>
            <Toaster position="top-center" richColors />
            <WelcomePopup />
            {children}
            <SupportMailButton />
          </Providers>
        </NuqsAdapter>
        <Analytics />
      </body>
    </html>
  );
}
