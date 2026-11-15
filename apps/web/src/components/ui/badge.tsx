import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors select-none',
  {
    variants: {
      variant: {
        default: 'border-border bg-secondary text-secondary-foreground',
        primary: 'border-[#FF5500]/30 bg-[#FF5500]/10 text-[#FF5500]',
        success: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-500',
        warning: 'border-amber-500/25 bg-amber-500/10 text-amber-500',
        destructive: 'border-red-500/25 bg-red-500/10 text-red-500',
        outline: 'border-border bg-transparent text-foreground',
        mono: 'rounded-md border-border bg-muted/60 px-2 py-0.5 font-mono text-[11px] font-medium text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({
  className,
  variant,
  dot = false,
  children,
  ...props
}: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && (
        <span
          className={cn(
            'size-1.5 rounded-full',
            variant === 'success' && 'bg-emerald-500',
            variant === 'warning' && 'bg-amber-500',
            variant === 'destructive' && 'bg-red-500',
            variant === 'primary' && 'bg-[#FF5500]',
            (!variant ||
              variant === 'default' ||
              variant === 'outline' ||
              variant === 'mono') &&
              'bg-current',
          )}
        />
      )}
      {children}
    </span>
  );
}

export { badgeVariants };
