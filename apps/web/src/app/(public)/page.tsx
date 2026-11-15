'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowRight, Flame, Star } from 'lucide-react';
import {
  ScheduleStatus,
  type PaginatedClassesResponse,
  type PaginatedClassSchedulesResponse,
} from '@gym/contracts';
import { PublicPlansSection } from '@/features/membership-plans/public-plans-section';
import { MemberAvatar } from '@/components/shared/member-avatar';
import { DataState } from '@/components/shared/data-state';
import { apiClient } from '@/services/api-client';

interface ProgramCardItem {
  title: string;
  description: string;
  image: string;
}

const PROGRAM_IMAGES = [
  'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1000&q=80',
  'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?auto=format&fit=crop&w=1000&q=80',
  'https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=1000&q=80',
  'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?auto=format&fit=crop&w=1000&q=80',
];

interface PublicScheduleRow {
  day: string;
  slots: ReadonlyArray<string>;
}

interface PublicTrainerCard {
  name: string;
  role: string;
}

const WEEKDAY_LABELS = [
  'Chủ nhật',
  'Thứ Hai',
  'Thứ Ba',
  'Thứ Tư',
  'Thứ Năm',
  'Thứ Sáu',
  'Thứ Bảy',
] as const;

function formatSlotWindow(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return '';
  const fmt = (dt: Date) =>
    dt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return `${fmt(s)} - ${fmt(e)}`;
}

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [programs, setPrograms] = useState<ReadonlyArray<ProgramCardItem>>([]);
  const [scheduleColumns, setScheduleColumns] = useState<ReadonlyArray<string>>(
    [],
  );
  const [scheduleRows, setScheduleRows] = useState<
    ReadonlyArray<PublicScheduleRow>
  >([]);
  const [trainers, setTrainers] = useState<ReadonlyArray<PublicTrainerCard>>(
    [],
  );

  useEffect(() => {
    let active = true;

    const timer = window.setTimeout(() => {
      void (async () => {
        const [classesRes, schedulesRes] = await Promise.allSettled([
          apiClient.get<PaginatedClassesResponse>('/classes?limit=20'),
          apiClient.get<PaginatedClassSchedulesResponse>(
            '/class-schedules?limit=60',
          ),
        ]);

        if (!active) return;
        setLoading(false);
        setLoadError(
          classesRes.status === 'rejected' || schedulesRes.status === 'rejected'
            ? 'Chưa thể tải chương trình và lịch tập. Vui lòng thử lại.'
            : '',
        );

        const activeClasses =
          classesRes.status === 'fulfilled'
            ? classesRes.value.data.filter((c) => c.isActive)
            : [];

        setPrograms(
          activeClasses.slice(0, 4).map((cls, idx) => ({
            title: cls.name.toUpperCase(),
            description:
              cls.description ||
              'Chương trình huấn luyện chuyên sâu cùng đội ngũ huấn luyện viên Aura Gym.',
            image: PROGRAM_IMAGES[idx % PROGRAM_IMAGES.length]!,
          })),
        );

        if (schedulesRes.status === 'fulfilled') {
          const weekStart = new Date();
          weekStart.setDate(
            weekStart.getDate() - (weekStart.getDay() || 7) + 1,
          );
          weekStart.setHours(0, 0, 0, 0);
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 7);
          const validSchedules = schedulesRes.value.data.filter(
            (s) =>
              s.status === ScheduleStatus.SCHEDULED &&
              new Date(s.startsAt) >= weekStart &&
              new Date(s.startsAt) < weekEnd,
          );

          // Build up to 5 columns from active classes or scheduled class names
          const colNames = Array.from(
            new Set([
              ...activeClasses.map((c) => c.name),
              ...validSchedules.map((s) => s.className),
            ]),
          ).slice(0, 5);

          setScheduleColumns(colNames);

          const targetDays = [
            'Thứ Hai',
            'Thứ Ba',
            'Thứ Tư',
            'Thứ Năm',
            'Thứ Sáu',
            'Thứ Bảy',
            'Chủ nhật',
          ];

          const rows: PublicScheduleRow[] = targetDays.map((dayName) => {
            const slots = colNames.map((colName) => {
              const matches = validSchedules.filter((sch) => {
                const d = new Date(sch.startsAt);
                const schDay = WEEKDAY_LABELS[d.getDay()];
                return schDay === dayName && sch.className === colName;
              });
              return (
                matches
                  .map((match) =>
                    formatSlotWindow(match.startsAt, match.endsAt),
                  )
                  .join(' · ') || '—'
              );
            });
            return { day: dayName, slots };
          });

          setScheduleRows(rows);

          // Extract distinct trainers from live class schedules
          const trainerMap = new Map<string, string>();
          for (const sch of validSchedules) {
            if (sch.trainerName && !trainerMap.has(sch.trainerName)) {
              trainerMap.set(sch.trainerName, `Coach ${sch.className}`);
            }
          }

          setTrainers(
            Array.from(trainerMap.entries())
              .slice(0, 4)
              .map(([name, role]) => ({
                name,
                role,
              })),
          );
        }
      })();
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [reloadKey]);

  return (
    <div className="space-y-24 pb-20">
      {/* 1. HERO SECTION */}
      <section className="relative overflow-hidden border-b border-zinc-900">
        <div className="mx-auto grid max-w-7xl items-center gap-8 px-6 pt-10 pb-16 lg:grid-cols-12 lg:py-20">
          <div className="z-10 space-y-6 lg:col-span-6">
            <h1 className="font-heading text-6xl leading-[0.98] font-bold tracking-tight uppercase text-white sm:text-7xl">
              BỨT PHÁ <br />
              <span className="text-[#FF5500]">GIỚI HẠN</span>
            </h1>

            <p className="max-w-md text-sm leading-relaxed text-zinc-400">
              Tham gia cộng đồng rèn luyện thể hình chuẩn quốc tế — nơi mục tiêu
              được chinh phục bằng kỷ luật, sức mạnh và lộ trình bài bản.
            </p>

            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Link
                href="/login"
                className="rounded-[10px] bg-[#FF5500] px-7 py-3 text-xs font-semibold text-white transition-colors hover:bg-[#e04b00]"
              >
                Bắt đầu ngay
              </Link>
              <Link
                href="#programs"
                className="rounded-[10px] border border-[#FF5500] px-7 py-3 text-xs font-semibold text-white transition-colors hover:bg-[#FF5500]/10"
              >
                Khám phá thêm
              </Link>
            </div>
          </div>

          <div className="relative lg:col-span-6">
            <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-zinc-950">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://images.unsplash.com/photo-1526506118085-60ce8714f8c5?auto=format&fit=crop&w=1400&q=85"
                alt="Aura Gym Athlete"
                className="h-full w-full object-cover object-center grayscale contrast-125"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-[#09090B] via-transparent to-[#09090B]/60" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#09090B] via-transparent to-transparent" />
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-6">
        <DataState
          loading={loading}
          error={loadError}
          variant="cards"
          onRetry={() => {
            setLoading(true);
            setReloadKey((key) => key + 1);
          }}
        />
      </div>
      {/* 2. OUR PROGRAMS (Fetched from GET /classes) */}
      <section id="programs" className="mx-auto max-w-6xl px-6">
        <div className="mb-10 text-center">
          <h2 className="font-heading text-3xl font-bold tracking-wide uppercase text-white sm:text-4xl">
            CHƯƠNG TRÌNH HUẤN LUYỆN
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-xs text-zinc-400">
            Lựa chọn bộ môn phù hợp nhất với thể trạng và mục tiêu hình thể của
            bạn.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {programs.map((prog) => (
            <Link
              key={prog.title}
              href="/login"
              className="group relative flex h-64 items-end overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950 p-6"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={prog.image}
                alt={prog.title}
                className="absolute inset-0 h-full w-full object-cover grayscale transition-transform duration-500 group-hover:scale-105 group-hover:grayscale-0"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/50 to-black/10" />

              <div className="relative z-10 flex w-full items-end justify-between gap-4">
                <div>
                  <h3 className="font-heading text-xl font-bold tracking-wide uppercase text-white">
                    {prog.title}
                  </h3>
                  <p className="mt-1 max-w-xs text-xs leading-relaxed text-zinc-300">
                    {prog.description}
                  </p>
                </div>

                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FF5500] text-white transition-transform group-hover:translate-x-1">
                  <ArrowRight className="h-4 w-4" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* 3. GIVE SHAPE TO YOUR BODY */}
      <section className="mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-10 md:grid-cols-12">
          <div className="overflow-hidden rounded-xl md:col-span-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://images.unsplash.com/photo-1550345332-09e3ac987658?auto=format&fit=crop&w=1000&q=80"
              alt="Kiến tạo hình thể"
              className="aspect-[4/3] w-full object-cover grayscale contrast-125"
            />
          </div>

          <div className="space-y-4 md:col-span-6 md:pl-4">
            <h2 className="font-heading text-3xl leading-tight font-bold uppercase text-white sm:text-4xl">
              KIẾN TẠO VÓC DÁNG <br />
              VỮNG CHẮC MỖI NGÀY
            </h2>
            <p className="max-w-md text-xs leading-relaxed text-zinc-400">
              Tại <span className="font-semibold text-[#FF5500]">AURAGYM</span>,
              chúng tôi đồng hành cùng bạn xây dựng nền tảng thể lực, sự tự tin
              và thói quen tập luyện bền vững dưới sự dẫn dắt của đội ngũ HLV
              chuyên nghiệp.
            </p>
            <div className="pt-2">
              <Link
                href="#packages"
                className="inline-block rounded-[10px] bg-[#FF5500] px-7 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#e04b00]"
              >
                Xem các gói tập
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 4. OUR SCHEDULE (Fetched from GET /class-schedules) */}
      <section id="schedule" className="mx-auto max-w-5xl px-6">
        <div className="mb-8 text-center">
          <h2 className="font-heading text-3xl font-bold tracking-wide uppercase text-white sm:text-4xl">
            LỊCH LỚP HỌC TRONG TUẦN
          </h2>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[680px] space-y-2">
            <div className="grid grid-cols-6 gap-2">
              <div className="flex items-center justify-center rounded bg-[#FF5500] py-3 text-xs font-bold text-white">
                Bộ môn
              </div>
              {scheduleColumns.map((col) => (
                <div
                  key={col}
                  className="flex items-center justify-center rounded border border-zinc-800 bg-[#0d0d0f] px-2 py-3 text-center text-xs text-zinc-300"
                >
                  {col}
                </div>
              ))}
            </div>

            {scheduleRows.map((row) => (
              <div key={row.day} className="grid grid-cols-6 gap-2">
                <div className="flex items-center justify-center rounded border border-zinc-800 bg-[#0d0d0f] py-3 text-xs font-semibold text-[#FF5500]">
                  {row.day}
                </div>
                {row.slots.map((slot, idx) => (
                  <div
                    key={`${row.day}-${idx}`}
                    className="flex items-center justify-center rounded border border-zinc-800/80 bg-[#09090B] py-3 text-[11px] tabular-nums text-zinc-300"
                  >
                    {slot}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. EXPERIENCED TRAINERS PROGRESS SECTION */}
      <section className="mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-10 md:grid-cols-12">
          <div className="relative md:col-span-6">
            <div className="absolute top-6 -left-3 h-5 w-16 -skew-x-12 bg-[#FF5500]" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://images.unsplash.com/photo-1571902943202-507ec2618e8f?auto=format&fit=crop&w=1000&q=80"
              alt="Huấn luyện viên chuyên nghiệp"
              className="aspect-[16/10] w-full rounded-lg object-cover"
            />
          </div>

          <div className="space-y-5 md:col-span-6">
            <div>
              <h3 className="font-heading text-2xl leading-snug font-bold uppercase text-white">
                NÂNG TẦM THỂ LỰC CÙNG ĐỘI NGŨ <br />
                HUẤN LUYỆN VIÊN GIÀU KINH NGHIỆM
              </h3>
              <p className="mt-1.5 text-xs text-zinc-400">
                Giáo án cá nhân hóa sát với thể trạng từng hội viên, cam kết
                đồng hành xuyên suốt lộ trình tập luyện.
              </p>
            </div>

            <div className="space-y-4 pt-1">
              {[
                { label: 'Strength & Conditioning', pct: 94 },
                { label: 'Cardio & HIIT Burn', pct: 82 },
                { label: 'Bodybuilding & Hypertrophy', pct: 88 },
              ].map((bar) => (
                <div key={bar.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs italic text-zinc-200">
                    <span>{bar.label}</span>
                    <span className="tabular-nums">{bar.pct}%</span>
                  </div>
                  <div className="h-1 w-full bg-zinc-800">
                    <div
                      className="h-full bg-[#FF5500]"
                      style={{ width: `${bar.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 6. PRICING PACKAGES (Fetched from GET /membership-plans/public) */}
      <section id="packages" className="mx-auto max-w-6xl px-6">
        <div className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <h2 className="font-heading text-2xl leading-tight font-bold uppercase text-white sm:text-3xl">
            KHỞI ĐẦU MỤC TIÊU HÌNH THỂ <br />
            VỚI GÓI PASS PHÙ HỢP
          </h2>
          <p className="max-w-md text-xs leading-relaxed text-zinc-400">
            Lựa chọn gói thẻ hội viên linh hoạt theo nhu cầu tập Full Gym, Group
            Class năng động hoặc kèm riêng PT 1-1.
          </p>
        </div>

        <PublicPlansSection />
      </section>

      {/* 7. OUR TRAINERS (Fetched from active scheduled trainers) */}
      <section id="trainers" className="mx-auto max-w-6xl px-6">
        <div className="mb-8">
          <h2 className="font-heading text-2xl font-bold uppercase text-white sm:text-3xl">
            ĐỘI NGŨ PT &amp; COACH
          </h2>
          <p className="mt-1 max-w-xs text-xs text-zinc-400">
            Chuyên môn vững vàng, tận tâm hướng dẫn kỹ thuật chuẩn xác trong
            từng buổi tập.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {trainers.map((trainer) => (
            <div key={trainer.name} className="group text-center">
              <MemberAvatar
                fullName={trainer.name}
                aspect="portrait"
                size="xl"
                className="mx-auto"
              />
              <h3 className="mt-3 text-sm font-semibold text-white">
                {trainer.name}
              </h3>
              <p className="text-[11px] text-zinc-400">{trainer.role}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 8. MEMBER TESTIMONIALS */}
      <section className="mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-8 md:grid-cols-12">
          <div className="space-y-3 md:col-span-4">
            <h2 className="font-heading text-3xl leading-tight font-bold uppercase text-white">
              CẢM NHẬN TỪ <br />
              <span className="text-[#FF5500]">HỘI VIÊN AURA GYM</span>
            </h2>
            <p className="text-xs text-zinc-400">
              Hơn 10.000+ hội viên tin tưởng tập luyện
            </p>
          </div>

          <div className="border border-[#FF5500]/60 bg-[#0d0d0f] p-8 md:col-span-8">
            <div className="mb-4 flex items-center justify-center gap-1 text-[#FF5500]">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="h-3.5 w-3.5 fill-current" />
              ))}
            </div>
            <p className="mx-auto max-w-xl text-center text-xs leading-relaxed text-zinc-300">
              <span className="font-serif text-base text-[#FF5500]">“</span>
              Đăng ký tập luyện tại Aura Gym là quyết định tuyệt vời nhất cho
              sức khỏe của mình. Huấn luyện viên theo sát từng động tác, không
              gian tập hiện đại và mình đã thấy rõ sự thay đổi về sức bền lẫn
              hình thể chỉ sau 3 tháng.
              <span className="font-serif text-base text-[#FF5500]">”</span>
            </p>
            <div className="mt-6 flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-300">
                Lê Minh Khôi — Hội viên chính thức
              </span>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#FF5500] text-white">
                <ArrowRight className="h-3 w-3" />
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 9. FULL-BLEED CTA BANNER */}
      <section className="relative overflow-hidden py-20">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=1600&q=80"
          alt="Tham gia Aura Gym"
          className="absolute inset-0 h-full w-full object-cover grayscale"
        />
        <div className="absolute inset-0 bg-black/80" />
        <div className="relative z-10 mx-auto max-w-3xl px-6 text-center">
          <h2 className="font-heading text-4xl font-bold uppercase text-white sm:text-5xl">
            BẮT ĐẦU HÀNH TRÌNH{' '}
            <span className="text-[#FF5500]">CHINH PHỤC THỂ HÌNH</span> CÙNG
            CHÚNG TÔI
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-xs leading-relaxed text-zinc-300">
            Hệ thống thiết bị chuẩn quốc tế, lộ trình cá nhân hóa và đội ngũ
            huấn luyện viên luôn sẵn sàng đồng hành cùng bạn mỗi ngày.
          </p>
          <div className="mt-6">
            <Link
              href="/login"
              className="inline-block rounded-[10px] bg-[#FF5500] px-7 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#e04b00]"
            >
              Đăng ký ngay
            </Link>
          </div>
        </div>
      </section>

      {/* 10. FOOTER */}
      <footer className="mx-auto max-w-6xl border-t border-zinc-900 px-6 pt-12">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 fill-[#FF5500] text-[#FF5500]" />
              <span className="font-heading text-lg font-bold tracking-wider uppercase text-white">
                AURA<span className="text-[#FF5500]">GYM</span>
              </span>
            </div>
            <p className="text-xs leading-relaxed text-zinc-500">
              Hệ thống câu lạc bộ thể hình, lớp tập nhóm chuyên sâu và huấn
              luyện viên cá nhân 1-1 hàng đầu.
            </p>
          </div>

          <div>
            <h3 className="font-heading text-sm font-bold uppercase text-white">
              VỀ CHÚNG TÔI
            </h3>
            <ul className="mt-3 space-y-2 text-xs text-zinc-400">
              <li>
                <Link href="/#programs" className="hover:text-white">
                  Chương trình tập
                </Link>
              </li>
              <li>
                <Link href="/#packages" className="hover:text-white">
                  Bảng giá gói tập
                </Link>
              </li>
              <li>
                <Link href="/#trainers" className="hover:text-white">
                  Đội ngũ HLV
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-heading text-sm font-bold uppercase text-white">
              DỊCH VỤ
            </h3>
            <ul className="mt-3 space-y-2 text-xs text-zinc-400">
              <li>Personal Trainer (PT 1-1)</li>
              <li>Group Class / Group X</li>
              <li>Full Gym Member Pass</li>
            </ul>
          </div>

          <div>
            <h3 className="font-heading text-sm font-bold uppercase text-white">
              LIÊN HỆ
            </h3>
            <ul className="mt-3 space-y-2 text-xs tabular-nums text-zinc-400">
              <li>Email: info@auragym.vn</li>
              <li>Hotline: 0901 234 567</li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-zinc-900 pt-6 text-center text-[11px] text-zinc-600">
          Bản quyền © 2026 Aura Gym. Bảo lưu mọi quyền.
        </div>
      </footer>
    </div>
  );
}
