import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import { CsrfProvider } from "@/components/csrf-provider";
import "./globals.css";

const baseMetadata = {
  title: "Outsignal",
  description: "Outbound that compounds",
} as const;

function safeOrigin(host: string | null, proto: string | null): string {
  const fallback = "https://admin.outsignal.ai";
  if (!host || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) return fallback;
  const protocol = proto === "http" ? "http" : "https";
  return `${protocol}://${host}`;
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const origin = safeOrigin(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    requestHeaders.get("x-forwarded-proto"),
  );

  return {
    ...baseMetadata,
    metadataBase: new URL(origin),
    icons: {
      icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
      apple: [{ url: "/apple-touch-icon.svg" }],
    },
    manifest: "/manifest.json",
    themeColor: "#635BFF",
    openGraph: {
      ...baseMetadata,
      url: origin,
      siteName: "Outsignal",
      images: [
        { url: `${origin}/og-image.svg`, width: 1200, height: 630, alt: "Outsignal" },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      ...baseMetadata,
      images: [`${origin}/og-image.svg`],
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#635BFF",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}>
        <CsrfProvider>
          {children}
        </CsrfProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
