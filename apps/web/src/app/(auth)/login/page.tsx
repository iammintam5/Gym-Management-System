import { PageHeader } from '@gym/ui';
import { LoginForm } from '@/features/auth/login-form';
export default function LoginPage() {
  return (
    <section className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-8">
      <PageHeader title="Đăng nhập">
        Chức năng đang được phát triển. Chưa có tài khoản đăng nhập.
      </PageHeader>
      <LoginForm />
    </section>
  );
}
