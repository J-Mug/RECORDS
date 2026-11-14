/**
 * MusicBrainz J-POP seed ingestion for RECORDS.
 *
 * Rate limit: 1 request/second.
 * User-Agent: RECORDS/0.1 ( https://github.com/J-Mug/RECORDS )
 *
 * Inserts into music_candidate as NEEDS_REVIEW (never auto-approved).
 * Duplicate detection is by MusicBrainz MBID (unique indexes).
 * Artwork files are never downloaded or stored; album candidates may
 * get a Cover Art Archive URL reference only (rights: pending review).
 *
 * Usage:
 *   npx tsx scripts/ingest-musicbrainz.ts
 *
 * If SUPABASE_SERVICE_ROLE_KEY is set in .env.local, rows are inserted
 * via the Data API. Otherwise a dump is written for MCP execute_sql.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const UA = "RECORDS/0.1 ( https://github.com/J-Mug/RECORDS )";
const MB_BASE = "https://musicbrainz.org/ws/2";
const SOURCE = "musicbrainz";
const PROVIDER_TERMS = "https://musicbrainz.org/doc/MusicBrainz_API";
const CAA_TERMS = "https://coverartarchive.org/";
const MIN_INTERVAL_MS = 1200;
const MAX_RELEASE_GROUPS = 3;
const MAX_RECORDINGS = 10;

const ARTISTS: { query: string; label: string }[] = [
  { label: "宇多田ヒカル", query: "Utada Hikaru" },
  { label: "米津玄師", query: "Kenshi Yonezu" },
  { label: "YOASOBI", query: "YOASOBI" },
  { label: "Official髭男dism", query: "Official HIGE DANdism" },
  { label: "あいみょん", query: "Aimyon" },
  { label: "藤井風", query: "Fujii Kaze" },
  { label: "King Gnu", query: "King Gnu" },
  { label: "Vaundy", query: "Vaundy" },
  { label: "Aimer", query: "Aimer" },
  { label: "ずっと真夜中でいいのに。", query: "ZUTOMAYO" },
  { label: "Mrs. GREEN APPLE", query: "Mrs. GREEN APPLE" },
  { label: "ヨルシカ", query: "Yorushika" },
  { label: "スピッツ", query: "Spitz" },
  { label: "Perfume", query: "Perfume Japan group" },
  { label: "RADWIMPS", query: "RADWIMPS" },
  { label: "星野源", query: "Gen Hoshino" },
  { label: "サカナクション", query: "Sakanaction" },
  { label: "浜崎あゆみ", query: "Ayumi Hamasaki" },
  { label: "安室奈美恵", query: "Namie Amuro" },
  { label: "LiSA", query: "LiSA Japanese singer" },
  { label: "Ado", query: "Ado Japanese singer" },
  { label: "優里", query: "Yuuri Japanese singer" },
  { label: "back number", query: "back number" },
  { label: "椎名林檎", query: "Sheena Ringo" },
  { label: "東京事変", query: "Tokyo Jihen" },
  { label: "山下達郎", query: "Tatsuro Yamashita" },
  { label: "竹内まりや", query: "Mariya Takeuchi" },
  { label: "松任谷由実", query: "Yumi Matsutoya" },
  { label: "ONE OK ROCK", query: "ONE OK ROCK" },
  { label: "BABYMETAL", query: "BABYMETAL" },
  { label: "クリープハイプ", query: "CreepHyp" },
  { label: "[Alexandros]", query: "[Alexandros]" },
  { label: "Cornelius", query: "Cornelius Keigo Oyamada" },
  { label: "キリンジ", query: "Kirinji" },
  { label: "松原みき", query: "Miki Matsubara" },
  { label: "大貫妙子", query: "Taeko Ohnuki" },
  { label: "菅田将暉", query: "Masaki Suda" },
  { label: "幾田りら", query: "Rira Ikuta" },
  { label: "女王蜂", query: "女王蜂" },
  { label: "いきものがかり", query: "Ikimonogakari" },
  { label: "嵐", query: "Arashi Japanese group" },
  { label: "倉木麻衣", query: "Mai Kuraki" },
  { label: "中島美嘉", query: "Mika Nakashima" },
  { label: "結束バンド", query: "Kessoku Band" },
]


type CandidateKind = "ARTIST" | "ALBUM" | "SONG";

type CandidateRow = {
  id: string;
  source: string;
  source_url: string;
  artist_name: string | null;
  album_name: string | null;
  song_name: string | null;
  release_date: string | null;
  candidate_kind: CandidateKind;
  artist_mbid: string | null;
  album_mbid: string | null;
  song_mbid: string | null;
  status: "NEEDS_REVIEW";
  metadata: Record<string, unknown>;
};

type ExternalRow = {
  entity_type: "CANDIDATE";
  entity_id: string;
  source: string;
  external_id: string;
  source_url: string;
  retrieved_at: string;
  provider_terms_url: string;
  status: "NEEDS_REVIEW";
  metadata: Record<string, unknown>;
};

type MediaRow = {
  entity_type: "CANDIDATE";
  entity_id: string;
  asset_type: "ALBUM_COVER";
  source_type: "COVER_ART_ARCHIVE";
  source_url: string;
  original_url: string;
  rights_type: "UNAVAILABLE";
  license_type: "reference-only";
  license_source: "Cover Art Archive URL reference; pending rights review. File not cached.";
  attribution_required: boolean;
  attribution_text: string;
  cached: boolean;
  status: "NEEDS_REVIEW";
};

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

let lastRequest = 0;
async function mbFetch<T>(pathAndQuery: string): Promise<T> {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequest);
  if (wait > 0) await sleep(wait);
  const url = pathAndQuery.startsWith("http") ? pathAndQuery : `${MB_BASE}${pathAndQuery}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    lastRequest = Date.now();
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (res.status === 503 || res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after")) || 2 + attempt * 2;
      console.warn(`  MB ${res.status} on ${url} — retry in ${retryAfter}s`);
      await sleep(retryAfter * 1000);
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`MusicBrainz ${res.status} ${url}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
  throw new Error(`MusicBrainz retries exhausted: ${url}`);
}

function pickDate(value?: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
  if (!m) return null;
  const y = m[1];
  const mo = m[2] ?? "01";
  const d = m[3] ?? "01";
  return `${y}-${mo}-${d}`;
}

type MbArtist = {
  id: string;
  name: string;
  "sort-name"?: string;
  disambiguation?: string;
  country?: string;
  score?: number;
  type?: string;
};

type MbReleaseGroup = {
  id: string;
  title: string;
  "primary-type"?: string;
  "first-release-date"?: string;
  "secondary-types"?: string[];
  releases?: MbReleaseStub[];
};

type MbReleaseStub = {
  id: string;
  title?: string;
  date?: string;
  country?: string;
  status?: string;
};

type MbRelease = {
  id: string;
  title?: string;
  date?: string;
  country?: string;
  media?: Array<{
    tracks?: Array<{
      title?: string;
      position?: number;
      length?: number;
      recording?: { id: string; title: string; length?: number; disambiguation?: string };
    }>;
  }>;
};

const seenArtist = new Set<string>();
const seenAlbum = new Set<string>();
const seenSong = new Set<string>();
const candidates: CandidateRow[] = [];
const sources: ExternalRow[] = [];
const media: MediaRow[] = [];
const errors: string[] = [];

function addSource(row: CandidateRow, externalId: string, sourceUrl: string) {
  sources.push({
    entity_type: "CANDIDATE",
    entity_id: row.id,
    source: SOURCE,
    external_id: externalId,
    source_url: sourceUrl,
    retrieved_at: new Date().toISOString(),
    provider_terms_url: PROVIDER_TERMS,
    status: "NEEDS_REVIEW",
    metadata: { candidate_kind: row.candidate_kind },
  });
}

function addCandidate(row: Omit<CandidateRow, "id" | "source" | "status"> & { id?: string }) {
  const full: CandidateRow = {
    id: row.id ?? randomUUID(),
    source: SOURCE,
    status: "NEEDS_REVIEW",
    source_url: row.source_url,
    artist_name: row.artist_name,
    album_name: row.album_name,
    song_name: row.song_name,
    release_date: row.release_date,
    candidate_kind: row.candidate_kind,
    artist_mbid: row.artist_mbid,
    album_mbid: row.album_mbid,
    song_mbid: row.song_mbid,
    metadata: row.metadata,
  };
  candidates.push(full);
  return full;
}

async function searchArtist(entry: { query: string; label: string }): Promise<MbArtist | null> {
  const queries = [entry.query, entry.label];
  const seenQ = new Set<string>();
  let list: MbArtist[] = [];
  for (const q of queries) {
    const cleaned = q.trim();
    if (!cleaned || seenQ.has(cleaned)) continue;
    seenQ.add(cleaned);
    const data = await mbFetch<{ artists?: MbArtist[] }>(
      `/artist?query=${encodeURIComponent(cleaned)}&fmt=json&limit=8`,
    );
    list = data.artists ?? [];
    if (list.length) break;
  }
  if (!list.length) {
    const msg = `No MusicBrainz artist for ${entry.label}`;
    errors.push(msg);
    console.warn(`  ! ${msg}`);
    return null;
  }
  const scoreOf = (a: MbArtist) => {
    let s = a.score ?? 0;
    if (a.country === "JP") s += 15;
    const n = a.name.toLowerCase();
    if (n === entry.label.toLowerCase() || n === entry.query.toLowerCase()) s += 25;
    return s;
  };
  return [...list].sort((a, b) => scoreOf(b) - scoreOf(a))[0];
}

async function browseReleaseGroups(artistMbid: string): Promise<MbReleaseGroup[]> {
  // Fetch untyped RGs: some flagship J-POP collections are EPs or compilations, not "Album".
  const data = await mbFetch<{ "release-groups"?: MbReleaseGroup[] }>(
    `/release-group?artist=${artistMbid}&fmt=json&limit=50`,
  );
  const groups = data["release-groups"] ?? [];
  const notSpecial = (g: MbReleaseGroup) => {
    const secondary = g["secondary-types"] ?? [];
    return !secondary.includes("Live") && !secondary.includes("Remix") && !secondary.includes("Interview") && !secondary.includes("Demo");
  };
  const pool = groups.filter(notSpecial);
  const use = pool.length ? pool : groups;
  const typeRank = (g: MbReleaseGroup) => {
    const secondary = g["secondary-types"] ?? [];
    const primary = g["primary-type"];
    if (primary === "Album" && secondary.length === 0) return 0;
    if (primary === "Album") return 1;
    if (primary === "EP") return 2;
    if (primary === "Single") return 3;
    return 4;
  };
  use.sort((a, b) => {
    const byType = typeRank(a) - typeRank(b);
    if (byType !== 0) return byType;
    return (a["first-release-date"] ?? "9999").localeCompare(b["first-release-date"] ?? "9999");
  });
  return use.slice(0, MAX_RELEASE_GROUPS);
}

function pickRelease(rg: MbReleaseGroup): MbReleaseStub | null {
  const releases = rg.releases ?? [];
  if (!releases.length) return null;
  const score = (r: MbReleaseStub) => {
    let s = 0;
    if (r.status === "Official") s += 10;
    if (r.country === "JP") s += 8;
    if (r.country === "XW" || r.country === "JP") s += 2;
    if (r.date) s += 1;
    return s;
  };
  return [...releases].sort((a, b) => score(b) - score(a))[0];
}

async function ingestArtist(entry: { query: string; label: string }) {
  console.log(`\n→ ${entry.label}`);
  const artist = await searchArtist(entry);
  if (!artist) return;
  if (seenArtist.has(artist.id)) {
    console.log(`  skip duplicate artist MBID ${artist.id}`);
    return;
  }
  seenArtist.add(artist.id);
  console.log(`  ${artist.name} (${artist.id}) score=${artist.score ?? "?"}`);

  const artistRow = addCandidate({
    source_url: `https://musicbrainz.org/artist/${artist.id}`,
    artist_name: artist.name,
    album_name: null,
    song_name: null,
    release_date: null,
    candidate_kind: "ARTIST",
    artist_mbid: artist.id,
    album_mbid: null,
    song_mbid: null,
    metadata: {
      seed_label: entry.label,
      name_sort: artist["sort-name"] ?? null,
      artist_disambiguation: artist.disambiguation ?? null,
      country: artist.country ?? null,
      type: artist.type ?? null,
      search_score: artist.score ?? null,
    },
  });
  addSource(artistRow, artist.id, artistRow.source_url);

  const groups = await browseReleaseGroups(artist.id);
  for (const stub of groups) {
    try {
      const rg = await mbFetch<MbReleaseGroup>(
        `/release-group/${stub.id}?inc=releases&fmt=json`,
      );
      if (seenAlbum.has(rg.id)) continue;
      seenAlbum.add(rg.id);

      const albumRow = addCandidate({
        source_url: `https://musicbrainz.org/release-group/${rg.id}`,
        artist_name: artist.name,
        album_name: rg.title,
        song_name: null,
        release_date: pickDate(rg["first-release-date"]),
        candidate_kind: "ALBUM",
        artist_mbid: artist.id,
        album_mbid: rg.id,
        song_mbid: null,
        metadata: {
          primary_type: rg["primary-type"] ?? null,
          secondary_types: rg["secondary-types"] ?? [],
          first_release_date: rg["first-release-date"] ?? null,
          name_sort: artist["sort-name"] ?? null,
          artist_disambiguation: artist.disambiguation ?? null,
        },
      });
      addSource(albumRow, rg.id, albumRow.source_url);

      // Reference-only CAA URL — do not download or cache the file.
      const caaUrl = `https://coverartarchive.org/release-group/${rg.id}/front`;
      media.push({
        entity_type: "CANDIDATE",
        entity_id: albumRow.id,
        asset_type: "ALBUM_COVER",
        source_type: "COVER_ART_ARCHIVE",
        source_url: caaUrl,
        original_url: caaUrl,
        rights_type: "UNAVAILABLE",
        license_type: "reference-only",
        license_source:
          "Cover Art Archive URL reference; pending rights review. File not cached.",
        attribution_required: true,
        attribution_text: `Cover art may be available at Cover Art Archive (${CAA_TERMS}). Rights unconfirmed; not self-hosted.`,
        cached: false,
        status: "NEEDS_REVIEW",
      });

      const release = pickRelease(rg);
      if (!release) {
        errors.push(`No release listed for release-group ${rg.title} (${rg.id})`);
        continue;
      }

      const full = await mbFetch<MbRelease>(
        `/release/${release.id}?inc=recordings&fmt=json`,
      );
      const tracks = (full.media ?? []).flatMap((m) => m.tracks ?? []);
      let added = 0;
      for (const track of tracks) {
        const rec = track.recording;
        if (!rec?.id || !rec.title) continue;
        if (seenSong.has(rec.id)) continue;
        seenSong.add(rec.id);
        const duration = rec.length ?? track.length ?? null;
        const songRow = addCandidate({
          source_url: `https://musicbrainz.org/recording/${rec.id}`,
          artist_name: artist.name,
          album_name: rg.title,
          song_name: rec.title,
          release_date: pickDate(rg["first-release-date"] ?? full.date),
          candidate_kind: "SONG",
          artist_mbid: artist.id,
          album_mbid: rg.id,
          song_mbid: rec.id,
          metadata: {
            duration_ms: duration,
            track_position: track.position ?? null,
            release_mbid: full.id,
            release_title: full.title ?? null,
            release_country: full.country ?? null,
            recording_disambiguation: rec.disambiguation ?? null,
            name_sort: artist["sort-name"] ?? null,
            artist_disambiguation: artist.disambiguation ?? null,
          },
        });
        addSource(songRow, rec.id, songRow.source_url);
        added += 1;
        if (added >= MAX_RECORDINGS) break;
      }
      console.log(`  album: ${rg.title} — ${added} recordings (release ${full.id})`);
    } catch (err) {
      const msg = `Release group ${stub.id} for ${artist.name}: ${(err as Error).message}`;
      errors.push(msg);
      console.warn(`  ! ${msg}`);
    }
  }
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return "'" + s.replace(/'/g, "''") + "'";
}

function writeSqlDump(outDir: string) {
  const chunks: string[] = [];
  const header = `-- Generated by scripts/ingest-musicbrainz.ts
-- Do not run blindly in production without review.
begin;\n`;
  chunks.push(header);

  const candCols = [
    "id", "source", "source_url", "artist_name", "album_name", "song_name",
    "release_date", "candidate_kind", "artist_mbid", "album_mbid", "song_mbid",
    "status", "metadata",
  ] as const;

  const BATCH = 80;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const slice = candidates.slice(i, i + BATCH);
    const values = slice.map((c) => {
      return `(${[
        sqlLiteral(c.id),
        sqlLiteral(c.source),
        sqlLiteral(c.source_url),
        sqlLiteral(c.artist_name),
        sqlLiteral(c.album_name),
        sqlLiteral(c.song_name),
        sqlLiteral(c.release_date),
        sqlLiteral(c.candidate_kind),
        sqlLiteral(c.artist_mbid),
        sqlLiteral(c.album_mbid),
        sqlLiteral(c.song_mbid),
        sqlLiteral(c.status),
        sqlLiteral(JSON.stringify(c.metadata)) + "::jsonb",
      ].join(", ")})`;
    });
    chunks.push(`insert into public.music_candidate (${candCols.join(", ")})
values
${values.join(",\n")}
on conflict do nothing;\n`);
  }

  for (let i = 0; i < sources.length; i += BATCH) {
    const slice = sources.slice(i, i + BATCH);
    const values = slice.map((s) => `(${[
      sqlLiteral(s.entity_type),
      sqlLiteral(s.entity_id) + "::uuid",
      sqlLiteral(s.source),
      sqlLiteral(s.external_id),
      sqlLiteral(s.source_url),
      sqlLiteral(s.retrieved_at) + "::timestamptz",
      sqlLiteral(s.provider_terms_url),
      sqlLiteral(s.status),
      sqlLiteral(JSON.stringify(s.metadata)) + "::jsonb",
    ].join(", ")})`);
    chunks.push(`insert into public.external_source
  (entity_type, entity_id, source, external_id, source_url, retrieved_at, provider_terms_url, status, metadata)
values
${values.join(",\n")}
on conflict on constraint external_source_unique do nothing;\n`);
  }

  for (let i = 0; i < media.length; i += BATCH) {
    const slice = media.slice(i, i + BATCH);
    const values = slice.map((m) => `(${[
      sqlLiteral(m.entity_type),
      sqlLiteral(m.entity_id) + "::uuid",
      sqlLiteral(m.asset_type),
      sqlLiteral(m.source_type),
      sqlLiteral(m.source_url),
      sqlLiteral(m.original_url),
      sqlLiteral(m.rights_type),
      sqlLiteral(m.license_type),
      sqlLiteral(m.license_source),
      m.attribution_required ? "TRUE" : "FALSE",
      sqlLiteral(m.attribution_text),
      m.cached ? "TRUE" : "FALSE",
      sqlLiteral(m.status),
    ].join(", ")})`);
    chunks.push(`insert into public.media_asset
  (entity_type, entity_id, asset_type, source_type, source_url, original_url,
   rights_type, license_type, license_source, attribution_required, attribution_text, cached, status)
values
${values.join(",\n")};\n`);
  }

  chunks.push("commit;\n");
  writeFileSync(resolve(outDir, "ingest.sql"), chunks.join("\n"));
  writeFileSync(
    resolve(outDir, "ingest.json"),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        counts: {
          artists: candidates.filter((c) => c.candidate_kind === "ARTIST").length,
          release_groups: candidates.filter((c) => c.candidate_kind === "ALBUM").length,
          recordings: candidates.filter((c) => c.candidate_kind === "SONG").length,
          candidates: candidates.length,
          external_source: sources.length,
          media_asset: media.length,
        },
        errors,
        candidates,
        external_source: sources,
        media_asset: media,
      },
      null,
      2,
    ),
  );
}

async function insertViaSupabase(url: string, serviceKey: string) {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const batch = 80;
  let insertedCandidates = 0;
  for (let i = 0; i < candidates.length; i += batch) {
    const { data, error } = await supabase
      .from("music_candidate")
      .upsert(candidates.slice(i, i + batch), {
        onConflict: "id",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) throw new Error(`music_candidate insert: ${error.message}`);
    insertedCandidates += data?.length ?? 0;
  }

  for (let i = 0; i < sources.length; i += batch) {
    const { error } = await supabase
      .from("external_source")
      .upsert(sources.slice(i, i + batch), {
        onConflict: "source,entity_type,external_id",
        ignoreDuplicates: true,
      });
    if (error) throw new Error(`external_source insert: ${error.message}`);
  }

  for (let i = 0; i < media.length; i += batch) {
    const { error } = await supabase.from("media_asset").insert(media.slice(i, i + batch));
    if (error) throw new Error(`media_asset insert: ${error.message}`);
  }

  return { insertedCandidates };
}

async function main() {
  loadEnvLocal();
  const outDir = resolve(process.cwd(), "scripts/.output");
  mkdirSync(outDir, { recursive: true });

  for (const entry of ARTISTS) {
    try {
      await ingestArtist(entry);
    } catch (err) {
      const msg = `${entry.label}: ${(err as Error).message}`;
      errors.push(msg);
      console.warn(`! ${msg}`);
    }
  }

  writeSqlDump(outDir);

  const counts = {
    artists: candidates.filter((c) => c.candidate_kind === "ARTIST").length,
    release_groups: candidates.filter((c) => c.candidate_kind === "ALBUM").length,
    recordings: candidates.filter((c) => c.candidate_kind === "SONG").length,
    candidates: candidates.length,
    external_source: sources.length,
    media_asset: media.length,
    errors: errors.length,
  };
  console.log("\n=== Ingestion summary ===");
  console.log(JSON.stringify(counts, null, 2));
  if (errors.length) {
    console.log("Errors:");
    for (const e of errors) console.log(" -", e);
  }
  writeFileSync(resolve(outDir, "summary.json"), JSON.stringify({ counts, errors }, null, 2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceKey) {
    console.log("Inserting via Supabase service role…");
    const result = await insertViaSupabase(url, serviceKey);
    console.log("Inserted (service role):", result);
  } else {
    console.log(
      "No SUPABASE_SERVICE_ROLE_KEY — wrote SQL/JSON dump to scripts/.output/ for MCP execute_sql.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
