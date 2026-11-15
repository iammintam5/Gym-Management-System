import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options?: ReadonlyArray<SelectOption>;
  wrapperClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, wrapperClassName, options, children, ...props }, ref) => {
    return (
      <div
        className={cn('relative inline-flex items-center', wrapperClassName)}
      >
        <select
          ref={ref}
          data-slot="select"
          className={cn(
            'h-10 w-full appearance-none rounded-xl border border-border bg-background pr-9 pl-3.5 text-sm font-medium text-foreground transition-colors outline-none focus-visible:border-[#FF5500] focus-visible:ring-2 focus-visible:ring-[#FF5500]/20 disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        >
          {options
            ? options.map((opt) => (
                <option
                  key={opt.value}
                  value={opt.value}
                  disabled={opt.disabled}
                >
                  {opt.label}
                </option>
              ))
            : children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 size-4 text-muted-foreground" />
      </div>
    );
  },
);
Select.displayName = 'Select';
