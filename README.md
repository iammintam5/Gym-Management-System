# Aura Gym — Gym Management System

Hệ thống quản lý phòng gym dành cho quản trị viên, lễ tân, huấn luyện viên và hội viên. Dự án được phát triển trong học phần **Phân tích và Thiết kế Hệ thống**, sử dụng kiến trúc monorepo với Next.js, NestJS và PostgreSQL trên Supabase.

## Tính năng

- **Quản lý hội viên:** đăng ký, cập nhật hồ sơ và chụp ảnh nhận diện tại quầy.
- **Quản lý gói tập:** đăng ký, kích hoạt, gia hạn nối tiếp, bảo lưu và hủy gói.
- **Thu ngân:** thanh toán bằng tiền mặt hoặc chuyển khoản, xuất biên lai và xử lý hoàn tiền theo phân quyền.
- **Check-in khuôn mặt:** nhận diện tự động tại trạm camera, kiểm tra quyền vào phòng tập và đồng bộ kết quả về màn lễ tân.
- **Lớp học nhóm:** quản lý lịch học, huấn luyện viên, sức chứa, đặt chỗ và điểm danh.
- **Hạn mức buổi tập:** theo dõi số buổi được cấp, giữ chỗ, sử dụng và hoàn lại.
- **Báo cáo:** doanh thu, lượt check-in, tình hình lớp học và hoạt động giảng dạy.

## Vai trò người dùng

| Vai trò   | Quyền sử dụng chính                                                             |
| --------- | ------------------------------------------------------------------------------- |
| `ADMIN`   | Quản lý hệ thống, nhân viên, HLV, gói tập, lớp học, báo cáo và hoàn tiền        |
| `STAFF`   | Quản lý hồ sơ hội viên, bán/gia hạn gói, thu ngân, bảo lưu và theo dõi check-in |
| `TRAINER` | Theo dõi lịch dạy, danh sách học viên và điểm danh lớp được phân công           |
| `MEMBER`  | Xem hồ sơ, gói tập, thanh toán, đặt/hủy lớp và gửi yêu cầu bảo lưu              |

## Công nghệ

| Thành phần          | Công nghệ                                                     |
| ------------------- | ------------------------------------------------------------- |
| Frontend            | Next.js 16, React 19, Tailwind CSS, TanStack Query, Zustand   |
| Backend             | NestJS 11, TypeScript, JWT, Swagger                           |
| Database            | Supabase PostgreSQL, Prisma ORM 7                             |
| Nhận diện khuôn mặt | `@vladmandic/face-api`                                        |
| Monorepo            | pnpm workspaces, Turborepo                                    |
| Chất lượng mã nguồn | ESLint, Prettier, TypeScript strict mode, Node.js Test Runner |

Web truy cập dữ liệu thông qua API NestJS. API kết nối PostgreSQL trên Supabase bằng Prisma; xác thực và phân quyền được xử lý bằng JWT tại backend.

## Cấu trúc thư mục

```text
Gym-Management-System/
├── apps/
│   ├── api/                  # NestJS API và integration tests
│   └── web/                  # Next.js web application
├── packages/
│   ├── contracts/            # Kiểu dữ liệu và quy tắc nghiệp vụ dùng chung
│   ├── database/             # Prisma schema, migrations và seed
│   ├── ui/                   # Thành phần giao diện dùng chung
│   ├── eslint-config/
│   └── typescript-config/
├── scripts/                  # Thiết lập môi trường và chạy demo
├── .env.example
├── pnpm-workspace.yaml
└── turbo.json
```

## Cài đặt

### Yêu cầu

- Node.js **>= 22.12.0**; khuyến nghị Node.js 24 để đồng nhất với CI.
- pnpm **10.32.1**.
- Database PostgreSQL trên Supabase và chuỗi kết nối được cấp cho project.
- Trình duyệt hỗ trợ camera để sử dụng chụp ảnh và check-in khuôn mặt.

### 1. Cài dependencies

```bash
git clone https://github.com/iammintam5/Gym-Management-System.git
cd Gym-Management-System
npm install -g pnpm@10.32.1
pnpm install --frozen-lockfile
pnpm env:setup
```

### 2. Cấu hình môi trường

`pnpm env:setup` tạo `.env` ở thư mục gốc và sinh JWT secret. Điền chuỗi kết nối PostgreSQL của project Supabase vào `DATABASE_URL` trước khi chạy các lệnh database.

Các biến kết nối trong `.env`:

```dotenv
NODE_ENV=development
API_PORT=4100
WEB_ORIGIN=http://localhost:3000
DATABASE_URL="<SUPABASE_POSTGRES_CONNECTION_STRING>"
NEXT_PUBLIC_API_URL=http://127.0.0.1:4100/api
```

Thay `<SUPABASE_POSTGRES_CONNECTION_STRING>` bằng chuỗi kết nối thực tế. Giữ hai JWT secret riêng biệt do script sinh; không đưa chuỗi kết nối hoặc secret lên Git.

Tạo `apps/web/.env.local`:

```dotenv
API_INTERNAL_URL=http://127.0.0.1:4100/api
NEXT_PUBLIC_API_URL=http://127.0.0.1:4100/api
```

`API_INTERNAL_URL` là địa chỉ API mà proxy của Next.js sử dụng. Nếu đổi cổng backend, cập nhật đồng bộ các URL API. Với cấu hình Supabase này, không cần khởi động PostgreSQL local hoặc Docker để chạy ứng dụng.

### 3. Chuẩn bị database

```bash
pnpm db:validate
pnpm db:generate
pnpm db:deploy
```

`db:deploy` áp dụng các migration còn thiếu vào database được cấu hình trong `DATABASE_URL`.

Lệnh `pnpm db:seed` chỉ dành cho database phát triển/demo có thể đặt lại: **script xóa dữ liệu nghiệp vụ hiện có rồi nạp dữ liệu mẫu**. Không chạy seed trên database Supabase đang chứa dữ liệu cần giữ.

## Chạy ứng dụng

### Development

```bash
pnpm dev
```

### Demo production

```bash
pnpm demo
```

Lệnh build và khởi động cả API lẫn web. Để sử dụng lại bản build hiện có:

```bash
pnpm demo:start
```

Nhấn **Ctrl+C** để dừng demo. Chỉ chạy một phiên dev hoặc demo tại cùng thời điểm. Build lại sau khi thay đổi mã nguồn hoặc cấu hình build.

### Địa chỉ truy cập

| Thành phần   | Địa chỉ theo cấu hình trên                        |
| ------------ | ------------------------------------------------- |
| Web          | `http://localhost:3000`                           |
| Đăng nhập    | `http://localhost:3000/login`                     |
| API          | `http://localhost:4100/api`                       |
| Swagger      | `http://localhost:4100/api/docs`                  |
| Health check | `http://localhost:4100/api/health`                |
| Trạm camera  | `http://localhost:3000/camera?station=front-desk` |

Camera cần được cấp quyền truy cập và chạy trong ngữ cảnh an toàn (`localhost` hoặc HTTPS). Trạm camera và màn lễ tân phải sử dụng cùng mã trạm.

## Tài khoản demo

Các tài khoản sau có trong dữ liệu seed. Khả năng đăng nhập phụ thuộc vào dữ liệu đã được khởi tạo trong database đang kết nối.

| Vai trò         | Email            | Mật khẩu        |
| --------------- | ---------------- | --------------- |
| Quản trị viên   | `admin@gym.com`  | `Admin@123456`  |
| Lễ tân          | `staff@gym.com`  | `Staff@123456`  |
| Huấn luyện viên | `pt@gym.com`     | `Pt@123456`     |
| Hội viên        | `member@gym.com` | `Member@123456` |

Chỉ sử dụng các tài khoản này trong môi trường phát triển/demo.

## Kiểm thử

Chạy các lệnh tuần tự từ thư mục gốc, sau khi dừng dev/demo:

```bash
pnpm db:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Bộ kiểm thử gồm contracts, web, integration API và runner demo. Integration API sử dụng PostgreSQL tạm riêng biệt, không sử dụng database Supabase của ứng dụng. Trên Linux cần có `pg_config` và các binary PostgreSQL server (`initdb`, `postgres`, `pg_ctl`), chạy bằng người dùng không phải root. Windows/macOS sử dụng binary từ dependency `embedded-postgres`.

## Lệnh thường dùng

| Lệnh                | Chức năng                     |
| ------------------- | ----------------------------- |
| `pnpm dev`          | Phát triển với hot reload     |
| `pnpm demo`         | Build và chạy demo production |
| `pnpm demo:start`   | Chạy bản build hiện có        |
| `pnpm build`        | Build toàn bộ monorepo        |
| `pnpm typecheck`    | Kiểm tra kiểu dữ liệu         |
| `pnpm lint`         | Kiểm tra ESLint               |
| `pnpm test`         | Chạy bộ kiểm thử              |
| `pnpm format:check` | Kiểm tra định dạng mã nguồn   |
| `pnpm db:generate`  | Sinh Prisma Client            |
| `pnpm db:deploy`    | Áp dụng migration             |
| `pnpm db:studio`    | Mở Prisma Studio              |

## Đóng góp

1. Tạo nhánh `feature/<ten-chuc-nang>` hoặc `fix/<ten-loi>` từ `main`.
2. Định nghĩa các kiểu dữ liệu dùng chung trong `packages/contracts` trước khi sửa API/web.
3. Bổ sung kiểm thử phù hợp và hoàn thành các bước kiểm tra trước Pull Request.
4. Chia commit theo chức năng, mô tả rõ thay đổi và cách kiểm chứng trong Pull Request.

Không commit `.env`, thông tin truy cập Supabase, log, cache hoặc thư mục build. Giữ nguyên các migration đã phát hành và giấy phép đi kèm tài nguyên nhận diện. Thư mục `docs/` được giữ local theo quy ước của repo.
