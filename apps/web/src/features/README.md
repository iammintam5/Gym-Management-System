# Frontend Architecture & Feature Layer (`@gym/web`)

## 1. Quy tắc Bắt buộc cho AI Agent (Zero Hallucination Rules)

Khi xây dựng hoặc chỉnh sửa bất kỳ màn hình nào trong `apps/web/src/app/dashboard/*`:

1. **KHÔNG tự chế kiểu dữ liệu (No Ad-hoc DTOs)**: Luôn import trực tiếp DTO, Enum và hằng số `GYM_DOMAIN_RULES` từ `@gym/contracts`.
2. **KHÔNG tự vẽ lại Component cơ sở & Formatters**:
   - Dùng các UI Primitives từ `@/components/ui` (`Button`, `Badge`, `Input`, `SearchInput`, `Textarea`, `Select`, `Table`, `TableContainer`, `TableToolbar`, `Dialog`, `ConfirmDialog`, `PillTabs`).
   - Dùng các Domain Components từ `@/components/shared` (`SubscriptionStatusBadge`, `PaymentStatusBadge`, `BookingStatusBadge`, `FreezeStatusBadge`, `CheckinStatusBadge`, `QuotaTxTypeBadge`, `QuotaMeter`, `MemberAvatar`).
   - Dùng các hàm định dạng chuẩn từ `@/lib/utils` (`formatVnd`, `formatDurationVi`, `formatPhoneVi`, `formatDateVi`, `formatTimeVi`, `formatDateTimeVi`, `formatEntitlementLabel`, `generateIdempotencyKey`).
3. **Dùng tầng API Service & TanStack Query Hooks tại `@/features/*/api`**:
   - Mọi mutation làm biến động Quota (`checkins`, `class-bookings`, `pt-bookings`, `quotas/adjust`) đã được tự động gắn `idempotencyKey` trong tầng `features/*/api.ts`.

---

## 2. Danh mục Tầng Data & Hooks (`src/features/*/api.ts`)

| Phân hệ                                      | Đường dẫn                         | API Object & Hooks tiêu biểu                                                                                                                                    |
| :------------------------------------------- | :-------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth**                                     | `@/features/auth/login-form`      | Đăng nhập, lưu JWT cookie/storage, điều hướng theo `UserRole`                                                                                                   |
| **Check-ins**                                | `@/features/checkins/api`         | `checkinsApi`, `useCheckinsList`, `useTodayCheckinStats`, `useMyCheckins`, `useCreateCheckin`                                                                   |
| **Classes & Schedules**                      | `@/features/classes/api`          | `classesApi`, `useGymClasses`, `useClassSchedules`, `useCreateClassSchedule`                                                                                    |
| **Class Bookings**                           | `@/features/class-bookings/api`   | `classBookingsApi`, `useMyClassBookings`, `useBookClass`, `useCancelClassBooking`                                                                               |
| **PT Bookings**                              | `@/features/pt-bookings/api`      | `ptBookingsApi`, `useMyPtBookings`, `useTrainerPtBookings`, `useBookPtSession`                                                                                  |
| **Trainers & Staff**                         | `@/features/trainers/api`         | `trainersApi`, `useEmployees`, `useTrainerAvailabilities`, `useCreateMyAvailability`                                                                            |
| **Subscriptions, Freezes, Quotas & Billing** | `@/features/subscriptions/api`    | `subscriptionsApi`, `useSubscriptionsList`, `useMyCurrentSubscription`, `useMyCurrentQuotas`, `useFreezesList`, `usePaymentsList`, `useActivateSubscriptionNow` |
| **Membership Plans**                         | `@/features/membership-plans/api` | `membershipPlansApi`, `usePublicMembershipPlans`, `useMembershipPlans`, `useUpsertMembershipPlan`                                                               |
| **Members**                                  | `@/features/members/api`          | `membersApi`, `useMembersList`, `useMyMemberProfile`, `useUpdateMemberPhoto`, `MemberOnboardingModal`                                                           |
| **Reports & Audit**                          | `@/features/reports/api`          | `reportsApi`, `useDashboardSummaryReport`, `useRevenueReport`, `usePeakHoursReport`, `useClassUtilizationReport`, `useTrainerPerformanceReport`, `useAuditLogs` |
| **Notifications**                            | `@/features/notifications/api`    | `notificationsApi`, `useMyNotifications`, `useMarkAllNotificationsRead`                                                                                         |
