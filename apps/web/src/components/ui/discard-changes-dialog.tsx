'use client';

import { ModalFrame } from '@/components/ui/modal-frame';

export function DiscardChangesDialog({
  onKeepEditing,
  onDiscard,
  message = 'Các thay đổi đang nhập sẽ được bỏ khi đóng biểu mẫu.',
}: {
  onKeepEditing: () => void;
  onDiscard: () => void;
  message?: string;
}) {
  return (
    <ModalFrame
      onClose={onKeepEditing}
      labelledBy="discard-changes-title"
      maxWidthClassName="max-w-sm"
    >
      <div className="rounded-2xl border border-white/10 bg-[#141418] p-5">
        <h2
          id="discard-changes-title"
          className="text-lg font-semibold text-white"
        >
          Bỏ thay đổi?
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">{message}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onKeepEditing}
            className="min-h-10 rounded-xl border border-white/10 px-4 text-sm text-zinc-200"
          >
            Tiếp tục sửa
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="min-h-10 rounded-xl bg-red-500 px-4 text-sm font-medium text-white hover:bg-red-600"
          >
            Bỏ thay đổi
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}
