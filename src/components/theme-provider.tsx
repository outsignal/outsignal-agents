"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children, forcedTheme }: { children: React.ReactNode; forcedTheme?: string }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem={true}
      storageKey="outsignal-theme"
      forcedTheme={forcedTheme}
    >
      {children}
    </NextThemesProvider>
  );
}
