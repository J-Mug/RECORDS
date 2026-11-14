"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";

export function CatalogNav({ initialQuery = "" }: { initialQuery?: string }) {
  const router = useRouter();
  const { ready, user, profile, signOut } = useAuth();
  const [q, setQ] = useState(initialQuery);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = q.trim();
    router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search");
  }

  return (
    <header className="catalog-nav">
      <div className="catalog-nav-inner">
        <a className="logo" href="/">
          Records
        </a>
        <form className="catalog-search" onSubmit={onSubmit} role="search">
          <label className="sr-only" htmlFor="catalog-q">
            음악 검색
          </label>
          <input
            id="catalog-q"
            type="search"
            name="q"
            placeholder="아티스트, 앨범, 곡, 로마자…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn btn-fill" type="submit">
            검색
          </button>
        </form>
        <nav className="catalog-account" aria-label="계정">
          <a href="/walkie">워키</a>
          {profile?.handle ? <a href={`/shop/${profile.handle}`}>숍</a> : null}
          {ready && user ? (
            <>
              <span className="admin-sub">{profile?.handle ?? "계정"}</span>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  void signOut().then(() => router.push("/"));
                }}
              >
                로그아웃
              </button>
            </>
          ) : (
            <>
              <a href="/login">로그인</a>
              <a href="/signup">회원가입</a>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
