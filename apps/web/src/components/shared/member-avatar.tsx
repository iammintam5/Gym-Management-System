'use client';

import { useState } from 'react';
import { cn, getInitials } from '@/lib/utils';

export interface MemberAvatarProps {
  src?: string | null;
  fullName?: string | null;
  aspect?: 'square' | 'portrait';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

/**
 * Standardized Member / Trainer Avatar & Gate ID Photo component.
 * Supports both Base64 data URIs (captured via Webcam) and remote URLs.
 */
export function MemberAvatar({
  src,
  fullName,
  aspect = 'square',
  size = 'md',
  className,
}: MemberAvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const initials = getInitials(fullName);

  const sizeClass =
    aspect === 'portrait'
      ? size === 'xl'
        ? 'h-48 w-36 rounded-2xl text-2xl'
        : size === 'lg'
          ? 'h-32 w-24 rounded-xl text-lg'
          : 'h-16 w-12 rounded-lg text-xs'
      : size === 'xl'
        ? 'size-20 rounded-2xl text-xl'
        : size === 'lg'
          ? 'size-12 rounded-xl text-sm'
          : size === 'sm'
            ? 'size-8 rounded-full text-xs'
            : 'size-10 rounded-full text-xs';

  return (
    <div
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-border bg-muted font-bold text-foreground select-none',
        sizeClass,
        className,
      )}
    >
      {src && failedSrc !== src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          onError={() => setFailedSrc(src)}
          alt={fullName ?? 'Ảnh định danh'}
          className="h-full w-full object-cover"
        />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}
