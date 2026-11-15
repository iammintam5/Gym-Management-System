'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

let modalLockCount = 0;
let originalBodyOverflow = '';

/** Native modal behavior shared by form dialogs and existing task-specific forms. */
export function ModalFrame({
  open = true,
  placement = 'center',
  onClose,
  label,
  labelledBy,
  describedBy,
  maxWidthClassName = 'max-w-lg',
  className,
  children,
}: {
  open?: boolean;
  placement?: 'center' | 'right';
  onClose: () => void;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  maxWidthClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const previouslyFocused = document.activeElement;
    dialog.showModal();
    if (modalLockCount === 0)
      originalBodyOverflow = document.body.style.overflow;
    modalLockCount += 1;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      modalLockCount = Math.max(0, modalLockCount - 1);
      if (modalLockCount === 0)
        document.body.style.overflow = originalBodyOverflow;
      if (
        previouslyFocused instanceof HTMLElement &&
        previouslyFocused.isConnected
      )
        previouslyFocused.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onClick={(event) => {
        if (placement === 'right' && event.target === event.currentTarget)
          onClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className={cn(
        'fixed border-0 bg-transparent p-0 text-foreground backdrop:bg-black/75 backdrop:backdrop-blur-sm [&>div]:overflow-y-auto',
        placement === 'right'
          ? 'inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full rounded-none [&>div]:max-h-dvh'
          : 'inset-0 m-auto w-[calc(100vw-2rem)] [&>div]:max-h-[90dvh]',
        maxWidthClassName,
        className,
      )}
    >
      {children}
    </dialog>
  );
}
