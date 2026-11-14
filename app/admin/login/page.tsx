"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getSupabaseBrowserClient,
  getSupabasePublicConfig,
} from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/admin/candidates";
  const config = useMemo(() => getSupabasePublicConfig(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!config.ready) {
      setError("Supabase 환경변수가 설정되지 않았습니다.");
      return;
    }
    setPending(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        setError(signInError.message);
        return;
      }
      router.replace(next);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="admin-main">
      <p className="kicker">Admin</p>
      <h1 className="admin-title">검토를 위해 로그인하세요.</h1>
      <p className="admin-lead">
        관리자 역할(<code>profiles.role = admin</code>)이 있는 계정만 후보를 승인할 수 있습니다.
      </p>
      <form className="admin-form" onSubmit={onSubmit}>
        <label>
          이메일
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          비밀번호
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error ? <p className="admin-error">{error}</p> : null}
        <button className="btn btn-fill" type="submit" disabled={pending}>
          {pending ? "로그인 중…" : "로그인"}
        </button>
      </form>
    </main>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<main className="admin-main">불러오는 중…</main>}>
      <LoginForm />
    </Suspense>
  );
}
