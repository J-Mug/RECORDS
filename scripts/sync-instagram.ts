/**
 * Mirror Instagram @iruli.l posts from read-only JSONL files into RECORDS.
 *
 * Default sources (read-only; do not write under /workspace/instagram):
 *   /workspace/instagram/backfill.jsonl   — older posts (may not exist yet)
 *   /workspace/instagram/published.jsonl  — ongoing posts (may not exist yet)
 * Both are optional until they arrive. Upserts are idempotent by shortcode;
 * if the same shortcode appears in both files, published.jsonl wins.
 *
 * Override with one or more --file flags, or INSTAGRAM_JSONL, for fixtures.
 *
 * Auth: signs in as ADMIN_EMAIL / ADMIN_PASSWORD and calls sync_instagram_post.
 * Never auto-publishes catalog rows. Slide paths in the JSONL are ignored.
 *
 *   npm run sync:instagram
 *   npm run sync:instagram -- --file /tmp/fixture.jsonl
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_SOURCES = [
  "/workspace/instagram/backfill.jsonl",
  "/workspace/instagram/published.jsonl",
];

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

function parseArgs(argv: string[]) {
  const files: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--file" && argv[i + 1]) {
      files.push(argv[i + 1]);
      i += 1;
    }
  }
  if (files.length) return { files };
  if (process.env.INSTAGRAM_JSONL) return { files: [process.env.INSTAGRAM_JSONL] };
  return { files: DEFAULT_SOURCES };
}

function parseJsonl(path: string) {
  const text = readFileSync(path, "utf8");
  const rows: unknown[] = [];
  text.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      throw new Error(`Invalid JSONL on line ${index + 1} of ${path}`);
    }
  });
  return rows;
}

function toPayload(raw: unknown) {
  const post = raw as Record<string, unknown>;
  // Drop slide fields so they never reach the database or site.
  return {
    posted_at: post.posted_at,
    ig_url: post.ig_url,
    ig_shortcode: post.ig_shortcode,
    artist: post.artist ?? null,
    song: post.song ?? null,
    album: post.album ?? null,
    topic: post.topic ?? null,
    caption: post.caption ?? null,
    hashtags: Array.isArray(post.hashtags) ? post.hashtags : [],
    sources: Array.isArray(post.sources) ? post.sources : [],
    youtube_url: post.youtube_url ?? null,
    musicbrainz_id: post.musicbrainz_id ?? null,
  };
}

async function main() {
  loadEnvLocal();
  const { files } = parseArgs(process.argv.slice(2));
  const existing = files.filter((file) => existsSync(file));
  const missing = files.filter((file) => !existsSync(file));
  for (const file of missing) {
    console.log(`Source not found yet (skipped): ${file}`);
  }
  if (!existing.length) {
    console.log("No Instagram JSONL sources are available yet. Nothing was written.");
    process.exit(0);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!url || !anon || !email || !password) {
    throw new Error("Need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, ADMIN_EMAIL, and ADMIN_PASSWORD in .env.local");
  }

  const supabase = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`Admin sign-in failed: ${signInError.message}`);

  // Later files win on the same shortcode (published after backfill).
  const byShortcode = new Map<string, ReturnType<typeof toPayload>>();
  const fromFile = new Map<string, string>();
  for (const file of existing) {
    for (const raw of parseJsonl(file)) {
      const payload = toPayload(raw);
      const shortcode = typeof payload.ig_shortcode === "string" ? payload.ig_shortcode.trim() : "";
      if (!shortcode) {
        console.error(`Skipping a row in ${file} with no ig_shortcode`);
        continue;
      }
      byShortcode.set(shortcode, payload);
      fromFile.set(shortcode, file);
    }
  }

  let ok = 0;
  let failed = 0;
  const statuses: Record<string, number> = {};
  for (const [shortcode, payload] of byShortcode) {
    const { data, error } = await supabase.rpc("sync_instagram_post", { p_post: payload });
    if (error) {
      failed += 1;
      console.error(`sync failed for ${shortcode} (${fromFile.get(shortcode)}): ${error.message}`);
      continue;
    }
    ok += 1;
    const status = (data as { match_status?: string })?.match_status ?? "unknown";
    statuses[status] = (statuses[status] ?? 0) + 1;
  }

  console.log(`Synced ${ok} unique post(s) from ${existing.join(", ")} (${failed} failed).`);
  for (const [status, count] of Object.entries(statuses)) {
    console.log(`  ${status}: ${count}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
