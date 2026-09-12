# Module boundaries

Each business folder is a Nest module, imported once by AppModule. Add controllers, DTOs and services when implementing its use case; export services only when another module needs them. Import DatabaseModule explicitly where Prisma access is needed.

- auth/users: credentials, identities, roles; JWT guards default to protected. Only @Public routes bypass authentication.
- members/employees/trainers: profiles; PT is an employee with the PT role, not a second identity table.
- membership-plans: catalogue and entitlements.
- subscriptions: purchase, renewal, lifecycle; owns orchestration of freezes and service eligibility.
- quotas: entitlement snapshots, atomic reservation/use/refund and idempotency ledger.
- checkins/class-bookings/pt-bookings: validate active subscription, service entitlement, quota, capacity/availability inside a transaction before accepting usage.
- payments: staff-confirmed records; no gateway.
- jobs: future activation, restore, expiry notices and future-booking cleanup. No fake cron jobs run.
- notifications/reports/audit-logs: delivery, read models and traceability.

Do not call controllers from services. Avoid circular module imports. Use transactions for quota and booking transitions; ownership, PT role, matching service type, overlapping schedules, freeze ranges and cancellation policy belong to business services. Health is liveness, not database readiness. Redis is optional and has no eager connection.
