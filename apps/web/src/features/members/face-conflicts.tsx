import type { MemberFaceConflict } from '@gym/contracts';

export function FaceConflicts({
  conflicts,
}: {
  conflicts?: MemberFaceConflict[];
}) {
  if (!conflicts?.length) return null;

  return (
    <ul className="mt-2 space-y-1 text-sm text-amber-200">
      {conflicts.map((member) => (
        <li key={member.memberId}>
          <a
            className="underline underline-offset-4"
            target="_blank"
            rel="noopener noreferrer"
            href={`/dashboard/staff/members?search=${encodeURIComponent(member.memberCode)}&memberId=${encodeURIComponent(member.memberId)}`}
          >
            {member.memberCode} · {member.fullName}
          </a>
        </li>
      ))}
    </ul>
  );
}
