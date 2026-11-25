import {
  CanActivate,
  ExecutionContext,
  GoneException,
  Injectable,
} from '@nestjs/common';
import { GYM_SERVICE_SCOPE } from '@gym/contracts';

/** Retired PT records remain readable; no new PT operations may enter through HTTP. */
@Injectable()
export class GymScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      method: string;
      originalUrl?: string;
      url: string;
      body?: Record<string, unknown>;
      query?: Record<string, unknown>;
    }>();
    const path = (request.originalUrl ?? request.url)
      .split('?')[0]!
      .replace(/^\/api\//, '/');
    const method = request.method.toUpperCase();
    const retired = () => {
      throw new GoneException(
        'Dịch vụ PT 1–1 đã ngừng cung cấp. Dữ liệu cũ chỉ được giữ để tra cứu và đối chiếu.',
      );
    };
    if (GYM_SERVICE_SCOPE.personalTraining) return true;
    if (path.startsWith('/pt-assignments')) retired();
    if (path.startsWith('/pt-bookings') && method !== 'GET') retired();
    if (path.startsWith('/pt-package-plans')) retired();
    if (path.startsWith('/pt-packages') && method !== 'GET') retired();
    if (/^\/trainers\/(?:[^/]+\/)?(?:availabilities|pt-slots)(\/|$)/.test(path))
      retired();
    if (path === '/trainers' && request.query?.service === 'PT') retired();
    if (['POST', 'PATCH', 'PUT'].includes(method)) {
      const body = request.body ?? {};
      if (body.canCoachPt === true || body.ptPurchaseId) retired();
      if (path === '/employees' && body.canCoachPt === undefined)
        body.canCoachPt = false;
      if (
        Array.isArray(body.entitlements) &&
        body.entitlements.some((item: unknown) => {
          if (!item || typeof item !== 'object') return false;
          const value = item as Record<string, unknown>;
          return (
            String(value.service ?? value.code ?? '')
              .trim()
              .toUpperCase() === 'PT' && value.limitType !== 'NONE'
          );
        })
      )
        retired();
    }
    return true;
  }
}
