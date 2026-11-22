import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGETS_FILE = resolve(process.cwd(), "scripts/instagram-mb-targets.json");

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

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing Supabase public env");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type TargetsFile = {
  not_found: Array<{ post_artist: string; post_song: string }>;
  targets: Array<{
    label: string;
    artist_name: string;
    include_artist?: boolean;
    album_name?: string | null;
    song_name?: string | null;
  }>;
};

/** Instagram post fields that should match the targeted MusicBrainz titles after approval. */
const POSTS = [
  { artist: "요네즈 켄시", song: "Lemon", album: null, target: "Lemon" },
  { artist: "YOASOBI", song: "KILLA", album: null, target: "KILLA" },
  { artist: "Ado", song: "シンカ", album: null, target: "シンカ" },
  { artist: "Mrs. GREEN APPLE", song: "Brand New", album: "POPS", target: "Brand New / POPS" },
  { artist: "요네즈 켄시", song: "IRIS OUT", album: "IRIS OUT / JANE DOE", target: "IRIS OUT" },
  { artist: "Mili", song: "City Blue", album: null, target: "City Blue" },
  { artist: "Eve", song: "AIYOU", album: null, target: "AIYOU" },
  { artist: "요루시카", song: "雲を抜け風下へ私だけ", album: null, target: "雲を抜け風下へ私だけ" },
  { artist: "RADWIMPS", song: "娑婆堕罵 -Shabadaba-", album: null, target: "娑婆堕罵 -Shabadaba-" },
  { artist: "yama", song: null, album: null, target: "yama" },
];

describe("Instagram MusicBrainz targets", () => {
  const file = JSON.parse(readFileSync(TARGETS_FILE, "utf8")) as TargetsFile;

  it("lists the two titles that are not in MusicBrainz", () => {
    const missing = file.not_found.map((row) => row.post_song).sort();
    assert.deepEqual(missing, ["のらねこ", "春が灯り"]);
  });

  it("would link each found post to the targeted titles after approval, without publishing", async () => {
    loadEnvLocal();
    const supabase = client();
    for (const post of POSTS) {
      const target = file.targets.find((row) => row.label === post.target);
      assert.ok(target, `missing target ${post.target}`);
      if (post.song) {
        assert.equal(target.song_name, post.song, `${post.target} song title must match the post for sync`);
        const { data: same, error: sameError } = await supabase.rpc("normalize_music_text", { t: post.song });
        assert.equal(sameError, null, sameError?.message ?? "normalize post song");
        const { data: other, error: otherError } = await supabase.rpc("normalize_music_text", { t: target.song_name });
        assert.equal(otherError, null, otherError?.message ?? "normalize target song");
        assert.equal(same, other, `${post.target} normalized song`);
      }
      if (post.album) {
        assert.equal(target.album_name, post.album, `${post.target} album title must match the post for sync`);
      }
      if (post.artist === "yama" || post.artist === "Mili" || post.artist === "Eve") {
        assert.equal(target.include_artist, true);
        assert.equal(target.artist_name, post.artist);
      }
    }
  });
});
