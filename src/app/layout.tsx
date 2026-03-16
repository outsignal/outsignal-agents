import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import { CsrfProvider } from "@/components/csrf-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Outsignal",
  description: "Outbound that compounds",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.svg" }],
  },
  manifest: "/manifest.json",
  themeColor: "#635BFF",
  openGraph: {
    title: "Outsignal",
    description: "Outbound that compounds",
    url: "https://admin.outsignal.ai",
    siteName: "Outsignal",
    images: [
      { url: "/og-image.svg", width: 1200, height: 630, alt: "Outsignal" },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Outsignal",
    description: "Outbound that compounds",
    images: ["/og-image.svg"],
  },
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
