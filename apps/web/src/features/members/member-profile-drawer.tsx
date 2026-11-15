'use client';

import { X } from 'lucide-react';
import type { MemberDetail, SubscriptionDetail } from '@gym/contracts';
import { ModalFrame } from '@/components/ui/modal-frame';
import { MemberProfile } from './member-profile';

export function MemberProfileDrawer({
  memberId,
  onClose,
  onEdit,
  onRenew,
  onCancel,
  onAdjustQuota,
}: {
  memberId: string;
  onClose: () => void;
  onEdit: (member: MemberDetail) => void;
  onRenew: (member: MemberDetail, source: SubscriptionDetail | null) => void;
  onCancel: (member: MemberDetail, source: SubscriptionDetail) => void;
  onAdjustQuota: (member: MemberDetail, source: SubscriptionDetail) => void;
}) {
  return (
    <ModalFrame
      placement="right"
      onClose={onClose}
      labelledBy="member-profile-drawer-title"
      maxWidthClassName="max-w-[640px]"
      className="backdrop:bg-black/40 backdrop:backdrop-blur-none"
    >
      <div className="flex h-dvh flex-col bg-[#101012] shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4 sm:px-6">
          <h2
            id="member-profile-drawer-title"
            className="text-sm font-medium text-zinc-300"
          >
            Hồ sơ hội viên
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hồ sơ hội viên"
            className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-[#FF5500]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          <MemberProfile
            key={memberId}
            memberId={memberId}
            embedded
            onEdit={onEdit}
            onRenew={onRenew}
            onCancel={onCancel}
            onAdjustQuota={onAdjustQuota}
          />
        </div>
      </div>
    </ModalFrame>
  );
}
