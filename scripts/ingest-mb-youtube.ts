/**
 * Attach song_external_video rows from MusicBrainz URL relations only.
 * Does not scrape or search YouTube. Rate limit: 1 req/s.
 *
 * Usage:
 *   npx tsx scripts/ingest-mb-youtube.ts
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const UA = "RECORDS/0.1 ( https://github.com/J-Mug/RECORDS )";
const MB_BASE = "https://musicbrainz.org/ws/2";
const MIN_INTERVAL_MS = 1200;

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

function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      return id && id.length >= 8 ? id : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      const fromQuery = parsed.searchParams.get("v");
      if (fromQuery) return fromQuery;
      const match = parsed.pathname.match(/\/(embed|shorts|live)\/([^/?]+)/);
      if (match?.[2]) return match[2];
    }
  } catch {
    return null;
  }
  return null;
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
      console.warn(`  MB ${res.status} — retry in ${retryAfter}s`);
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

type Relation = {
  type?: string;
  ended?: boolean;
  url?: { resource?: string; id?: string };
};
type MbRecording = {
  id: string;
  title?: string;
  relations?: Relation[];
};
type VideoRow = {
  id: string;
  song_id: string;
  provider: "youtube";
  video_id: string;
  title: string | null;
  is_official: boolean;
  source_url: string;
  status: "ACTIVE";
};

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const s = String(value);
  return "'" + s.replace(/'/g, "''") + "'";
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing Supabase URL or key");

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Published songs and their recording MBIDs (plus any merged alternate MBIDs).
  async function fetchAll(
    entityType: "SONG" | "ARTIST",
  ): Promise<{ entity_id: string; external_id: string }[]> {
    const all: { entity_id: string; external_id: string }[] = [];
    const page = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("external_source")
        .select("entity_id, external_id")
        .eq("source", "musicbrainz")
        .eq("entity_type", entityType)
        .eq("status", "ACTIVE")
        .range(from, from + page - 1);
      if (error) throw new Error(error.message);
      all.push(...((data ?? []) as { entity_id: string; external_id: string }[]));
      if (!data || data.length < page) break;
      from += page;
    }
    return all;
  }

  const sources = await fetchAll("SONG");
  const songByMbid = new Map<string, string>();
  for (const row of sources) {
    if (row.external_id && row.entity_id) songByMbid.set(row.external_id, row.entity_id);
  }

  const artists = await fetchAll("ARTIST");

  const rows: VideoRow[] = [];
  const seenVideo = new Set<string>();
  const errors: string[] = [];
  let lookedUp = 0;

  for (const artist of artists ?? []) {
    const artistMbid = artist.external_id as string;
    console.log(`→ artist ${artistMbid}`);
    let offset = 0;
    const pageSize = 100;
    try {
      while (true) {
        const data = await mbFetch<{ recordings?: MbRecording[]; "recording-count"?: number }>(
          `/recording?artist=${artistMbid}&inc=url-rels&fmt=json&limit=${pageSize}&offset=${offset}`,
        );
        lookedUp += 1;
        const recordings = data.recordings ?? [];
        for (const rec of recordings) {
          const songId = songByMbid.get(rec.id);
          if (!songId) continue;
          for (const rel of rec.relations ?? []) {
            if (rel.ended) continue;
            const resource = rel.url?.resource;
            if (!resource) continue;
            const videoId = extractYouTubeVideoId(resource);
            if (!videoId) continue;
            const keyVid = `${songId}:${videoId}`;
            if (seenVideo.has(keyVid)) continue;
            seenVideo.add(keyVid);
            const official =
              (rel.type ?? "").toLowerCase().includes("stream") ||
              (rel.type ?? "").toLowerCase().includes("youtube") ||
              (rel.type ?? "").toLowerCase().includes("official");
            rows.push({
              id: randomUUID(),
              song_id: songId,
              provider: "youtube",
              video_id: videoId,
              title: rec.title ?? null,
              is_official: official,
              source_url: resource,
              status: "ACTIVE",
            });
          }
        }
        offset += pageSize;
        const total = data["recording-count"] ?? recordings.length;
        if (offset >= total || recordings.length < pageSize) break;
      }
    } catch (err) {
      const msg = `${artistMbid}: ${(err as Error).message}`;
      errors.push(msg);
      console.warn(`  ! ${msg}`);
    }
  }

  const outDir = resolve(process.cwd(), "scripts/.output");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "youtube.json"), JSON.stringify({ rows, errors }, null, 2));

  const values = rows.map(
    (r) =>
      `(${[
        sqlLiteral(r.id),
        sqlLiteral(r.song_id) + "::uuid",
        sqlLiteral(r.provider),
        sqlLiteral(r.video_id),
        sqlLiteral(r.title),
        r.is_official ? "TRUE" : "FALSE",
        sqlLiteral(r.source_url),
        sqlLiteral(r.status),
      ].join(", ")})`,
  );
  const sql = values.length
    ? `insert into public.song_external_video
  (id, song_id, provider, video_id, title, is_official, source_url, status)
values
${values.join(",\n")}
on conflict on constraint song_external_video_unique do nothing;\n`
    : "-- no youtube url relations found\n";
  writeFileSync(resolve(outDir, "youtube.sql"), sql);

  const summary = {
    artists: artists?.length ?? 0,
    recording_mbids_known: songByMbid.size,
    videos: rows.length,
    lookups: lookedUp,
    errors: errors.length,
  };
  console.log("=== YouTube URL-rel summary ===");
  console.log(JSON.stringify({ ...summary, errors }, null, 2));
  writeFileSync(resolve(outDir, "youtube-summary.json"), JSON.stringify({ summary, errors }, null, 2));

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceKey && rows.length) {
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: insertError } = await admin.from("song_external_video").upsert(rows, {
      onConflict: "provider,video_id",
      ignoreDuplicates: true,
    });
    if (insertError) throw new Error(insertError.message);
    console.log("Inserted via service role:", rows.length);
  } else {
    console.log("Wrote scripts/.output/youtube.sql for MCP execute_sql.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
