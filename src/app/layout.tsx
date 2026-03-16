import type { Metadata } from "next";
import { Inter, Montserrat } from "next/font/google";
import { Toaster } from "sonner";
import { CsrfProvider } from "@/components/csrf-provider";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["800"],
});

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
    <html lang="en">
      <body className={`${inter.variable} ${montserrat.variable} font-sans antialiased`}>
        <CsrfProvider>
          {children}
        </CsrfProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
