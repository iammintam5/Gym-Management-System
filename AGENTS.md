# AI AGENT GUIDELINES & PROJECT CONTEXT
## Gym Management System (PTIT - System Analysis & Design Project)

### 1. BỐI CẢNH VÀ CÔNG NGHỆ (TECH STACK)
- **Kiến trúc**: Monorepo quản lý bằng **Turborepo** + **pnpm workspaces**.
- **Backend API (`apps/api`)**: NestJS 11, TypeScript 5.9 (Strict mode 100%), Swagger OpenAPI (`/api/docs`), Passport/JWT, Class Validator, NestJS Schedule (Cron).
- **Frontend Web (`apps/web`)**: Next.js 16 (App Router), React 19, Tailwind CSS.
- **Cơ sở dữ liệu (`packages/database`)**: Prisma 7, PostgreSQL 17, Redis 7 (Token blacklist & Cache).
- **Hợp đồng dữ liệu chung (`packages/contracts`)**: Nơi chứa toàn bộ Enums, Types, DTO Interfaces dùng chung giữa Backend và Frontend (Single Source of Truth).

---

### 2. NGUYÊN TẮC KIẾN TRÚC BẮT BUỘC (ARCHITECTURAL INVARIANTS)
1. **Contracts-First**: Mọi thay đổi về Model, DTO, Type, Enum bắt buộc phải định nghĩa tại `@gym/contracts` trước khi code Controller/Service trong `@gym/api` hoặc Component trong `@gym/web`.
2. **ACID Transaction Tuyệt đối**: Các nghiệp vụ làm thay đổi nhiều bảng (ví dụ: Check-in trừ quota, Đặt lịch giữ chỗ, Huỷ gói cascade, Mua gói kèm tạo payment, Bảo lưu gói dời hạn, Điểm danh) BẮT BUỘC bọc trong `this.db.client.$transaction`.
3. **Idempotency**: Mọi giao dịch biến động Quota phải có `idempotencyKey` duy nhất để chống trừ lượt trùng lặp do mạng hoặc retry.
4. **RBAC Chặt chẽ**: Bảo vệ endpoint bằng `@Roles(...)` decorator và `@CurrentUser()`. Có 4 vai trò rõ ràng: `ADMIN`, `STAFF`, `PT`, `MEMBER`.
5. **Đồng bộ Schema**: Sau khi sửa `packages/database/prisma/schema.prisma`, phải chạy `pnpm --filter @gym/database db:generate` và `pnpm --filter @gym/contracts build`.

---

### 3. QUY TẮC NGHIỆP VỤ PHÒNG GYM CỐT LÕI (DOMAIN RULES)
- **Mã định danh tự sinh chuẩn hóa**:
  * Hội viên: `MEM-XXXXXXXX`
  * Nhân viên / PT: `EMP-XXXXXXXX`
  * Biên lai thanh toán: `REC-YYYYMMDD-XXXX`
- **Ảnh thẻ định danh hội viên (`idPhotoUrl`)**: 
  * Là ảnh nhận diện tại cổng quẹt thẻ, do Lễ tân chụp qua Webcam tại quầy (hoặc qua camera trực tiếp).
  * Hội viên (`MEMBER`) KHÔNG ĐƯỢC tự ý sửa ảnh trên app (nút đổi ảnh phải bị khóa). Muốn đổi ảnh phải đến quầy lễ tân đối chiếu CCCD.
- **Vòng đời gói tập (Subscription Lifecycle)**:
  * Trạng thái: `UPCOMING`, `ACTIVE`, `SUSPENDED`, `CANCELLED` (và suy diễn `EXPIRED` qua `endDate`).
  * Kích hoạt: Hỗ trợ kích hoạt đúng ngày hẹn (JIT - Just In Time) hoặc kích hoạt sớm hôm nay (`activate-now`).
  * Gia hạn (Renewal Queueing): Gói gia hạn mới tự động nối đuôi (`startDate` mới = `endDate` cũ) và liên kết `previousSubscriptionId`.
- **Động cơ Quota 2 pha**:
  * Đặt lịch: `reserve` (giữ lượt khả dụng).
  * Điểm danh vào lớp / ca tập: `consumeReserved` (trừ lượt chính thức từ reserved sang used).
  * Hủy lịch đúng giờ: `refundReserved` (trả lại lượt khả dụng).
  * Bỏ buổi (`NO_SHOW`): Trừ mất lượt (không hoàn).
- **Kiểm soát cổng (Check-in Access Control)**:
  * Kiểm tra gói `ACTIVE` và đã thanh toán `PAID`.
  * Có cơ chế **Anti-passback 5 phút** chống quẹt thẻ liên tiếp cho người khác mượn vào cùng.
- **Chính sách Huỷ lịch đặt chỗ (Cancellation Policies)**:
  * Lớp học nhóm (`ClassBooking`): Cho phép hội viên tự huỷ trước giờ học tối thiểu **2 tiếng**.
  * Lịch tập 1-1 (`PtBooking`): Cho phép hội viên tự huỷ trước giờ tập tối thiểu **6 tiếng**.
- **Quản lý Xếp ca & Chống xung đột Lịch (Scheduling & Conflicts)**:
  * Thời lượng mỗi ca học nhóm từ **30 đến 180 phút**.
  * Chống trùng chéo 2 chiều: Huấn luyện viên không được dạy 2 ca trùng giờ (cả lớp nhóm lẫn lịch PT 1-1). Hội viên không thể đặt 2 lịch tập cùng khung giờ.
- **Bảo lưu gói tập (Subscription Freezes)**:
  * Thời hạn 7 - 60 ngày, tối đa 2 lần/gói.
  * Tạm khóa cổng (`SUSPENDED`). Khi mở bảo lưu (`restoredAt`), tự động cộng bù số ngày đã nghỉ vào `endDate` và dời chuỗi gia hạn kế tiếp.
- **Thanh toán & Thu ngân (Payments & Billing)**:
  * Hỗ trợ `CASH`, `TRANSFER`, `CARD`. Xuất biên lai `REC-YYYYMMDD-XXXX`.
  * Chỉ `ADMIN` mới có quyền duyệt hoàn tiền (`REFUND`).

---

### 4. BẢNG LỆNH KIỂM TRA MÃ NGUỒN (COMMANDS CHEATSHEET)
Trước khi kết thúc bất kỳ task nào, Agent luôn phải đảm bảo các lệnh sau pass 100%:
- Kiểm tra kiểu dữ liệu: `pnpm turbo run typecheck`
- Kiểm tra chuẩn Lint (Strict): `pnpm turbo run lint`
- Build toàn bộ monorepo: `pnpm turbo run build`
- Sinh lại Prisma Client: `pnpm --filter @gym/database db:generate`
- Chạy integration test backend: `pnpm --filter @gym/api test`

---

### 5. NHỮNG ĐIỀU CẤM TRONG CODE (CODE DON'TS)
- ❌ KHÔNG dùng kiểu dữ liệu `any` bừa bãi. Phải dùng type chặt chẽ từ `@gym/contracts`.
- ❌ KHÔNG để lại các biến thừa không dùng trong code và test (gây lỗi ESLint `@typescript-eslint/no-unused-vars` trên CI).
- ❌ KHÔNG hardcode connection string, secret keys, mật khẩu vào mã nguồn. Luôn lấy qua `ConfigService`.
- ❌ KHÔNG tự ý xóa các comment giải thích nghiệp vụ hoặc docstrings đã có.
- ❌ KHÔNG bypass phân quyền RBAC hoặc tạo các backdoor endpoint mà không có guard bảo vệ.

---

### 6. QUY TẮC THIẾT KẾ UI/UX & CHỐNG GIAO DIỆN KIỂU AI (ANTI-AI SLOP UI RULES)
Khi xây dựng giao diện trên `@gym/web` (Aura Gym — Dark `#09090B` + Fiery Orange `#FF5500` + Font `Oswald` / `Geist`), Agent BẮT BUỘC tuân thủ:
1. ❌ **KHÔNG đưa ngôn ngữ kỹ thuật/kiến trúc lên UI**: Tuyệt đối không hiển thị tên API endpoint (`GET / POST /...`), thuật ngữ hệ thống (`RBAC`, `ACID`, `Quota 2 pha`, `Anti-passback`, `Seed Account`), hoặc badge kỹ thuật (`API Connected`, `[ROLE: ADMIN]`) lên màn hình người dùng.
2. ❌ **KHÔNG lạm dụng "AI Card Pattern"**: Cấm lặp lại bố cục máy móc gồm *(Pill badge nhỏ trên đầu tiêu đề + Hộp vuông chứa icon màu nhạt + Đoạn văn giải thích 3 dòng)*.
3. ❌ **KHÔNG viết văn mô tả tính năng trong Dashboard**: Trong `/dashboard/*`, đi thẳng vào **Bảng dữ liệu (`Table`), Thanh công cụ tìm kiếm/lọc (`Toolbar`), Form thao tác và Số liệu KPI tối giản**. Không tạo các card chỉ để "giới thiệu chức năng".
4. ❌ **KHÔNG thêm dòng chú thích phụ (`sublabel`) trong Sidebar/Menu**: Thanh điều hướng giữ gọn gàng, chỉ gồm `Icon + Nhãn ngắn gọn 1–3 từ`.
5. ❌ **KHÔNG dùng hộp icon/con số giả lập thay cho Hình ảnh thật trên trang Public/Auth**: Trang Landing Page và Login phải ưu tiên nhiếp ảnh phòng tập tương phản cao (B&W / Dark Moody) và câu chữ cô đọng (tối đa 1–2 dòng mỗi khối).

