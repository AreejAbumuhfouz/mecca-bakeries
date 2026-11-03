import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isRtl } from '@mecca/shared';
import { AuthProvider } from '@/lib/auth';
import { ThemeProvider, themeInitScript } from '@/lib/theme';
import './globals.css';

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
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
