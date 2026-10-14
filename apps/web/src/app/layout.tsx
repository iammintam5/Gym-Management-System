import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { QueryProvider } from '@/providers/query-provider';
import { SiteHeader } from '@/components/layout/site-header';
import './globals.css';
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'Gym Management',
  description: 'Nền tảng quản lý phòng tập',
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" className={cn("font-sans", geist.variable)}>
      <body>
        <QueryProvider>
          <SiteHeader />
          <main className="mx-auto max-w-5xl px-6 py-12">{children}</main>
        </QueryProvider>
      </body>
    </html>
  );
}
