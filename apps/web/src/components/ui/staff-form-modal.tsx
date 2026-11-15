'use client';

import { useId, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { ModalFrame } from '@/components/ui/modal-frame';

export function StaffFormModal({
  title,
  subtitle,
  busy,
  onClose,
  onSubmit,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const headingId = useId();
  return (
    <ModalFrame
      onClose={() => {
        if (!busy) onClose();
      }}
      labelledBy={headingId}
      maxWidthClassName="max-w-lg"
    >
      <div className="flex max-h-[90dvh] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#141418] shadow-xl">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <h2 id={headingId} className="text-lg font-semibold text-white">
              {title}
            </h2>
            <p className="mt-1 break-words text-sm text-zinc-500">{subtitle}</p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="Đóng"
            className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-white disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <form
          onSubmit={onSubmit}
          aria-busy={busy}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 overflow-y-auto px-5 py-5">
            <fieldset disabled={busy} className="min-w-0 space-y-4">
              {children}
            </fieldset>
          </div>
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-white/10 px-5 py-4">
            {footer}
          </footer>
        </form>
      </div>
    </ModalFrame>
  );
}
