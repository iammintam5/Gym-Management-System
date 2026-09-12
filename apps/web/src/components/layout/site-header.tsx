import Link from 'next/link';
export function SiteHeader() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <nav
        aria-label="Điều hướng chính"
        className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-5"
      >
        <Link href="/" className="font-bold tracking-tight">
          GYM / MANAGEMENT
        </Link>
        <div className="flex gap-5 text-sm">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/login">Đăng nhập</Link>
        </div>
      </nav>
    </header>
  );
}
