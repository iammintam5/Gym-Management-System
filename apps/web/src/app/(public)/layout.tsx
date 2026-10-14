import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/layout/site-header';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="dark min-h-screen bg-[#09090B] text-zinc-50 selection:bg-[#FF5500] selection:text-white">
      <SiteHeader />
      <main>{children}</main>
    </div>
  );
}
