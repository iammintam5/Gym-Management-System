'use client';

import { useParams } from 'next/navigation';
import { MemberProfile } from '@/features/members/member-profile';

export default function StaffMemberDetailPage() {
  const { memberId } = useParams<{ memberId: string }>();
  return <MemberProfile key={memberId} memberId={memberId} />;
}
