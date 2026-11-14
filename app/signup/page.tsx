"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CatalogNav } from "@/components/catalog/CatalogNav";
import { useAuth } from "@/components/auth/AuthProvider";
import { getSupabasePublicConfig } from "@/lib/supabase/client";

const HANDLE_RE = /^[a-z0-9._]{2,30}$/;
function safeNext(raw: string | null) {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/walkie";
}


function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const { signUp } = useAuth();
  const config = useMemo(() => getSupabasePublicConfig(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!config.ready) {
      setError("Supabase 환경변수가 설정되지 않았습니다.");
      return;
    }
    if (!HANDLE_RE.test(handle)) {
      setError("핸들은 2–30자의 영문 소문자, 숫자, 점, 밑줄만 사용할 수 있습니다.");
      return;
    }
    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    setPending(true);
    try {
      const { error: signUpError, needsConfirm } = await signUp({
        email,
        password,
        handle,
        displayName: displayName.trim() || handle,
      });
      if (signUpError) {
        setError(signUpError);
        return;
      }
      if (needsConfirm) {
        setMessage("가입 확인 메일을 보냈습니다. 확인한 뒤 로그인해 주세요. 정확한 위치 정보는 수집하지 않습니다.");
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
      <h1 className="admin-title">회원가입</h1>
      <p className="admin-lead">이메일과 비밀번호만 사용합니다. 정확한 위치나 주소는 받지 않습니다.</p>
      <form className="admin-form" onSubmit={onSubmit}>
        <label>
          이메일
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          비밀번호
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </label>
        <label>
          핸들
          <input type="text" autoComplete="username" value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase())} placeholder="yourname" required />
        </label>
        <label>
          표시 이름
          <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="이름" required />
        </label>
        {error ? <p className="admin-error">{error}</p> : null}
        {message ? <p className="admin-lead">{message}</p> : null}
        <button className="btn btn-fill" type="submit" disabled={pending}>
          {pending ? "가입 중…" : "가입하기"}
        </button>
      </form>
      <p className="admin-lead" style={{ marginTop: 20 }}>
        이미 계정이 있나요? <a href={`/login?next=${encodeURIComponent(next)}`}>로그인</a>
      </p>
    </main>
  );
}

export default function SignupPage() {
  return (
    <div className="catalog-shell">
      <CatalogNav />
      <Suspense fallback={<main className="catalog-main">불러오는 중…</main>}>
        <SignupForm />
      </Suspense>
    </div>
  );
}
