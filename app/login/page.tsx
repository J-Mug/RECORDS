"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CatalogNav } from "@/components/catalog/CatalogNav";
import { useAuth } from "@/components/auth/AuthProvider";
import { getSupabasePublicConfig } from "@/lib/supabase/client";

function safeNext(raw: string | null) {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/walkie";
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const { signIn } = useAuth();
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
      const { error: signInError } = await signIn(email, password);
      if (signInError) {
        setError(signInError);
        return;
      }
      router.replace(next);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="catalog-main">
      <p className="kicker">Account</p>
      <h1 className="admin-title">로그인</h1>
      <p className="admin-lead">Walkie는 로그인한 사용자만 볼 수 있는 개인 창고입니다. 위치 정보는 받지 않습니다.</p>
      <form className="admin-form" onSubmit={onSubmit}>
        <label>
          이메일
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          비밀번호
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error ? <p className="admin-error">{error}</p> : null}
        <button className="btn btn-fill" type="submit" disabled={pending}>
          {pending ? "로그인 중…" : "로그인"}
        </button>
      </form>
      <p className="admin-lead" style={{ marginTop: 20 }}>
        계정이 없나요? <a href={`/signup?next=${encodeURIComponent(next)}`}>회원가입</a>
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <div className="catalog-shell">
      <CatalogNav />
      <Suspense fallback={<main className="catalog-main">불러오는 중…</main>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
