/**
 * Bulk-approve unique music_candidate rows.
 * Flags ambiguous same-title/same-album MBID collisions for human review.
 * Merges the same work across releases into one song + release_track rows.
 *
 * Usage (requires SUPABASE_SERVICE_ROLE_KEY in .env.local, or call the
 * RPC as an admin from /admin/candidates):
 *   npx tsx scripts/bulk-approve-candidates.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log(
      "No SUPABASE_SERVICE_ROLE_KEY. Use the admin button on /admin/candidates, or run select public.bulk_approve_unique_candidates(); as a project admin.",
    );
    process.exit(0);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("bulk_approve_unique_candidates");
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
