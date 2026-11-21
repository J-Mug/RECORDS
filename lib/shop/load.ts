import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAlbumCovers, type AlbumCoverRef } from "@/lib/music/covers";

/** Fixture accounts used in tests — never show these as popular shops. */
export const TEST_SHOP_HANDLES = new Set(["records_admin", "walkie_user_a", "walkie_user_b"]);

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export type ShopOwner = { id: string; handle: string; display_name: string };
export type ShopRecord = {
  id: string;
  user_id: string;
  name: string;
  introduction: string | null;
  visibility: string;
};
export type ShopSongRef = {
  id: string;
  title: string;
  duration_ms: number | null;
  artist: { id: string; name: string } | null;
  album: { id: string; title: string } | null;
};
export type ShopItemRow = {
  id: string;
  song_id: string;
  note: string | null;
  sort_order: number;
  song: ShopSongRef | null;
};
export type ShopIgPost = {
  shortcode: string;
  ig_url: string;
  posted_at: string;
  artist: string | null;
  song: string | null;
  album: string | null;
  topic: string | null;
  youtube_url: string | null;
  song_id: string | null;
  artist_id: string | null;
  album_id: string | null;
  match_status: string;
};

export type ShopPageData = {
  handle: string;
  notFound: boolean;
  error: string | null;
  shop: ShopRecord | null;
  owner: ShopOwner | null;
  items: ShopItemRow[];
  videos: Record<string, string>;
  covers: Record<string, AlbumCoverRef>;
  igPosts: ShopIgPost[];
};

export type PopularShopCard = {
  handle: string;
  name: string;
  displayName: string;
  region: string | null;
  itemCount: number;
  covers: AlbumCoverRef[];
};

const ITEM_SELECT =
  "id, song_id, note, sort_order, song:song_id (id, title, duration_ms, artist:primary_artist_id (id, name), album:primary_album_id (id, title))";

function emptyShop(handle: string, error: string | null = null, notFound = true): ShopPageData {
  return {
    handle,
    notFound,
    error,
    shop: null,
    owner: null,
    items: [],
    videos: {},
    covers: {},
    igPosts: [],
  };
}

export async function loadShopPage(supabase: SupabaseClient, handle: string): Promise<ShopPageData> {
  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("id, handle, display_name")
    .eq("handle", handle)
    .maybeSingle();
  if (profileError) return emptyShop(handle, profileError.message, false);
  if (!profileRow) return emptyShop(handle);

  const { data: shopRow, error: shopError } = await supabase
    .from("shop")
    .select("id, user_id, name, introduction, visibility")
    .eq("user_id", profileRow.id)
    .maybeSingle();
  if (shopError) return emptyShop(handle, shopError.message, false);
  if (!shopRow) return { ...emptyShop(handle), owner: profileRow as ShopOwner };

  const { data: itemRows, error: itemError } = await supabase
    .from("shop_item")
    .select(ITEM_SELECT)
    .eq("shop_id", shopRow.id)
    .order("sort_order")
    .order("created_at");
  if (itemError) return emptyShop(handle, itemError.message, false);

  const items: ShopItemRow[] = (itemRows ?? []).map((row) => {
    const raw = row as unknown as ShopItemRow & { song: ShopSongRef | ShopSongRef[] | null };
    const songRow = one(raw.song);
    const song = songRow
      ? {
          ...songRow,
          artist: one(songRow.artist as { id: string; name: string } | { id: string; name: string }[] | null),
          album: one(songRow.album as { id: string; title: string } | { id: string; title: string }[] | null),
        }
      : null;
    return { id: raw.id, song_id: raw.song_id, note: raw.note, sort_order: raw.sort_order, song };
  });

  let igPosts: ShopIgPost[] = [];
  if (handle === "iruli") {
    const { data: posts } = await supabase
      .from("instagram_post")
      .select(
        "shortcode, ig_url, posted_at, artist, song, album, topic, youtube_url, song_id, artist_id, album_id, match_status",
      )
      .order("posted_at", { ascending: false });
    igPosts = (posts ?? []) as ShopIgPost[];
  }

  const songIds = items.map((item) => item.song_id);
  const videos: Record<string, string> = {};
  if (songIds.length) {
    const { data: vids } = await supabase
      .from("song_external_video")
      .select("song_id, video_id")
      .eq("provider", "youtube")
      .eq("status", "ACTIVE")
      .in("song_id", songIds);
    for (const row of vids ?? []) {
      videos[row.song_id as string] = row.video_id as string;
    }
  }

  const albumIds = [
    ...items.map((item) => item.song?.album?.id),
    ...igPosts.map((post) => post.album_id),
  ];
  const coverMap = await fetchAlbumCovers(supabase, albumIds);
  const covers: Record<string, AlbumCoverRef> = {};
  for (const [id, cover] of coverMap) covers[id] = cover;

  return {
    handle,
    notFound: false,
    error: null,
    shop: shopRow as ShopRecord,
    owner: profileRow as ShopOwner,
    items,
    videos,
    covers,
    igPosts,
  };
}

export async function loadPopularShops(supabase: SupabaseClient): Promise<PopularShopCard[]> {
  const { data: shops, error } = await supabase
    .from("shop")
    .select("id, name, user_id, visibility, owner:user_id (handle, display_name, region_sido, region_sigungu)")
    .eq("visibility", "PUBLIC");
  if (error || !shops) return [];

  type ShopRow = {
    id: string;
    name: string;
    user_id: string;
    owner?:
      | { handle: string; display_name: string; region_sido: string | null; region_sigungu: string | null }
      | Array<{ handle: string; display_name: string; region_sido: string | null; region_sigungu: string | null }>
      | null;
  };

  const visible = (shops as ShopRow[])
    .map((row) => {
      const owner = one(row.owner);
      if (!owner) return null;
      if (TEST_SHOP_HANDLES.has(owner.handle) && owner.handle !== "iruli") return null;
      const region = [owner.region_sido, owner.region_sigungu].filter(Boolean).join(" ") || null;
      return { id: row.id, name: row.name, handle: owner.handle, displayName: owner.display_name, region };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (!visible.length) return [];

  const { data: itemRows } = await supabase
    .from("shop_item")
    .select(
      "shop_id, sort_order, created_at, song:song_id (primary_album_id, album:primary_album_id (id, title))",
    )
    .in(
      "shop_id",
      visible.map((row) => row.id),
    )
    .order("sort_order")
    .order("created_at");

  type ItemRow = {
    shop_id: string;
    sort_order: number;
    song?:
      | { primary_album_id: string | null; album?: { id: string; title: string } | { id: string; title: string }[] | null }
      | Array<{ primary_album_id: string | null; album?: { id: string; title: string } | { id: string; title: string }[] | null }>
      | null;
  };

  const itemsByShop = new Map<string, string[]>();
  const allAlbumIds: string[] = [];
  for (const raw of (itemRows ?? []) as ItemRow[]) {
    const song = one(raw.song);
    const album = one(song?.album);
    const albumId = album?.id ?? song?.primary_album_id ?? null;
    const list = itemsByShop.get(raw.shop_id) ?? [];
    if (albumId && !list.includes(albumId)) {
      list.push(albumId);
      allAlbumIds.push(albumId);
    } else if (!albumId) {
      // still count the item even without a cover
    }
    itemsByShop.set(raw.shop_id, list);
  }

  // Item counts should include items without covers.
  const countByShop = new Map<string, number>();
  for (const raw of (itemRows ?? []) as ItemRow[]) {
    countByShop.set(raw.shop_id, (countByShop.get(raw.shop_id) ?? 0) + 1);
  }

  const coverMap = await fetchAlbumCovers(supabase, allAlbumIds);

  const cards: PopularShopCard[] = visible
    .map((shop) => {
      const itemCount = countByShop.get(shop.id) ?? 0;
      if (itemCount === 0 && shop.handle !== "iruli") return null;
      const albumIds = (itemsByShop.get(shop.id) ?? []).slice(0, 6);
      const covers = albumIds
        .map((id) => coverMap.get(id))
        .filter((cover): cover is AlbumCoverRef => Boolean(cover));
      return {
        handle: shop.handle,
        name: shop.name,
        displayName: shop.displayName,
        region: shop.region,
        itemCount,
        covers,
      };
    })
    .filter((row): row is PopularShopCard => row !== null);

  cards.sort((a, b) => {
    if (a.handle === "iruli" && b.handle !== "iruli") return -1;
    if (b.handle === "iruli" && a.handle !== "iruli") return 1;
    if (b.itemCount !== a.itemCount) return b.itemCount - a.itemCount;
    return a.name.localeCompare(b.name, "ko");
  });

  return cards;
}
