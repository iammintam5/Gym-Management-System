import Link from 'next/link';
import { ArrowRight, Flame, Star } from 'lucide-react';
import { PublicPlansSection } from '@/features/membership-plans/public-plans-section';

const PROGRAMS = [
  {
    title: 'PERSONAL TRAINING',
    description:
      'Huấn luyện 1-1 thiết kế riêng theo thể trạng, mục tiêu và lịch trình của bạn.',
    image:
      'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1000&q=80',
  },
  {
    title: 'STRENGTH TRAINING',
    description:
      'Phát triển cơ bắp, gia tăng sức mạnh và bứt phá giới hạn thể chất.',
    image:
      'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?auto=format&fit=crop&w=1000&q=80',
  },
  {
    title: 'HIIT CLASSES',
    description:
      'Lớp tập cường độ cao đốt cháy năng lượng tối đa và tăng sức bền trong thời gian ngắn.',
    image:
      'https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=1000&q=80',
  },
  {
    title: 'FITNESS TRAINING',
    description:
      'Cân bằng vóc dáng, cải thiện độ dẻo dai và duy trì nguồn năng lượng tích cực mỗi ngày.',
    image:
      'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?auto=format&fit=crop&w=1000&q=80',
  },
] as const;

const SCHEDULE_COLUMNS = [
  'Flexibility',
  'Cardio',
  'HIIT',
  'Bodybuilding',
  'Crossfit',
] as const;

const SCHEDULE_ROWS: ReadonlyArray<{
  day: string;
  slots: readonly [string, string, string, string, string];
}> = [
  {
    day: 'Monday',
    slots: ['9:00am-1:00pm', '', '11:00am-2:00pm', '9:00am-1:00pm', '9:00am-1:00pm'],
  },
  {
    day: 'Tuesday',
    slots: ['', '10:00am-2:00pm', '', '', '9:00am-1:00pm'],
  },
  {
    day: 'Wed',
    slots: ['9:00am-2:00pm', '10:00am-2:00pm', '', '11:00am-2:00pm', '9:00am-1:00pm'],
  },
  {
    day: 'Thursday',
    slots: ['9:00am-2:00pm', '', '9:00am-2:00pm', '11:00am-2:00pm', ''],
  },
  {
    day: 'Friday',
    slots: ['9:00am-2:00pm', '', '9:00am-2:00pm', '11:00am-2:00pm', ''],
  },
  {
    day: 'Saturday',
    slots: [
      '9:00am-1:00pm',
      '8:00am-1:00pm',
      '9:00am-2:00pm',
      '11:00am-2:00pm',
      '8:00am-1:00pm',
    ],
  },
];

const TRAINERS = [
  {
    name: 'Mike Ross',
    role: 'Fitness Coach',
    image:
      'https://images.unsplash.com/photo-1567013127542-490d757e51fc?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Steven Harvey',
    role: 'Bodybuilding Coach',
    image:
      'https://images.unsplash.com/photo-1583454110551-21f2fa2afe61?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Donna Paulsen',
    role: 'HIIT Coach',
    image:
      'https://images.unsplash.com/photo-1594381898411-846e7d193883?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Jessica Williams',
    role: 'Fitness Coach',
    image:
      'https://images.unsplash.com/photo-1548690312-e3b507d8c110?auto=format&fit=crop&w=800&q=80',
  },
] as const;

export default function Home() {
  return (
    <div className="space-y-24 pb-20">
      {/* 1. HERO SECTION */}
      <section className="relative overflow-hidden border-b border-zinc-900">
        <div className="mx-auto grid max-w-7xl items-center gap-8 px-6 pt-10 pb-16 lg:grid-cols-12 lg:py-20">
          <div className="z-10 space-y-6 lg:col-span-6">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest uppercase text-zinc-300">
              <Flame className="h-3.5 w-3.5 fill-[#FF5500] text-[#FF5500]" />
              <span>TRANSFORM YOUR LIFE TODAY</span>
            </div>

            <h1 className="font-heading text-6xl leading-[0.98] font-bold tracking-tight uppercase text-white sm:text-7xl">
              UNLEASH YOUR <br />
              <span className="text-[#FF5500]">POTENTIAL</span>
            </h1>

            <p className="max-w-md text-sm leading-relaxed text-zinc-400">
              Join a community where goals are crushed, strength is built, and
              potential becomes power.
            </p>

            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Link
                href="/login"
                className="rounded-full bg-[#FF5500] px-7 py-3 text-xs font-semibold text-white transition-colors hover:bg-[#e04b00]"
              >
                Get Started
              </Link>
              <Link
                href="#programs"
                className="rounded-full border border-[#FF5500] px-7 py-3 text-xs font-semibold text-white transition-colors hover:bg-[#FF5500]/10"
              >
                Explore More
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

      {/* 2. OUR PROGRAMS */}
      <section id="programs" className="mx-auto max-w-6xl px-6">
        <div className="mb-10 text-center">
          <h2 className="font-heading text-3xl font-bold tracking-wide uppercase text-white sm:text-4xl">
            OUR PROGRAMS
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-xs text-zinc-400">
            Discover the perfect programs to match your goals and fitness level.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {PROGRAMS.map((prog) => (
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
              alt="Give shape to your body"
              className="aspect-[4/3] w-full object-cover grayscale contrast-125"
            />
          </div>

          <div className="space-y-4 md:col-span-6 md:pl-4">
            <h2 className="font-heading text-3xl leading-tight font-bold uppercase text-white sm:text-4xl">
              GIVE SHAPE TO <br />
              YOUR BODY
            </h2>
            <p className="max-w-md text-xs leading-relaxed text-zinc-400">
              At <span className="font-semibold text-[#FF5500]">AURAGYM</span>,
              we help you build strength, confidence, and lasting habits. With
              expert coaches and proven programs, we guide you toward your best
              shape.
            </p>
            <div className="pt-2">
              <Link
                href="#packages"
                className="inline-block rounded-full bg-[#FF5500] px-7 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#e04b00]"
              >
                Explore More
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 4. OUR SCHEDULE */}
      <section id="schedule" className="mx-auto max-w-5xl px-6">
        <div className="mb-8 text-center">
          <h2 className="font-heading text-3xl font-bold tracking-wide uppercase text-white sm:text-4xl">
            OUR SCHEDULE
          </h2>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[680px] space-y-2">
            <div className="grid grid-cols-6 gap-2">
              <div className="flex items-center justify-center rounded bg-[#FF5500] py-3 text-xs font-bold text-white">
                Classes
              </div>
              {SCHEDULE_COLUMNS.map((col) => (
                <div
                  key={col}
                  className="flex items-center justify-center rounded border border-zinc-800 bg-[#0d0d0f] py-3 text-xs text-zinc-300"
                >
                  {col}
                </div>
              ))}
            </div>

            {SCHEDULE_ROWS.map((row) => (
              <div key={row.day} className="grid grid-cols-6 gap-2">
                <div className="flex items-center justify-center rounded border border-zinc-800 bg-[#0d0d0f] py-3 text-xs font-semibold text-[#FF5500]">
                  {row.day}
                </div>
                {row.slots.map((slot, idx) => (
                  <div
                    key={`${row.day}-${idx}`}
                    className="flex items-center justify-center rounded border border-zinc-800/80 bg-[#09090B] py-3 text-[11px] text-zinc-300"
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
              alt="Group Training"
              className="aspect-[16/10] w-full rounded-lg object-cover"
            />
          </div>

          <div className="space-y-5 md:col-span-6">
            <div>
              <h3 className="font-heading text-2xl leading-snug font-bold uppercase text-white">
                GET STRONGER AND FITTER WITH OUR <br />
                EXPERIENCED TRAINERS
              </h3>
              <p className="mt-1.5 text-xs text-zinc-400">
                Build strength and confidence with support from our expert
                trainers, dedicated to your success.
              </p>
            </div>

            <div className="space-y-4 pt-1">
              {[
                { label: 'Fitness Training', pct: 94 },
                { label: 'Cardio Training', pct: 82 },
                { label: 'Body Building', pct: 88 },
              ].map((bar) => (
                <div key={bar.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs italic text-zinc-200">
                    <span>{bar.label}</span>
                    <span>{bar.pct}%</span>
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

      {/* 6. PRICING PACKAGES */}
      <section id="packages" className="mx-auto max-w-6xl px-6">
        <div className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <h2 className="font-heading text-2xl leading-tight font-bold uppercase text-white sm:text-3xl">
            START YOUR BODY GOAL FROM <br />
            CHOOSING OUR PACKAGE
          </h2>
          <p className="max-w-md text-xs leading-relaxed text-zinc-400">
            Kickstart your fitness journey with a package tailored to your
            needs. Whether you are aiming to build strength, lose weight, or
            improve overall wellness.
          </p>
        </div>

        <PublicPlansSection />
      </section>

      {/* 7. OUR TRAINERS */}
      <section id="trainers" className="mx-auto max-w-6xl px-6">
        <div className="mb-8">
          <h2 className="font-heading text-2xl font-bold uppercase text-white sm:text-3xl">
            OUR TRAINERS
          </h2>
          <p className="mt-1 max-w-xs text-xs text-zinc-400">
            Expert, friendly, and dedicated — our trainers are here to guide,
            motivate, and support you every step of the way.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {TRAINERS.map((trainer) => (
            <div key={trainer.name} className="group text-center">
              <div className="overflow-hidden bg-zinc-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={trainer.image}
                  alt={trainer.name}
                  className="aspect-[3/4] w-full object-cover grayscale transition-all duration-500 group-hover:scale-105 group-hover:grayscale-0"
                />
              </div>
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
              WHAT <span className="text-[#FF5500]">OUR MEMBERS</span> <br />
              SAY ABOUT US ?
            </h2>
            <p className="text-xs text-zinc-400">10k+ Satisfied Customers</p>
          </div>

          <div className="border border-[#FF5500]/60 bg-[#0d0d0f] p-8 md:col-span-8">
            <div className="mb-4 flex items-center justify-center gap-1 text-[#FF5500]">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="h-3.5 w-3.5 fill-current" />
              ))}
            </div>
            <p className="mx-auto max-w-xl text-center text-xs leading-relaxed text-zinc-300">
              <span className="font-serif text-base text-[#FF5500]">“</span>
              Joining Aura Gym has been one of the best decisions I&apos;ve made
              for my health. The trainers are super supportive, the environment
              is motivating, and I&apos;ve seen real results in both strength
              and stamina.
              <span className="font-serif text-base text-[#FF5500]">”</span>
            </p>
            <div className="mt-6 flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-300">
                Ashely Paulene
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
          alt="Join Aura Gym"
          className="absolute inset-0 h-full w-full object-cover grayscale"
        />
        <div className="absolute inset-0 bg-black/80" />
        <div className="relative z-10 mx-auto max-w-3xl px-6 text-center">
          <p className="text-[11px] font-semibold tracking-widest uppercase text-zinc-300">
            JOIN OUR MEMBERSHIP
          </p>
          <h2 className="mt-2 font-heading text-4xl font-bold uppercase text-white sm:text-5xl">
            LET&apos;S START <span className="text-[#FF5500]">YOUR BODY GOAL</span>{' '}
            WITH US
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-xs leading-relaxed text-zinc-300">
            Join our gym today for expert guidance, top-notch equipment, and a
            supportive community ready to help you crush your fitness goals.
          </p>
          <div className="mt-6">
            <Link
              href="/login"
              className="inline-block rounded-full bg-[#FF5500] px-7 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#e04b00]"
            >
              Sign Up Now
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
              Gym fitness dedicated for a training center or personal trainer.
              Suitable to work with sport related websites such as crossfit,
              bodybuilding or HIIT.
            </p>
          </div>

          <div>
            <h3 className="font-heading text-sm font-bold uppercase text-white">
              COMPANY
            </h3>
            <ul className="mt-3 space-y-2 text-xs text-zinc-400">
              <li>
                <Link href="/#programs" className="hover:text-white">
                  About Us
                </Link>
              </li>
              <li>
                <Link href="/#packages" className="hover:text-white">
                  Pricing Plans
                </Link>
              </li>
              <li>
                <Link href="/#trainers" className="hover:text-white">
                  Our Trainers
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-heading text-sm font-bold uppercase text-white">
              PROGRAMS
            </h3>
            <ul className="mt-3 space-y-2 text-xs text-zinc-400">
              <li>Personal Trainer</li>
              <li>Group Practice Class</li>
              <li>Training Package</li>
            </ul>
          </div>

          <div>
            <h3 className="font-heading text-sm font-bold uppercase text-white">
              CONTACT US
            </h3>
            <ul className="mt-3 space-y-2 text-xs text-zinc-400">
              <li>info@auragym.vn</li>
              <li>+84 901 234 567</li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-zinc-900 pt-6 text-center text-[11px] text-zinc-600">
          Copyright © 2026 Aura Gym. All Rights Reserved.
        </div>
      </footer>
    </div>
  );
}
