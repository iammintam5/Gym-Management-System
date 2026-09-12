# Gym Management System

Foundation cho hệ thống quản lý phòng tập theo **Modular Monolith**, trong một pnpm workspace được điều phối bằng Turborepo. Web và API chạy trực tiếp trên máy; Docker chỉ chạy PostgreSQL và Redis.

## Cấu trúc

```text
.
├── apps/
│   ├── web/                 # Next.js App Router, React, Tailwind
│   │   └── src/             # app, features, components, providers, services
│   └── api/                 # NestJS REST API
│       └── src/             # modules, common, config
├── packages/
│   ├── contracts/           # Enum, DTO interfaces, read-model helpers
│   ├── database/            # Prisma schema, migrations, seed, client factory
│   ├── ui/                  # Button, PageHeader
│   ├── eslint-config/       # Flat config dùng chung, chặn web → database
│   └── typescript-config/   # Strict TypeScript: base, Next.js, NestJS
├── scripts/setup-env.mjs    # Tạo .env local và JWT secrets ngẫu nhiên
├── docker/                 # Ghi chú infrastructure
├── .github/workflows/      # CI: install, Prisma, types, lint, test, build
├── docker-compose.yml
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
└── turbo.json
```

Luồng dependency: `web → contracts/ui`, `web → REST → api → contracts/database → PostgreSQL`. Database không import API; frontend không được import Prisma/database. Mỗi module backend sở hữu nghiệp vụ của mình, gọi service được export từ module khác khi cần; chưa thêm repository wrapper hoặc message broker.

## Yêu cầu

- Node.js **24 LTS** được khuyến nghị; tối thiểu 22.12.
- pnpm **10.32.1**, được khóa bằng `packageManager`.
- Docker và Docker Compose v2 để dùng database/cache.

Nếu chưa có pnpm: `npm install --global pnpm@10.32.1`.
Trên Windows PowerShell bị chặn chạy `.ps1`, dùng `pnpm.cmd` thay cho `pnpm` (tương tự `npm.cmd`); không cần đổi execution policy.

## Cài đặt và chạy

Chạy từ **root repository**:

```bash
pnpm install
pnpm env:setup
pnpm db:up
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm dev
```

`env:setup` chỉ tạo root `.env` nếu chưa tồn tại, dùng hai JWT secret ngẫu nhiên khác nhau và không in chúng ra log. File này đã được gitignore. Tham khảo `.env.example` để điều chỉnh port, origin, database và Redis. API đọc root `.env` bằng đường dẫn dựa trên vị trí file; Next.js nạp root env trong `next.config.ts`; Prisma nạp trong `prisma.config.ts`. Không copy secrets sang frontend. Chỉ biến `NEXT_PUBLIC_*` được đưa vào trình duyệt.

Để chạy giao diện, Swagger và health check, có thể bỏ qua `db:up`, `db:deploy`, `db:seed`. API tạo Prisma client theo lifecycle nhưng không kết nối lúc bootstrap; Redis chưa có client hoặc job phụ thuộc nó. Khi triển khai endpoint dùng database, phải bật PostgreSQL và apply migration.

`pnpm dev` build shared packages trước, sau đó chạy các watcher và hai ứng dụng. Khi thay đổi contracts/database/UI, TypeScript watcher cập nhật `dist`; nếu Nest không reload sau thay đổi package bên ngoài `src`, khởi động lại API. Không tạo nested Git repository.

## URLs

| Thành phần    | URL                                 |
| ------------- | ----------------------------------- |
| Web           | http://localhost:3000               |
| Login         | http://localhost:3000/login         |
| Dashboard mẫu | http://localhost:3000/dashboard     |
| API base      | http://localhost:4000/api           |
| Health        | http://localhost:4000/api/health    |
| Swagger       | http://localhost:4000/api/docs      |
| OpenAPI JSON  | http://localhost:4000/api/docs-json |

`/api` là prefix, không có handler riêng. Health trả `{ "status": "ok" }`, chỉ xác nhận tiến trình API sống, không xác nhận database/cache sẵn sàng. Dashboard member/trainer/staff/admin là public placeholder, chưa chứa dữ liệu cá nhân.

## Scripts

```bash
pnpm db:validate       # Validate schema
pnpm db:generate       # Generate Prisma client, không cần database đang chạy
pnpm db:migrate        # Tạo/apply migration trong development, đặt tên khi được hỏi
pnpm db:deploy         # Apply các migration đã commit
pnpm db:seed           # Upsert 4 roles + 3 service types, không tạo account/password
pnpm db:studio         # Prisma Studio
pnpm db:down           # Dừng infrastructure; giữ named volume PostgreSQL
pnpm format
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Sau build, chạy `pnpm --filter @gym/api start` và `pnpm --filter @gym/web start` trong hai terminal nếu cần kiểm tra production build local. Cấu hình deployment production nằm ngoài phạm vi scaffold.

PostgreSQL local: `localhost:5432`, database `gym_management`, user/password `gym/gym`. Redis: `localhost:6379`. Cả hai chỉ bind loopback. PostgreSQL dùng named volume `postgres_data`. Nếu cổng đã bị chiếm, đổi port mapping và root `.env` tương ứng.

## Database và quy ước nghiệp vụ

Schema có đủ 23 bảng/domain: users/roles/user_roles, member/employee profiles, plans/service types/entitlements, subscriptions/quotas/freezes/payments/quota transactions, checkins, classes/schedules/bookings, PT availability/bookings, notifications và audit logs.

- Subscription mới tham chiếu subscription trước qua `previous_subscription_id`; khóa unique giữ chuỗi gia hạn không phân nhánh. Không overwrite lần mua trước. Service tương lai phải kiểm tra cùng member và ngăn chu trình.
- `EXPIRED` là trạng thái read model trong `@gym/contracts`: chỉ suy ra khi `status = ACTIVE` và `now > endDate`. Không lưu EXPIRED trong enum database. Mọi kiểm tra sử dụng dịch vụ còn phải xét `startDate`, trạng thái và freeze.
- Subscription chụp `agreedPrice`; subscription quota chụp entitlement tại lúc mua. Chỉnh sửa plan không tự thay đổi quyền/hạn mức đã mua.
- Không có entitlement nghĩa là không có quyền. `allocated = null` nghĩa là không giới hạn; còn lại `remaining = allocated - reserved - used`. Ledger lưu delta của từng bộ đếm và khóa idempotency. RESERVE tăng reserved; USE giảm reserved và tăng used khi có đặt trước; REFUND giải phóng reservation hoặc hoàn lượt đã dùng theo chính sách.
- Composite foreign keys giữ booking/checkin đúng member của subscription và đúng quota của subscription. Kiểm tra service type tương ứng GYM_ACCESS/CLASS/PT, hiệu lực, khả dụng, capacity và lịch trùng vẫn thuộc business service.
- Checkin bị từ chối có thể không có subscription/quota, nhưng phải có lý do. Checkin được chấp nhận cần subscription và quota hợp lệ.
- `restoredAt` hỗ trợ restore freeze idempotent: cập nhật dấu mốc và gia hạn `endDate` trong cùng transaction. Chính sách xử lý booking trong khoảng freeze chưa được triển khai.
- Thời điểm dùng `timestamptz`, API dùng ISO 8601; ngày sinh/ngày tuyển dụng dùng `date`. Tiền dùng Decimal, chuyển sang string trong contract để tránh mất chính xác.
- Dùng transaction và khóa/điều kiện cập nhật để ngăn vượt quota/capacity, trùng lịch và double booking. Các flow này chưa được triển khai ở scaffold. Lưu lịch sử bằng audit/ledger; không ghi JWT, password hash hoặc secrets vào log.

## Authentication foundation

Backend có `JwtAuthGuard`, `RolesGuard`, `@Roles()`, `@CurrentUser()` và `@Public()`. JWT guard chạy trước RBAC, mặc định bảo vệ mọi controller trừ route đánh dấu public. Token access phải có chữ ký HS256 hợp lệ, `iss=gym-api`, `aud=gym-web`, `sub`, `roles`, `type=access`, `exp`. Guard từ chối token hết hạn, sai claim hoặc refresh token. Role lấy từ token đã xác minh, không lấy từ body hoặc frontend.

`GET /api/auth/me` trả identity trong token; chưa truy vấn trạng thái tài khoản hiện tại. `GET /api/reports/overview` yêu cầu ADMIN rồi trả 501 vì báo cáo chưa triển khai. `POST /api/auth/login` và `/refresh` validate DTO rồi trả **501** có chủ đích, không cấp token giả. Form login gọi endpoint thật và hiển thị trạng thái đang phát triển.

Chưa có kiểm tra password, phát hành token, lưu/rotate/revoke refresh token hoặc session frontend. `RefreshTokenClaims`, DTO và env đã sẵn sàng. Khi hoàn thiện auth, dùng hash mật khẩu, lưu hash refresh token với jti/session/expiry, rotate nguyên tử, xử lý reuse/logout và kiểm tra tài khoản bị vô hiệu hóa. Không dùng refresh token làm access token. Không có tài khoản demo hoặc quyền truy cập hard-code ở frontend.

## Kiểm tra

`pnpm test` chạy Node test runner: read-model expiry/quota và HTTP integration cho health, Swagger, JWT, RBAC, validation. Các bài kiểm tra này không cần PostgreSQL/Redis. Web hiện được kiểm tra bằng lint/typecheck/build; chưa có bộ browser E2E.

Shared packages biên dịch trước app thông qua `dependsOn: ["^build"]`. Prisma client được generate trong database build và bị gitignore; lockfile được commit để cài đặt lặp lại. ESLint chạy riêng, vì Next.js 16 không tích hợp lint trong build ([Next.js installation](https://nextjs.org/docs/app/getting-started/installation)). Database dùng Prisma 7 với PostgreSQL adapter và `prisma.config.ts` ([Prisma 7 guide](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7)).

## Phát triển tiếp

1. Hoàn thiện Auth + RBAC, refresh rotation và frontend session.
2. Triển khai Member/Employee và Membership Plan/Entitlement.
3. Triển khai Subscription: đăng ký, gia hạn, thanh toán thủ công, freeze/restore.
4. Triển khai Quota ledger với transaction, idempotency và kiểm tra đồng thời.
5. Triển khai Check-in; tiếp theo mới mở rộng class/PT booking dựa trên cùng rule eligibility.
