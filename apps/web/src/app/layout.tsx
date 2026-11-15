import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { QueryProvider } from '@/providers/query-provider';
import './globals.css';
import { Geist, Geist_Mono, Oswald } from 'next/font/google';
import { cn } from '@/lib/utils';

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-sans',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

const oswaldHeading = Oswald({
  subsets: ['latin', 'vietnamese'],
  weight: ['500', '600', '700'],
  variable: '--font-heading',
});

export const metadata: Metadata = {
  title: 'Aura Gym — Hệ thống Quản lý Phòng tập',
  description:
    'Nền tảng quản lý hội viên, lịch tập và vận hành phòng tập Aura Gym',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="vi"
      className={cn(
        'dark font-sans antialiased',
        geistSans.variable,
        geistMono.variable,
        oswaldHeading.variable,
      )}
    >
      <body className="min-h-screen bg-background text-foreground">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
