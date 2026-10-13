import React, { useEffect } from 'react';
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes';

function ThemeSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const active = resolvedTheme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', active);
    if (active === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
  }, [resolvedTheme]);

  return null;
}

export interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      storageKey="zafira-theme"
    >
      <ThemeSync />
      {children}
    </NextThemesProvider>
  );
}
