import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@gym/contracts';
import { ROLES_KEY } from '../constants/auth';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
