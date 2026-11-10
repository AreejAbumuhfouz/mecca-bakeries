import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isRtl } from '@mecca/shared';
import { AuthProvider } from '@/lib/auth';
import { ThemeProvider, themeInitScript } from '@/lib/theme';
import { localeInitScript } from '@/lib/i18n';
import { LocaleGate } from '@/components/locale-gate';
import { ToastProvider } from '@/components/toast';
import './globals.css';

// Server metadata stays Arabic; the dashboard sets the tab title per page in the browser.
export const metadata: Metadata = {
  title: 'مخابز مكة — لوحة التحكم',
  description: 'نظام إدارة الطلبات والإنتاج والتوزيع',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang={DEFAULT_LOCALE}
      dir={isRtl(DEFAULT_LOCALE) ? 'rtl' : 'ltr'}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript + localeInitScript }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <ThemeProvider>
          <LocaleGate>
            <ToastProvider>
              <AuthProvider>{children}</AuthProvider>
            </ToastProvider>
          </LocaleGate>
        </ThemeProvider>
      </body>
    </html>
  );
}
