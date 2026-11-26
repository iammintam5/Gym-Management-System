'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck, X } from 'lucide-react';

type ToastTone = 'success' | 'error';
interface ToastNotification {
  id: number;
  message: string;
  tone: ToastTone;
}

export function useToast() {
  const [notification, setNotification] = useState<ToastNotification | null>(
    null,
  );
  const sequence = useRef(0);
  const showToast = useCallback(
    (message: string, tone: ToastTone = 'success') => {
      setNotification({ id: ++sequence.current, message, tone });
    },
    [],
  );
  const dismissToast = useCallback(() => setNotification(null), []);
  return { notification, showToast, dismissToast };
}

export function Toast({
  notification,
  onDismiss,
}: {
  notification: ToastNotification | null;
  onDismiss: () => void;
}) {
  if (!notification || typeof document === 'undefined') return null;
  return createPortal(
    <ToastContent
      key={notification.id}
      notification={notification}
      onDismiss={onDismiss}
    />,
    document.body,
  );
}

function ToastContent({
  notification,
  onDismiss,
}: {
  notification: ToastNotification;
  onDismiss: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (hovered || focused) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (!document.hidden) {
        timer = setTimeout(
          onDismiss,
          notification.tone === 'error' ? 8000 : 4000,
        );
      }
    };
    schedule();
    document.addEventListener('visibilitychange', schedule);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [notification, onDismiss, hovered, focused]);

  const Icon = notification.tone === 'error' ? CircleAlert : CircleCheck;

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[120] sm:left-auto sm:right-6 sm:bottom-6 sm:w-[360px]">
      <div
        className="pointer-events-auto flex animate-[toast-enter_180ms_ease-out] items-start gap-3 rounded-xl border border-white/10 bg-[#18181b] py-3 pl-4 pr-2 text-zinc-100 shadow-[0_8px_32px_rgba(0,0,0,0.28)]"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setFocused(false);
        }}
      >
        <Icon
          aria-hidden="true"
          className={`mt-0.5 size-[18px] shrink-0 ${notification.tone === 'error' ? 'text-rose-400' : 'text-emerald-400'}`}
        />
        <p
          role={notification.tone === 'error' ? 'alert' : 'status'}
          aria-atomic="true"
          className="min-w-0 flex-1 break-words pt-px text-[13px] leading-5"
        >
          {notification.message}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Đóng thông báo"
          className="-my-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
