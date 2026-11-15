import type {
  HTMLAttributes,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
  ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

export function TableContainer({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="table-container"
      className={cn(
        'overflow-hidden rounded-2xl border border-border bg-card shadow-xs',
        className,
      )}
      {...props}
    >
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export function TableToolbar({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="table-toolbar"
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function Table({
  className,
  ...props
}: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      data-slot="table"
      className={cn('w-full border-collapse text-left text-sm', className)}
      {...props}
    />
  );
}

export function TableHeader({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        'border-b border-border bg-muted/40 text-xs font-semibold tracking-wider text-muted-foreground uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('divide-y divide-border', className)}
      {...props}
    />
  );
}

export function TableRow({
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      data-slot="table-row"
      className={cn('transition-colors hover:bg-muted/30', className)}
      {...props}
    />
  );
}

export function TableHead({
  className,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      data-slot="table-head"
      className={cn('px-5 py-3.5 font-semibold whitespace-nowrap', className)}
      {...props}
    />
  );
}

export function TableCell({
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      data-slot="table-cell"
      className={cn('px-5 py-3.5 align-middle text-foreground', className)}
      {...props}
    />
  );
}

export interface TableEmptyStateProps {
  colSpan: number;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function TableEmptyState({
  colSpan,
  title,
  description,
  action,
}: TableEmptyStateProps) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-6 py-12 text-center">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        )}
        {action && <div className="mt-4 flex justify-center">{action}</div>}
      </td>
    </tr>
  );
}
