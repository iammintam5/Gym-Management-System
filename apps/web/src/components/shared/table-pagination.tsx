'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TablePaginationProps {
  totalItems: number;
  pageSize: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
  className?: string;
}

export function TablePagination({
  totalItems,
  pageSize,
  currentPage,
  onPageChange,
  itemLabel = 'bản ghi',
  className,
}: TablePaginationProps) {
  if (totalItems <= 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const startIdx = (safePage - 1) * pageSize + 1;
  const endIdx = Math.min(totalItems, safePage * pageSize);

  // Build visible page numbers (up to 5 buttons around safePage)
  const pages: number[] = [];
  const startPage = Math.max(1, Math.min(safePage - 2, totalPages - 4));
  const endPage = Math.min(totalPages, Math.max(5, safePage + 2));
  for (let p = startPage; p <= endPage; p += 1) {
    pages.push(p);
  }

  return (
    <div
      className={cn(
        'mt-4 flex flex-col items-center justify-between gap-3 border-t border-white/[0.06] pt-4 text-xs sm:flex-row',
        className,
      )}
    >
      <p className="tabular-nums text-zinc-400">
        Hiển thị{' '}
        <span className="font-semibold text-white">
          {startIdx}–{endIdx}
        </span>{' '}
        trong tổng số{' '}
        <span className="font-semibold text-white">{totalItems}</span>{' '}
        {itemLabel}
      </p>

      {totalPages > 1 && (
        <div className="inline-flex items-center gap-1 tabular-nums">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => onPageChange(safePage - 1)}
            aria-label="Trang trước"
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/[0.08] bg-[#18181C] px-2.5 text-xs font-medium text-zinc-300 transition-colors hover:border-white/20 hover:text-white disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span>Trước</span>
          </button>

          {pages.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p)}
              className={cn(
                'inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs font-semibold transition-colors',
                p === safePage
                  ? 'bg-[#FF5500] text-white'
                  : 'border border-white/[0.06] bg-[#18181C] text-zinc-400 hover:border-white/15 hover:text-white',
              )}
            >
              {p}
            </button>
          ))}

          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => onPageChange(safePage + 1)}
            aria-label="Trang sau"
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/[0.08] bg-[#18181C] px-2.5 text-xs font-medium text-zinc-300 transition-colors hover:border-white/20 hover:text-white disabled:pointer-events-none disabled:opacity-40"
          >
            <span>Sau</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
