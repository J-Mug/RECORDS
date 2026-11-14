"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function CatalogNav({ initialQuery = "" }: { initialQuery?: string }) {
  const router = useRouter();
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
      </div>
    </header>
  );
}
