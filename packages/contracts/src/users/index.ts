import type { UserRole } from '../auth';
export interface UserSummary {
  id: string;
  email: string;
  roles: UserRole[];
}
