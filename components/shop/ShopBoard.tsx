"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { EmptyState, ErrorState, LoadingState } from "@/components/catalog/States";
import { PlaceholderCover } from "@/components/catalog/PlaceholderCover";
import { PlayButton } from "@/components/catalog/PlayButton";
import { ShopCommentText } from "@/components/shop/ShopCommentText";
import { getSupabaseBrowserClient, getSupabasePublicConfig } from "@/lib/supabase/client";

type Owner = { id: string; handle: string; display_name: string };
type Shop = { id: string; user_id: string; name: string; introduction: string | null; visibility: string };
type SongRef = {
  id: string;
  title: string;
  duration_ms: number | null;
  artist?: { id: string; name: string } | { id: string; name: string }[] | null;
  album?: { id: string; title: string } | { id: string; title: string }[] | null;
};
type Item = {
  id: string;
  song_id: string;
  note: string | null;
  sort_order: number;
  song: SongRef | SongRef[] | null;
};
type IgPost = {
  shortcode: string;
  ig_url: string;
  posted_at: string;
  artist: string | null;
  song: string | null;
  topic: string | null;
  youtube_url: string | null;
  song_id: string | null;
  artist_id: string | null;
  match_status: string;
};

function formatPostedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(date);
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export function ShopBoard({ handle }: { handle: string }) {
  const { ready: authReady, user, profile } = useAuth();
  const config = useMemo(() => getSupabasePublicConfig(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [shop, setShop] = useState<Shop | null>(null);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [videos, setVideos] = useState<Map<string, string>>(new Map());
  const [editingProfile, setEditingProfile] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [introDraft, setIntroDraft] = useState("");
  const [editingComment, setEditingComment] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const [igPosts, setIgPosts] = useState<IgPost[]>([]);

  const isOwner = Boolean(user && owner && user.id === owner.id);

  const load = useCallback(async () => {
    if (!config.ready) return;
    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    const { data: profileRow, error: profileError } = await supabase
      .from("profiles")
      .select("id, handle, display_name")
      .eq("handle", handle)
      .maybeSingle();
    if (profileError) {
      setError(profileError.message);
      setLoading(false);
      return;
    }
    if (!profileRow) {
      setNotFound(true);
      setShop(null);
      setOwner(null);
      setItems([]);
      setLoading(false);
      return;
    }
    const { data: shopRow, error: shopError } = await supabase
      .from("shop")
      .select("id, user_id, name, introduction, visibility")
      .eq("user_id", profileRow.id)
      .maybeSingle();
    if (shopError) {
      setError(shopError.message);
      setLoading(false);
      return;
    }
    if (!shopRow) {
      setNotFound(true);
      setOwner(profileRow as Owner);
      setShop(null);
      setItems([]);
      setLoading(false);
      return;
    }
    const { data: itemRows, error: itemError } = await supabase
      .from("shop_item")
      .select(
        "id, song_id, note, sort_order, song:song_id (id, title, duration_ms, artist:primary_artist_id (id, name), album:primary_album_id (id, title))",
      )
      .eq("shop_id", shopRow.id)
      .order("sort_order")
      .order("created_at");
    if (itemError) {
      setError(itemError.message);
      setLoading(false);
      return;
    }
    const nextItems = (itemRows ?? []) as Item[];
    setOwner(profileRow as Owner);
    setShop(shopRow as Shop);
    setItems(nextItems);
    setNameDraft(shopRow.name);
    setIntroDraft(shopRow.introduction ?? "");
    setNotFound(false);
    setError(null);
    if (handle === "iruli") {
      const { data: posts } = await supabase
        .from("instagram_post")
        .select("shortcode, ig_url, posted_at, artist, song, topic, youtube_url, song_id, artist_id, match_status")
        .order("posted_at", { ascending: false });
      setIgPosts((posts ?? []) as IgPost[]);
    } else {
      setIgPosts([]);
    }
    const songIds = nextItems.map((item) => item.song_id);
    if (songIds.length) {
      const { data: vids } = await supabase
        .from("song_external_video")
        .select("song_id, video_id")
        .eq("provider", "youtube")
        .eq("status", "ACTIVE")
        .in("song_id", songIds);
      setVideos(new Map((vids ?? []).map((row) => [row.song_id as string, row.video_id as string])));
    } else {
      setVideos(new Map());
    }
    setLoading(false);
  }, [config.ready, handle]);

  useEffect(() => {
    if (!authReady) return;
    void load();
  }, [authReady, load]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!shop) return;
    const name = nameDraft.trim();
    if (!name) return;
    const supabase = getSupabaseBrowserClient();
    const { error: updateError } = await supabase
      .from("shop")
      .update({ name, introduction: introDraft.trim() || null })
      .eq("id", shop.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setEditingProfile(false);
    await load();
  }

  async function saveComment(id: string) {
    const note = (editingComment[id] ?? "").trim() || null;
    const supabase = getSupabaseBrowserClient();
    const { error: updateError } = await supabase.from("shop_item").update({ note }).eq("id", id);
    if (updateError) setError(updateError.message);
    setEditingComment((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    await load();
  }

  async function removeItem(id: string) {
    const supabase = getSupabaseBrowserClient();
    const { error: deleteError } = await supabase.from("shop_item").delete().eq("id", id);
    if (deleteError) setError(deleteError.message);
    await load();
  }

  async function reorder(ids: string[]) {
    const supabase = getSupabaseBrowserClient();
    const { error: rpcError } = await supabase.rpc("reorder_shop_items", { p_item_ids: ids });
    if (rpcError) setError(rpcError.message);
    await load();
  }

  function shift(item: Item, direction: -1 | 1) {
    const index = items.findIndex((row) => row.id === item.id);
    const next = index + direction;
    if (next < 0 || next >= items.length) return;
    const ids = items.map((row) => row.id);
    [ids[index], ids[next]] = [ids[next], ids[index]];
    void reorder(ids);
  }

  if (!authReady || loading) {
    return <LoadingState label="숍을 불러오는 중…" />;
  }

  if (!config.ready) {
    return <ErrorState message="Supabase 환경변수가 설정되지 않았습니다." />;
  }

  if (notFound || !shop || !owner) {
    return <EmptyState title="숍을 찾을 수 없습니다." body="핸들이 바뀌었거나 아직 공개된 숍이 없습니다." />;
  }

  const sorted = items.slice().sort((a, b) => a.sort_order - b.sort_order);
  const postsBySong = new Map<string, IgPost[]>();
  for (const post of igPosts) {
    if (!post.song_id) continue;
    const list = postsBySong.get(post.song_id) ?? [];
    list.push(post);
    postsBySong.set(post.song_id, list);
  }
  const isIruli = handle === "iruli";

  return (
    <div className="shop-board">
      <header className="shop-header">
        {editingProfile && isOwner ? (
          <form className="shop-profile-edit" onSubmit={saveProfile}>
            <label>
              숍 이름
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={80} required />
            </label>
            <label>
              소개
              <textarea
                value={introDraft}
                onChange={(e) => setIntroDraft(e.target.value)}
                maxLength={500}
                placeholder="이 숍을 찾는 사람에게 보이는 짧은 소개"
              />
            </label>
            <div className="shop-section-actions">
              <button className="btn btn-fill" type="submit">
                저장
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => setEditingProfile(false)}>
                취소
              </button>
            </div>
          </form>
        ) : (
          <>
            <p className="admin-sub">@{owner.handle}</p>
            <h1 className="admin-title">{shop.name}</h1>
            {shop.introduction ? <p className="admin-lead">{shop.introduction}</p> : null}
            {isOwner ? (
              <button className="btn btn-ghost" type="button" onClick={() => setEditingProfile(true)}>
                이름·소개 수정
              </button>
            ) : null}
          </>
        )}
      </header>
      {isOwner ? (
        <p className="admin-lead">
          워키에 담은 곡만 진열할 수 있습니다. 공개 코멘트는 숍에 보이며, 워키 메모는 비공개로 남습니다.
          {profile?.handle ? (
            <>
              {" "}
              <a href="/walkie">워키에서 진열하기</a>
            </>
          ) : null}
        </p>
      ) : (
        <p className="admin-lead">{owner.display_name}의 공개 쇼윈도입니다.</p>
      )}
      {error ? <p className="admin-error">{error}</p> : null}
      {sorted.length === 0 ? (
        <EmptyState
          title="아직 진열된 곡이 없습니다."
          body={
            isIruli
              ? "인스타그램 아카이브 글은 아래에 모입니다. 카탈로그에 맞춰진 곡이 있으면 여기에 진열됩니다."
              : isOwner
                ? "워키에서 ‘숍에 진열’을 눌러 곡을 올려 보세요."
                : "이 숍은 비어 있습니다."
          }
        />
      ) : (
        <ul className="shop-list">
          {sorted.map((item, index) => {
            const song = one(item.song);
            const artist = one(song?.artist);
            const album = one(song?.album);
            const commentDraft = editingComment[item.id];
            return (
              <li
                key={item.id}
                className="shop-item"
                draggable={isOwner}
                onDragStart={
                  isOwner
                    ? (event) => {
                        setDragging(item.id);
                        event.dataTransfer.setData("text/shop-item", item.id);
                        event.dataTransfer.effectAllowed = "move";
                      }
                    : undefined
                }
                onDragEnd={isOwner ? () => setDragging(null) : undefined}
                onDragOver={
                  isOwner
                    ? (event) => {
                        event.preventDefault();
                      }
                    : undefined
                }
                onDrop={
                  isOwner
                    ? (event) => {
                        event.preventDefault();
                        const id = event.dataTransfer.getData("text/shop-item") || dragging;
                        if (!id || id === item.id) return;
                        const ids = sorted.map((row) => row.id).filter((rowId) => rowId !== id);
                        ids.splice(index, 0, id);
                        void reorder(ids);
                        setDragging(null);
                      }
                    : undefined
                }
              >
                <PlaceholderCover seed={item.song_id} size="sm" />
                <div className="shop-item-main">
                  {song ? (
                    <a href={`/song/${song.id}`}>
                      <strong>{song.title}</strong>
                    </a>
                  ) : (
                    <strong>삭제된 곡</strong>
                  )}
                  <p className="admin-sub">
                    {artist ? <a href={`/artist/${artist.id}`}>{artist.name}</a> : "아티스트 미상"}
                    {album ? (
                      <>
                        {" · "}
                        <a href={`/album/${album.id}`}>{album.title}</a>
                      </>
                    ) : null}
                  </p>
                  {isOwner ? (
                    commentDraft != null ? (
                      <label className="shop-comment-edit">
                        공개 코멘트 (워키 메모와 별개)
                        <textarea
                          value={commentDraft}
                          maxLength={280}
                          onChange={(e) => setEditingComment((c) => ({ ...c, [item.id]: e.target.value }))}
                          onBlur={() => void saveComment(item.id)}
                        />
                      </label>
                    ) : item.note ? (
                      <button
                        type="button"
                        className="shop-comment-btn"
                        onClick={() => setEditingComment((c) => ({ ...c, [item.id]: item.note ?? "" }))}
                      >
                        <ShopCommentText comment={item.note} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="shop-comment-add"
                        onClick={() => setEditingComment((c) => ({ ...c, [item.id]: "" }))}
                      >
                        공개 코멘트 추가
                      </button>
                    )
                  ) : item.note ? (
                    <ShopCommentText comment={item.note} />
                  ) : null}
                  {(postsBySong.get(item.song_id) ?? []).map((post) => (
                    <p className="shop-ig-links" key={post.shortcode}>
                      <a href={post.ig_url} target="_blank" rel="noreferrer">
                        인스타에서 보기
                      </a>
                      {post.youtube_url ? (
                        <a href={post.youtube_url} target="_blank" rel="noreferrer">
                          공식 영상
                        </a>
                      ) : null}
                    </p>
                  ))}
                </div>
                <div className="shop-item-actions">
                  {song ? (
                    <PlayButton
                      track={{
                        songId: song.id,
                        title: song.title,
                        artistName: artist?.name ?? "",
                        videoId: videos.get(song.id) ?? null,
                      }}
                    />
                  ) : null}
                  {isOwner ? (
                    <>
                      <button className="btn btn-ghost" type="button" onClick={() => shift(item, -1)} disabled={index === 0}>
                        위로
                      </button>
                      <button
                        className="btn btn-ghost"
                        type="button"
                        onClick={() => shift(item, 1)}
                        disabled={index === sorted.length - 1}
                      >
                        아래로
                      </button>
                      <button className="btn btn-ghost" type="button" onClick={() => void removeItem(item.id)}>
                        내리기
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {isIruli ? (
        <section className="shop-archive">
          <h2 className="catalog-section-title">인스타그램 아카이브</h2>
          <p className="admin-sub">@iruli.l 에 올린 글입니다. 슬라이드 이미지는 싣지 않습니다.</p>
          {igPosts.length === 0 ? (
            <p className="admin-lead">아직 동기화된 게시가 없습니다.</p>
          ) : (
            <ul className="shop-archive-list">
              {igPosts.map((post) => (
                <li key={post.shortcode} className="shop-archive-item">
                  <time dateTime={post.posted_at}>{formatPostedAt(post.posted_at)}</time>
                  <strong>{post.topic || post.song || post.artist || post.shortcode}</strong>
                  <p className="admin-sub">
                    {post.artist ? (
                      post.artist_id ? <a href={`/artist/${post.artist_id}`}>{post.artist}</a> : post.artist
                    ) : "아티스트 미상"}
                    {post.song ? (
                      <>
                        {" · "}
                        {post.song_id ? <a href={`/song/${post.song_id}`}>{post.song}</a> : post.song}
                      </>
                    ) : (
                      " · 곡 없음"
                    )}
                  </p>
                  <div className="shop-archive-actions">
                    <a href={post.ig_url} target="_blank" rel="noreferrer">
                      인스타에서 보기
                    </a>
                    {post.youtube_url ? (
                      <a href={post.youtube_url} target="_blank" rel="noreferrer">
                        공식 영상
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
