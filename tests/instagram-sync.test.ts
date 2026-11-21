import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const FIXTURE = "/tmp/iruli-fixture.jsonl";
const PREFIX = "test_iruli_";

function loadEnvLocal() {
  const p = resolve(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function client(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing Supabase public env");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signIn(email: string, password: string) {
  const supabase = client();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(error?.message ?? "sign-in failed");
  return { supabase, user: data.user };
}

async function cleanupFixture() {
  loadEnvLocal();
  const admin = await signIn(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!);
  const { data: posts } = await admin.supabase
    .from("instagram_post")
    .select("shortcode, song_id, candidate_id, ig_url")
    .like("shortcode", `${PREFIX}%`);
  const songIds = [...new Set((posts ?? []).map((row) => row.song_id).filter(Boolean))] as string[];
  const candidateIds = (posts ?? []).map((row) => row.candidate_id).filter(Boolean) as string[];
  const urls = (posts ?? []).map((row) => row.ig_url);
  const { data: iruliProfile } = await admin.supabase.from("profiles").select("id").eq("handle", "iruli").maybeSingle();
  if (iruliProfile && process.env.IRULI_EMAIL && process.env.IRULI_PASSWORD) {
    const iruli = await signIn(process.env.IRULI_EMAIL, process.env.IRULI_PASSWORD);
    if (songIds.length) {
      const { data: shop } = await iruli.supabase.from("shop").select("id").eq("user_id", iruliProfile.id).single();
      if (shop) {
        await iruli.supabase.from("shop_item").delete().eq("shop_id", shop.id).in("song_id", songIds);
      }
      await iruli.supabase.from("walkie_item").delete().eq("user_id", iruliProfile.id).in("song_id", songIds);
    }
  }
  if (posts?.length) {
    await admin.supabase.from("instagram_post").delete().like("shortcode", `${PREFIX}%`);
  }
  if (candidateIds.length) {
    await admin.supabase.from("music_candidate").delete().in("id", candidateIds);
  }
  if (urls.length) {
    await admin.supabase.from("music_candidate").delete().eq("source", "instagram_iruli").in("source_url", urls);
  }
  if (existsSync(FIXTURE)) unlinkSync(FIXTURE);
  return { iruliId: iruliProfile?.id as string | undefined, songIds };
}

describe("Instagram archive sync", () => {
  let songTitle = "";
  let artistName = "";
  let artistId = "";
  let songId = "";
  let albumTitle = "";
  let albumId = "";
  let yonezuId = "";
  let yoasobiAlbumTitle = "";
  let yoasobiAlbumId = "";
  let iruliId = "";
  let shopId = "";

  before(async () => {
    loadEnvLocal();
    await cleanupFixture();
    const publicClient = client();
    const { data: song, error } = await publicClient
      .from("song")
      .select("id, title, primary_artist_id, artist:primary_artist_id (id, name)")
      .eq("status", "PUBLISHED")
      .eq("title", "新時代")
      .limit(1)
      .maybeSingle();
    const chosen = song ?? (
      await publicClient.from("song").select("id, title, primary_artist_id, artist:primary_artist_id (id, name)").eq("status", "PUBLISHED").limit(1).single()
    ).data;
    if (error && !chosen) throw new Error("Need a published song");
    if (!chosen) throw new Error("Need a published song");
    const artist = Array.isArray(chosen.artist) ? chosen.artist[0] : chosen.artist;
    songId = chosen.id;
    songTitle = chosen.title;
    artistName = artist?.name ?? "";
    artistId = artist?.id ?? chosen.primary_artist_id;
    const { data: songAlbum } = await publicClient
      .from("song")
      .select("primary_album_id, album:primary_album_id (id, title)")
      .eq("id", songId)
      .single();
    const album = Array.isArray(songAlbum?.album) ? songAlbum?.album[0] : songAlbum?.album;
    albumId = album?.id ?? songAlbum?.primary_album_id ?? "";
    albumTitle = album?.title ?? "";
    const { data: yonezu } = await publicClient
      .from("artist")
      .select("id")
      .eq("name", "米津玄師")
      .eq("status", "PUBLISHED")
      .maybeSingle();
    yonezuId = yonezu?.id ?? "";
    const { data: yoasobiAlbum } = await publicClient
      .from("album")
      .select("id, title, artist:primary_artist_id (name)")
      .eq("title", "THE BOOK")
      .eq("status", "PUBLISHED")
      .maybeSingle();
    yoasobiAlbumId = yoasobiAlbum?.id ?? "";
    yoasobiAlbumTitle = yoasobiAlbum?.title ?? "";
    if (!yoasobiAlbumId) throw new Error("Need published album THE BOOK for album-match fixture");
    if (!yonezuId) throw new Error("Need published artist 米津玄師 for alias fixture");
    const { data: iruli } = await publicClient.from("profiles").select("id").eq("handle", "iruli").single();
    iruliId = iruli!.id;
    const { data: shop } = await publicClient.from("shop").select("id").eq("user_id", iruliId).single();
    shopId = shop!.id;

    const lines = [
      {
        posted_at: "2026-11-14T16:30:00+09:00",
        ig_url: `https://www.instagram.com/p/${PREFIX}song/`,
        ig_shortcode: `${PREFIX}song`,
        artist: artistName,
        song: songTitle,
        album: null,
        topic: "테스트 진열",
        caption: "fixture only",
        hashtags: ["#이루릴의JPOP아카이브"],
        slide_count: 4,
        slide_paths: ["/workspace/instagram/drafts/should-not-be-stored"],
        sources: ["official"],
        youtube_url: "https://www.youtube.com/watch?v=irulifake001",
        musicbrainz_id: null,
      },
      {
        posted_at: "2026-11-13T16:30:00+09:00",
        ig_url: `https://www.instagram.com/p/${PREFIX}artist/`,
        ig_shortcode: `${PREFIX}artist`,
        artist: "YOASOBI",
        song: null,
        album: null,
        topic: "내한 소식",
        caption: "artist only fixture",
        hashtags: ["#이루릴의JPOP아카이브"],
        slide_count: 4,
        slide_paths: [],
        sources: ["official"],
        youtube_url: null,
        musicbrainz_id: null,
      },
      {
        posted_at: "2026-11-12T16:30:00+09:00",
        ig_url: `https://www.instagram.com/p/${PREFIX}unmatched/`,
        ig_shortcode: `${PREFIX}unmatched`,
        artist: "존재하지않는아티스트XYZ",
        song: "없는곡ABC",
        album: null,
        topic: "미매칭 테스트",
        caption: "should stay unmatched",
        hashtags: ["#이루릴의JPOP아카이브"],
        slide_count: 1,
        slide_paths: ["/workspace/instagram/drafts/nope"],
        sources: [],
        youtube_url: null,
        musicbrainz_id: null,
      },
      {
        posted_at: "2026-11-11T16:30:00+09:00",
        ig_url: `https://www.instagram.com/p/${PREFIX}album/`,
        ig_shortcode: `${PREFIX}album`,
        artist: "YOASOBI",
        song: null,
        album: yoasobiAlbumTitle || "THE BOOK",
        topic: "앨범 매칭 테스트",
        caption: "album fixture",
        hashtags: ["#이루릴의JPOP아카이브"],
        slide_count: 4,
        slide_paths: ["/workspace/instagram/drafts/should-not-be-stored"],
        sources: ["official"],
        youtube_url: null,
        musicbrainz_id: null,
      },
      {
        posted_at: "2026-11-10T16:30:00+09:00",
        ig_url: `https://www.instagram.com/p/${PREFIX}alias/`,
        ig_shortcode: `${PREFIX}alias`,
        artist: "요네즈 켄시",
        song: null,
        album: null,
        topic: "한글 아티스트명 매칭 테스트",
        caption: "alias fixture",
        hashtags: ["#이루릴의JPOP아카이브"],
        slide_count: 1,
        slide_paths: [],
        sources: ["official"],
        youtube_url: null,
        musicbrainz_id: null,
      },
    ];
    writeFileSync(FIXTURE, lines.map((row) => JSON.stringify(row)).join("\n") + "\n");
    void artistId;
  });

  after(async () => {
    await cleanupFixture();
  });

  it("allows public reads and rejects unauthorized writes", async () => {
    loadEnvLocal();
    const anon = client();
    const { error } = await anon.from("instagram_post").select("shortcode").limit(1);
    assert.equal(error, null);
    const { error: insertError } = await anon.from("instagram_post").insert({
      shortcode: `${PREFIX}anon`,
      ig_url: "https://www.instagram.com/p/x/",
      posted_at: new Date().toISOString(),
    });
    assert.ok(insertError, "anonymous insert should fail");
    const user = await signIn(process.env.WALKIE_TEST_A_EMAIL!, process.env.WALKIE_TEST_A_PASSWORD!);
    const rpc = await user.supabase.rpc("sync_instagram_post", {
      p_post: {
        ig_shortcode: `${PREFIX}stolen`,
        ig_url: "https://www.instagram.com/p/stolen/",
        posted_at: "2026-11-14T00:00:00+09:00",
        artist: "Ado",
      },
    });
    assert.ok(rpc.error, "non-admin must not sync");
    const { error: userInsert } = await user.supabase.from("instagram_post").insert({
      shortcode: `${PREFIX}user`,
      ig_url: "https://www.instagram.com/p/user/",
      posted_at: new Date().toISOString(),
    });
    assert.ok(userInsert, "non-admin insert should fail");
  });

  it("syncs a fixture idempotently, displays matches, and leaves unmatched posts for review", async () => {
    loadEnvLocal();
    const run = () =>
      spawnSync("npx", ["tsx", "scripts/sync-instagram.ts", "--file", FIXTURE], {
        cwd: resolve(process.cwd()),
        encoding: "utf8",
        env: process.env,
      });
    const first = run();
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const second = run();
    assert.equal(second.status, 0, second.stderr || second.stdout);

    const anon = client();
    const { data: posts, error } = await anon
      .from("instagram_post")
      .select("shortcode, match_status, song_id, artist_id, album_id, candidate_id, topic, youtube_url")
      .like("shortcode", `${PREFIX}%`)
      .order("shortcode");
    assert.equal(error, null);
    assert.equal(posts?.length, 5);

    const songPost = posts!.find((row) => row.shortcode === `${PREFIX}song`);
    assert.equal(songPost?.match_status, "MATCHED_SONG");
    assert.equal(songPost?.song_id, songId);
    if (albumId) assert.equal(songPost?.album_id, albumId);
    assert.equal(songPost?.topic, "테스트 진열");
    assert.equal(songPost?.youtube_url, "https://www.youtube.com/watch?v=irulifake001");

    const artistPost = posts!.find((row) => row.shortcode === `${PREFIX}artist`);
    assert.equal(artistPost?.match_status, "MATCHED_ARTIST");
    assert.ok(artistPost?.artist_id);
    assert.equal(artistPost?.song_id, null);

    const unmatched = posts!.find((row) => row.shortcode === `${PREFIX}unmatched`);
    assert.equal(unmatched?.match_status, "NEEDS_REVIEW");
    assert.equal(unmatched?.song_id, null);
    assert.ok(unmatched?.candidate_id);

    const albumPost = posts!.find((row) => row.shortcode === `${PREFIX}album`);
    assert.equal(albumPost?.match_status, "MATCHED_ALBUM");
    assert.equal(albumPost?.song_id, null);
    assert.equal(albumPost?.album_id, yoasobiAlbumId);
    assert.ok(albumPost?.artist_id);
    assert.equal(albumPost?.candidate_id, null);

    const aliasPost = posts!.find((row) => row.shortcode === `${PREFIX}alias`);
    assert.equal(aliasPost?.match_status, "MATCHED_ARTIST");
    assert.equal(aliasPost?.song_id, null);
    assert.equal(aliasPost?.artist_id, yonezuId);
    assert.equal(aliasPost?.candidate_id, null);

    const { data: shopItems } = await anon.from("shop_item").select("song_id, note").eq("shop_id", shopId).eq("song_id", songId);
    assert.equal(shopItems?.length, 1);
    assert.equal(shopItems![0].note, "테스트 진열");

    const { data: videos } = await anon
      .from("song_external_video")
      .select("id")
      .eq("video_id", "irulifake001");
    assert.equal(videos?.length, 0);

    // Candidate is not a published song
    const { data: fakeSong } = await anon.from("song").select("id").eq("title", "없는곡ABC");
    assert.equal((fakeSong ?? []).length, 0);

    const admin = await signIn(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!);
    const { data: candidate } = await admin.supabase
      .from("music_candidate")
      .select("status, candidate_kind, song_name, artist_name")
      .eq("id", unmatched!.candidate_id)
      .single();
    assert.equal(candidate?.status, "NEEDS_REVIEW");
    assert.equal(candidate?.candidate_kind, "SONG");
    assert.equal(candidate?.song_name, "없는곡ABC");

    const iruli = await signIn(process.env.IRULI_EMAIL!, process.env.IRULI_PASSWORD!);
    const { data: walkie } = await iruli.supabase
      .from("walkie_item")
      .select("song_id, section_id")
      .eq("user_id", iruliId)
      .eq("song_id", songId);
    assert.equal(walkie?.length, 1);
    const { data: section } = await iruli.supabase
      .from("walkie_section")
      .select("name")
      .eq("id", walkie![0].section_id)
      .single();
    assert.equal(section?.name, "이루릴 아카이브");
  });

  it("reads backfill and published sources and keeps a shortcode unique", async () => {
    loadEnvLocal();
    const backfill = "/tmp/iruli-backfill-fixture.jsonl";
    const published = "/tmp/iruli-published-fixture.jsonl";
    const shared = {
      posted_at: "2026-11-08T16:30:00+09:00",
      ig_url: `https://www.instagram.com/p/${PREFIX}shared/`,
      ig_shortcode: `${PREFIX}shared`,
      artist: "존재하지않는아티스트XYZ",
      song: "없는곡ABC",
      album: null,
      caption: "overlap",
      hashtags: [],
      sources: [],
      youtube_url: null,
      musicbrainz_id: null,
    };
    writeFileSync(backfill, JSON.stringify({ ...shared, topic: "backfill topic" }) + "\n");
    writeFileSync(
      published,
      JSON.stringify({ ...shared, posted_at: "2026-11-08T17:00:00+09:00", topic: "published topic" }) + "\n",
    );
    const result = spawnSync(
      "npx",
      ["tsx", "scripts/sync-instagram.ts", "--file", backfill, "--file", published],
      { cwd: resolve(process.cwd()), encoding: "utf8", env: process.env },
    );
    unlinkSync(backfill);
    unlinkSync(published);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const anon = client();
    const { data: rows } = await anon
      .from("instagram_post")
      .select("shortcode, topic")
      .eq("shortcode", `${PREFIX}shared`);
    assert.equal(rows?.length, 1);
    assert.equal(rows![0].topic, "published topic");
  });
});
