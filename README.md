# 🏋️ Gym Management System

> **Giải pháp số hóa và vận hành phòng tập toàn diện, tối ưu trải nghiệm hội viên và tự động hóa quy trình quản lý với kiến trúc Modular Monolith hiện đại.**

---

## 🌟 Tính Năng Chính

- 🔐 **Xác thực & Phân quyền (RBAC):** 4 vai trò độc lập (`ADMIN`, `STAFF`, `PT`, `MEMBER`) với JWT & Guards.
- 💳 **Quản lý Hội viên & Gói tập:** Đăng ký gói, tính hạn thẻ, thanh toán, đóng băng & gia hạn thẻ tập.
- 📊 **Hạn mức buổi tập (Quota Ledger):** Quản lý trừ/hoàn lượt tập an toàn, chống duplicate/race-condition.
- 📅 **Lịch lớp & Huấn luyện viên (PT):** Đặt lịch lớp học nhóm, đặt lịch kèm 1-1, quản lý lịch rảnh của PT.
- 🚪 **Điểm danh & Check-in:** Quét mã check-in vào cửa theo thời gian thực và lịch sử ra vào.
- 📈 **Báo cáo & Thống kê:** Doanh thu, lưu lượng hội viên, hiệu suất làm việc của PT.

---

## 🛠️ Công Nghệ Sử Dụng

| Tầng               | Công nghệ                                                                             |
| :----------------- | :------------------------------------------------------------------------------------ |
| **Frontend**       | [Next.js 16 (App Router)](https://nextjs.org), React 19, Tailwind CSS, TanStack Query |
| **Backend**        | [NestJS 11](https://nestjs.com), RESTful API, Swagger OpenAPI, class-validator        |
| **Database & ORM** | [PostgreSQL 17](https://www.postgresql.org), [Prisma ORM 7](https://www.prisma.io)    |
| **Cache & Queue**  | [Redis 7](https://redis.io)                                                           |
| **Monorepo Tools** | [Turborepo](https://turbo.build), [pnpm](https://pnpm.io), TypeScript (Strict Mode)   |

---

## 📁 Cấu Trúc Dự Án

```text
gym-management/
├── apps/
│   ├── web/               # Next.js Frontend Application (Port 3000)
│   └── api/               # NestJS Backend API (Port 4000)
│
├── packages/
│   ├── contracts/         # DTO, Enums, Interfaces dùng chung (Type-safe)
│   ├── database/          # Prisma schema, migrations, seed script
│   ├── ui/                # Thư viện UI components tái sử dụng
│   ├── eslint-config/     # Cấu hình ESLint thống nhất
│   └── typescript-config/ # Cấu hình TypeScript Strict
│
└── docker-compose.yml     # Infrastructure (PostgreSQL 17 + Redis 7)
```

---

## 🚀 Bắt Đầu Nhanh (Quickstart)

### 1. Yêu cầu hệ thống

- **Node.js** `>= 22.12.0`
- **pnpm** `>= 10.32.1` (`npm install -g pnpm@10.32.1`)
- **Docker Desktop**

### 2. Cài đặt và chạy

```bash
# 1. Clone repository & cài đặt dependencies
pnpm install

# 2. Tạo file cấu hình môi trường (.env)
pnpm env:setup

# 3. Khởi động PostgreSQL & Redis
pnpm db:up

# 4. Migrate và nạp dữ liệu khởi tạo
pnpm db:generate
pnpm db:deploy
pnpm db:seed

# 5. Chạy ứng dụng (Development Mode)
pnpm dev
```

---

## 🔗 Endpoint Truy Cập

| Ứng dụng          | Địa chỉ                            | Ghi chú                                  |
| :---------------- | :--------------------------------- | :--------------------------------------- |
| **Web Client**    | `http://localhost:3000`            | Giao diện hội viên, nhân viên & quản trị |
| **API Server**    | `http://localhost:4000/api`        | REST API                                 |
| **Swagger Docs**  | `http://localhost:4000/api/docs`   | Tài liệu API tương tác trực tiếp         |
| **Health Check**  | `http://localhost:4000/api/health` | Kiểm tra trạng thái API                  |
| **Prisma Studio** | `http://localhost:5555`            | Quản lý Database GUI (`pnpm db:studio`)  |

---

## 📜 Các Lệnh Scripts Hữu Ích

```bash
# Phát triển & Build
pnpm dev              # Khởi động toàn bộ dự án với hot-reload
pnpm build            # Build production cho toàn bộ packages/apps
pnpm typecheck        # Kiểm tra kiểu TypeScript toàn dự án
pnpm lint             # Kiểm tra chuẩn mã nguồn (ESLint)
pnpm format           # Tự động format code với Prettier
pnpm test             # Chạy bộ Unit Tests

# Quản lý Database
pnpm db:up            # Bật Postgres & Redis container
pnpm db:down          # Tắt Postgres & Redis container
pnpm db:migrate       # Tạo và chạy migration mới (dev)
pnpm db:deploy        # Áp dụng migration vào database
pnpm db:seed          # Nạp dữ liệu mẫu
pnpm db:studio        # Mở giao diện Prisma Studio
```

---

## 📌 Quy Ước Nhóm (Git Workflow)

1. Nhánh chính: `main` (chỉ chứa source code ổn định).
2. Tạo nhánh tính năng: `feature/<tên-chức-năng>` (VD: `feature/auth-login`, `feature/booking-schedule`).
3. Luôn chạy kiểm tra trước khi tạo Pull Request:
   ```bash
   pnpm typecheck && pnpm lint && pnpm format
   ```
