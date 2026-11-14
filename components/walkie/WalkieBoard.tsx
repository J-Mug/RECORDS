"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { EmptyState, ErrorState, LoadingState } from "@/components/catalog/States";
import { PlaceholderCover } from "@/components/catalog/PlaceholderCover";
import { PlayButton } from "@/components/catalog/PlayButton";
import { WalkieNoteText } from "@/components/walkie/WalkieNoteText";
import { getSupabaseBrowserClient, getSupabasePublicConfig } from "@/lib/supabase/client";

type Section = { id: string; name: string; sort_order: number };
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
  section_id: string | null;
  note: string | null;
  sort_order: number;
  song: SongRef | SongRef[] | null;
};

const UNSECTIONED = "unsectioned";

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export function WalkieBoard() {
  const { ready: authReady, user, profile } = useAuth();
  const config = useMemo(() => getSupabasePublicConfig(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [videos, setVideos] = useState<Map<string, string>>(new Map());
  const [newSection, setNewSection] = useState("");
  const [editingNote, setEditingNote] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!config.ready || !user) return;
    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    const [secRes, itemRes] = await Promise.all([
      supabase.from("walkie_section").select("id, name, sort_order").order("sort_order").order("created_at"),
      supabase
        .from("walkie_item")
        .select(
          "id, song_id, section_id, note, sort_order, song:song_id (id, title, duration_ms, artist:primary_artist_id (id, name), album:primary_album_id (id, title))",
        )
        .order("sort_order")
        .order("created_at"),
    ]);
    if (secRes.error || itemRes.error) {
      setError(secRes.error?.message || itemRes.error?.message || "불러오지 못했습니다.");
      setLoading(false);
      return;
    }
    const nextItems = (itemRes.data ?? []) as Item[];
    setSections((secRes.data ?? []) as Section[]);
    setItems(nextItems);
    setError(null);
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
  }, [config.ready, user]);

  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      setLoading(false);
      return;
    }
    void load();
  }, [authReady, user, load]);

  async function createSection(event: FormEvent) {
    event.preventDefault();
    const name = newSection.trim();
    if (!name || !user) return;
    const supabase = getSupabaseBrowserClient();
    const sort_order = sections.length === 0 ? 0 : Math.max(...sections.map((s) => s.sort_order)) + 1;
    const { error: insertError } = await supabase
      .from("walkie_section")
      .insert({ user_id: user.id, name, sort_order });
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setNewSection("");
    await load();
  }

  async function renameSection(id: string) {
    const name = (renaming[id] ?? "").trim();
    if (!name) return;
    const supabase = getSupabaseBrowserClient();
    const { error: updateError } = await supabase.from("walkie_section").update({ name }).eq("id", id);
    if (updateError) setError(updateError.message);
    setRenaming((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    await load();
  }

  async function deleteSection(id: string) {
    if (!window.confirm("이 섹션을 삭제할까요? 곡은 보관되며 섹션만 없어집니다.")) return;
    const supabase = getSupabaseBrowserClient();
    const { error: deleteError } = await supabase.from("walkie_section").delete().eq("id", id);
    if (deleteError) setError(deleteError.message);
    await load();
  }

  async function removeItem(id: string) {
    const supabase = getSupabaseBrowserClient();
    const { error: deleteError } = await supabase.from("walkie_item").delete().eq("id", id);
    if (deleteError) setError(deleteError.message);
    await load();
  }

  async function saveNote(id: string) {
    const note = editingNote[id] ?? "";
    const supabase = getSupabaseBrowserClient();
    const { error: updateError } = await supabase
      .from("walkie_item")
      .update({ note: note.trim() || null })
      .eq("id", id);
    if (updateError) setError(updateError.message);
    setEditingNote((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    await load();
  }

  function itemsIn(sectionId: string | null) {
    return items
      .filter((item) => (item.section_id ?? UNSECTIONED) === (sectionId ?? UNSECTIONED))
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  async function reorder(sectionId: string | null, ids: string[]) {
    const supabase = getSupabaseBrowserClient();
    const { error: rpcError } = await supabase.rpc("move_and_reorder_walkie_items", {
      p_section_id: sectionId,
      p_item_ids: ids,
    });
    if (rpcError) setError(rpcError.message);
    await load();
  }

  async function moveItem(itemId: string, targetSection: string | null, index?: number) {
    const current = itemsIn(targetSection).map((item) => item.id).filter((id) => id !== itemId);
    const at = index == null ? current.length : Math.max(0, Math.min(index, current.length));
    current.splice(at, 0, itemId);
    await reorder(targetSection, current);
  }

  function shift(item: Item, direction: -1 | 1) {
    const list = itemsIn(item.section_id);
    const index = list.findIndex((row) => row.id === item.id);
    const next = index + direction;
    if (next < 0 || next >= list.length) return;
    const ids = list.map((row) => row.id);
    [ids[index], ids[next]] = [ids[next], ids[index]];
    void reorder(item.section_id, ids);
  }

  if (!authReady || (user && loading && items.length === 0 && sections.length === 0)) {
    return <LoadingState label="워키를 불러오는 중…" />;
  }

  if (!user) {
    return (
      <EmptyState
        title="로그인이 필요합니다."
        body="Walkie는 나만 볼 수 있는 개인 창고입니다. 로그인하거나 계정을 만들어 주세요."
      />
    );
  }

  if (!config.ready) {
    return <ErrorState message="Supabase 환경변수가 설정되지 않았습니다." />;
  }

  const groups: Array<{ key: string; id: string | null; name: string }> = [
    { key: UNSECTIONED, id: null, name: "담은 곡" },
    ...sections.map((section) => ({ key: section.id, id: section.id, name: section.name })),
  ];

  return (
    <div className="walkie-board">
      <p className="admin-lead">
        {profile?.display_name ?? "나"}의 비공개 창고입니다. 메모는 기본적으로 비공개이며, 다른 사람에게 보이지 않습니다.
      </p>
      <form className="walkie-new-section" onSubmit={createSection}>
        <label className="sr-only" htmlFor="new-section">
          새 섹션 이름
        </label>
        <input
          id="new-section"
          value={newSection}
          onChange={(e) => setNewSection(e.target.value)}
          placeholder="새 섹션 이름 (예: CITY POP)"
          maxLength={60}
        />
        <button className="btn btn-fill" type="submit">
          섹션 만들기
        </button>
      </form>
      {error ? <p className="admin-error">{error}</p> : null}
      {items.length === 0 && sections.length === 0 ? (
        <EmptyState title="아직 담은 곡이 없습니다." body="곡 페이지나 검색 결과에서 ‘워키에 담기’를 눌러 보세요." />
      ) : null}
      {groups.map((group) => {
        const list = itemsIn(group.id);
        if (group.id === null && list.length === 0 && sections.length > 0) return null;
        return (
          <section
            key={group.key}
            className="walkie-section"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const id = event.dataTransfer.getData("text/walkie-item") || dragging;
              if (id) void moveItem(id, group.id);
              setDragging(null);
            }}
          >
            <header className="walkie-section-head">
              {group.id && renaming[group.id] != null ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void renameSection(group.id as string);
                  }}
                  className="walkie-rename"
                >
                  <input
                    value={renaming[group.id]}
                    onChange={(e) => setRenaming((c) => ({ ...c, [group.id as string]: e.target.value }))}
                    maxLength={60}
                  />
                  <button className="btn btn-fill" type="submit">
                    저장
                  </button>
                </form>
              ) : (
                <h2 className="catalog-section-title">{group.name}</h2>
              )}
              {group.id ? (
                <div className="walkie-section-actions">
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => setRenaming((c) => ({ ...c, [group.id as string]: group.name }))}
                  >
                    이름 바꾸기
                  </button>
                  <button className="btn btn-ghost" type="button" onClick={() => void deleteSection(group.id as string)}>
                    섹션 삭제
                  </button>
                </div>
              ) : null}
            </header>
            {list.length === 0 ? (
              <p className="admin-sub">이 섹션은 비어 있습니다. 곡을 끌어오거나 아래에서 옮기세요.</p>
            ) : (
              <ul className="walkie-list">
                {list.map((item, index) => {
                  const song = one(item.song);
                  const artist = one(song?.artist);
                  const album = one(song?.album);
                  const noteDraft = editingNote[item.id];
                  return (
                    <li
                      key={item.id}
                      className="walkie-item"
                      draggable
                      onDragStart={(event) => {
                        setDragging(item.id);
                        event.dataTransfer.setData("text/walkie-item", item.id);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => setDragging(null)}
                    >
                      <PlaceholderCover seed={item.song_id} size="sm" />
                      <div className="walkie-item-main">
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
                        {noteDraft != null ? (
                          <label className="walkie-note-edit">
                            개인 메모 (비공개)
                            <textarea
                              value={noteDraft}
                              maxLength={2000}
                              onChange={(e) => setEditingNote((c) => ({ ...c, [item.id]: e.target.value }))}
                              onBlur={() => void saveNote(item.id)}
                            />
                          </label>
                        ) : item.note ? (
                          <button type="button" className="walkie-note-btn" onClick={() => setEditingNote((c) => ({ ...c, [item.id]: item.note ?? "" }))}>
                            <WalkieNoteText note={item.note} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="walkie-note-add"
                            onClick={() => setEditingNote((c) => ({ ...c, [item.id]: "" }))}
                          >
                            메모 추가
                          </button>
                        )}
                      </div>
                      <div className="walkie-item-actions">
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
                        <button className="btn btn-ghost" type="button" onClick={() => shift(item, -1)} disabled={index === 0}>
                          위로
                        </button>
                        <button
                          className="btn btn-ghost"
                          type="button"
                          onClick={() => shift(item, 1)}
                          disabled={index === list.length - 1}
                        >
                          아래로
                        </button>
                        <label className="walkie-move">
                          <span className="sr-only">섹션 이동</span>
                          <select
                            value={item.section_id ?? UNSECTIONED}
                            onChange={(e) => {
                              const value = e.target.value;
                              void moveItem(item.id, value === UNSECTIONED ? null : value);
                            }}
                          >
                            <option value={UNSECTIONED}>담은 곡</option>
                            {sections.map((section) => (
                              <option key={section.id} value={section.id}>
                                {section.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button className="btn btn-ghost" type="button" onClick={() => void removeItem(item.id)}>
                          빼기
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
