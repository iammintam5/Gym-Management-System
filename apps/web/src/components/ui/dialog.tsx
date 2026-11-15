'use client';

import { useId, type ReactNode } from 'react';
import { ModalFrame } from './modal-frame';
import { Button } from './button';
import { X, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidthClassName?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidthClassName = 'max-w-lg',
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <ModalFrame
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      describedBy={description ? descriptionId : undefined}
      maxWidthClassName={maxWidthClassName}
    >
      <div
        className={cn(
          'relative flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl',
          maxWidthClassName,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <h3 id={titleId} className="text-base font-bold text-foreground">
              {title}
            </h3>
            {description && (
              <p
                id={descriptionId}
                className="mt-0.5 text-xs text-muted-foreground"
              >
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hộp thoại"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2.5 border-t border-border bg-muted/20 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </ModalFrame>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isSubmitting?: boolean;
  destructive?: boolean;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Xác nhận',
  cancelLabel = 'Huỷ bỏ',
  isSubmitting = false,
  destructive = true,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      maxWidthClassName="max-w-md"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-xl border border-border px-4 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className={cn(
              'rounded-xl px-4 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-50',
              destructive
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-[#FF5500] hover:bg-[#E64D00]',
            )}
          >
            {isSubmitting ? 'Đang xử lý...' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          {destructive && (
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-500">
              <AlertTriangle className="size-5" />
            </div>
          )}
          <p className="text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
        {children}
      </div>
    </Dialog>
  );
}
