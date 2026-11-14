"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getSupabaseBrowserClient,
  getSupabasePublicConfig,
} from "@/lib/supabase/client";

type CandidateKind = "ARTIST" | "ALBUM" | "SONG";
type CandidateStatus =
  | "PENDING"
  | "NEEDS_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "MERGED";

type Candidate = {
  id: string;
  source: string | null;
  source_url: string | null;
  artist_name: string | null;
  album_name: string | null;
  song_name: string | null;
  release_date: string | null;
  candidate_kind: CandidateKind;
  artist_mbid: string | null;
  album_mbid: string | null;
  song_mbid: string | null;
  status: CandidateStatus;
  created_at: string;
};

const KINDS: Array<CandidateKind | "ALL"> = ["ALL", "ARTIST", "ALBUM", "SONG"];
const STATUSES: Array<CandidateStatus | "ALL"> = [
  "NEEDS_REVIEW",
  "ALL",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "MERGED",
];

export default function CandidatesAdmin() {
  const router = useRouter();
  const config = useMemo(() => getSupabasePublicConfig(), []);
  const [ready, setReady] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [rows, setRows] = useState<Candidate[]>([]);
  const [total, setTotal] = useState(0);
  const [kind, setKind] = useState<CandidateKind | "ALL">("ALL");
  const [status, setStatus] = useState<CandidateStatus | "ALL">("NEEDS_REVIEW");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mergeFor, setMergeFor] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");

  const load = useCallback(async () => {
    if (!config.ready) return;
    const supabase = getSupabaseBrowserClient();
    let query = supabase
      .from("music_candidate")
      .select(
        "id, source, source_url, artist_name, album_name, song_name, release_date, candidate_kind, artist_mbid, album_mbid, song_mbid, status, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: true })
      .limit(200);

    if (kind !== "ALL") query = query.eq("candidate_kind", kind);
    if (status !== "ALL") query = query.eq("status", status);

    const { data, error: queryError, count } = await query;
    if (queryError) {
      setError(queryError.message);
      setRows([]);
      return;
    }
    setError(null);
    setRows((data ?? []) as Candidate[]);
    setTotal(count ?? data?.length ?? 0);
  }, [config.ready, kind, status]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (!config.ready) {
        setReady(true);
        return;
      }
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        router.replace("/admin/login?next=/admin/candidates");
        return;
      }
      setEmail(data.session.user.email ?? null);
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.session.user.id)
        .maybeSingle();
      if (cancelled) return;
      if (profileError || profile?.role !== "admin") {
        setForbidden(true);
        setReady(true);
        return;
      }
      setReady(true);
      await load();
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [config.ready, load, router]);

  async function signOut() {
    if (!config.ready) return;
    await getSupabaseBrowserClient().auth.signOut();
    router.replace("/admin/login");
  }

  async function review(id: string, action: "approve" | "reject" | "merge") {
    if (!config.ready) return;
    const mergeInto =
      action === "merge" ? mergeTarget.trim() || null : null;
    if (action === "merge" && !mergeInto) {
      setError("병합할 대상 후보 ID를 입력하세요.");
      return;
    }
    setBusyId(id);
    setError(null);
    const supabase = getSupabaseBrowserClient();
    const { error: rpcError } = await supabase.rpc("review_music_candidate", {
      p_id: id,
      p_action: action,
      p_merge_into: mergeInto,
    });
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setMergeFor(null);
    setMergeTarget("");
    await load();
  }

  if (!ready) {
    return <main className="admin-main">불러오는 중…</main>;
  }

  if (!config.ready) {
    return (
      <main className="admin-main">
        <h1 className="admin-title">Supabase 설정이 필요합니다.</h1>
        <p className="admin-lead">
          <code>.env.local</code>에 <code>NEXT_PUBLIC_SUPABASE_URL</code>과
          익명/publishable 키를 넣은 뒤 다시 시도하세요. 서버 키는 커밋하지 마세요.
        </p>
      </main>
    );
  }

  if (forbidden) {
    return (
      <main className="admin-main">
        <h1 className="admin-title">권한이 없습니다.</h1>
        <p className="admin-lead">
          이 페이지는 <code>profiles.role = admin</code> 계정만 사용할 수 있습니다.
        </p>
        <button className="btn btn-ghost" type="button" onClick={signOut}>
          로그아웃
        </button>
      </main>
    );
  }

  return (
    <main className="admin-main">
      <div className="admin-head">
        <div>
          <p className="kicker">Admin review</p>
          <h1 className="admin-title">음악 후보</h1>
          <p className="admin-lead">
            MusicBrainz에서 수집된 후보는 자동 공개되지 않습니다. 승인하면 artist /
            album / song 테이블로 승격됩니다.
          </p>
        </div>
        <div className="admin-user">
          <span>{email}</span>
          <button className="btn btn-ghost" type="button" onClick={signOut}>
            로그아웃
          </button>
        </div>
      </div>

      <div className="admin-filters">
        <div className="admin-chips">
          {KINDS.map((item) => (
            <button
              key={item}
              type="button"
              className={item === kind ? "chip is-on" : "chip"}
              onClick={() => setKind(item)}
            >
              {item === "ALL" ? "전체 유형" : item}
            </button>
          ))}
        </div>
        <div className="admin-chips">
          {STATUSES.map((item) => (
            <button
              key={item}
              type="button"
              className={item === status ? "chip is-on" : "chip"}
              onClick={() => setStatus(item)}
            >
              {item === "ALL" ? "전체 상태" : item}
            </button>
          ))}
        </div>
        <p className="admin-count">{total}건 (최대 200건 표시)</p>
      </div>

      {error ? <p className="admin-error">{error}</p> : null}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>유형</th>
              <th>아티스트</th>
              <th>앨범 / 곡</th>
              <th>MBID</th>
              <th>상태</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="admin-empty">
                  표시할 후보가 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const mbid =
                  row.candidate_kind === "SONG"
                    ? row.song_mbid
                    : row.candidate_kind === "ALBUM"
                      ? row.album_mbid
                      : row.artist_mbid;
                const title =
                  row.candidate_kind === "SONG"
                    ? row.song_name
                    : row.candidate_kind === "ALBUM"
                      ? row.album_name
                      : "—";
                const open = mergeFor === row.id;
                return (
                  <tr key={row.id}>
                    <td>
                      <span className="kind-pill">{row.candidate_kind}</span>
                    </td>
                    <td>{row.artist_name ?? "—"}</td>
                    <td>
                      <div>{title ?? "—"}</div>
                      {row.candidate_kind === "SONG" && row.album_name ? (
                        <div className="admin-sub">{row.album_name}</div>
                      ) : null}
                      {row.release_date ? (
                        <div className="admin-sub">{row.release_date}</div>
                      ) : null}
                    </td>
                    <td className="admin-mbid">
                      {row.source_url ? (
                        <a href={row.source_url} target="_blank" rel="noreferrer">
                          {mbid}
                        </a>
                      ) : (
                        mbid
                      )}
                    </td>
                    <td>{row.status}</td>
                    <td>
                      {row.status === "NEEDS_REVIEW" || row.status === "PENDING" ? (
                        <div className="admin-actions">
                          <button
                            className="btn btn-fill"
                            type="button"
                            disabled={busyId === row.id}
                            onClick={() => review(row.id, "approve")}
                          >
                            승인
                          </button>
                          <button
                            className="btn btn-ghost"
                            type="button"
                            disabled={busyId === row.id}
                            onClick={() => review(row.id, "reject")}
                          >
                            거절
                          </button>
                          <button
                            className="btn btn-ghost"
                            type="button"
                            disabled={busyId === row.id}
                            onClick={() => {
                              setMergeFor(open ? null : row.id);
                              setMergeTarget("");
                            }}
                          >
                            병합
                          </button>
                        </div>
                      ) : null}
                      {open ? (
                        <div className="admin-merge">
                          <input
                            placeholder="병합 대상 후보 UUID"
                            value={mergeTarget}
                            onChange={(e) => setMergeTarget(e.target.value)}
                          />
                          <button
                            className="btn btn-fill"
                            type="button"
                            disabled={busyId === row.id}
                            onClick={() => review(row.id, "merge")}
                          >
                            확인
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
