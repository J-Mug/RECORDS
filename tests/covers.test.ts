import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createClient } from "@supabase/supabase-js";
import { AlbumCover } from "../components/catalog/AlbumCover";
import { fetchAlbumCovers } from "../lib/music/covers";

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

describe("Album covers", () => {
  it("renders the typographic placeholder when no URL is provided", () => {
    const html = renderToStaticMarkup(createElement(AlbumCover, { seed: "missing-cover", size: "md" }));
    assert.match(html, /cover-placeholder/);
    assert.doesNotMatch(html, /<img/);
  });

  it("hotlinks a Cover Art Archive thumbnail with lazy loading and attribution", () => {
    const src = "https://coverartarchive.org/release-group/c7711227-3764-4835-aff5-eabd2403f511/front-250";
    const html = renderToStaticMarkup(
      createElement(AlbumCover, {
        seed: "album-1",
        src,
        srcLg: src.replace("front-250", "front-500"),
        size: "lg",
        alt: "Test album cover",
        showAttribution: true,
      }),
    );
    assert.match(html, /cover-art-img/);
    assert.match(html, /loading="lazy"/);
    assert.match(html, /coverartarchive\.org/);
    assert.match(html, /front-500/);
    assert.match(html, /Cover Art Archive/);
    assert.doesNotMatch(html, /cover-placeholder/);
  });

  it("fetchAlbumCovers ignores missing ids and maps ACTIVE rows", async () => {
    const covers = await fetchAlbumCovers(
      {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  in: async () => ({
                    data: [
                      {
                        entity_id: "album-a",
                        source_url: "https://coverartarchive.org/release-group/aaa/front-250",
                        original_url: "https://coverartarchive.org/release-group/aaa/front-500",
                        attribution_text: "Cover: Cover Art Archive",
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      },
      ["album-a", "album-a", null],
    );
    assert.equal(covers.size, 1);
    assert.equal(covers.get("album-a")?.src.includes("front-250"), true);
    assert.equal(covers.get("album-a")?.attribution, "Cover: Cover Art Archive");
  });

  it("public RLS exposes only ACTIVE covers as uncached Cover Art Archive URLs", async () => {
    loadEnvLocal();
    const supabase = client();
    const { data, error } = await supabase
      .from("media_asset")
      .select("id, source_url, original_url, status, cached, attribution_required, attribution_text, license_source")
      .eq("asset_type", "ALBUM_COVER");
    assert.equal(error, null);
    const rows = data ?? [];
    for (const row of rows) {
      assert.equal(row.status, "ACTIVE");
      assert.equal(row.cached, false);
      assert.equal(row.attribution_required, true);
      assert.match(String(row.source_url), /^https:\/\/coverartarchive\.org\//);
      assert.match(String(row.original_url ?? row.source_url), /^https:\/\/coverartarchive\.org\//);
      assert.doesNotMatch(String(row.source_url), /archive\.org\/download/);
      assert.match(String(row.attribution_text), /Cover Art Archive/);
    }
    const { count: published } = await supabase
      .from("album")
      .select("id", { count: "exact", head: true })
      .eq("status", "PUBLISHED");
    assert.ok((published ?? 0) > 0);
    assert.ok(rows.length <= (published ?? 0));
  });
});

after(() => {
  // no-op: keep the suite compatible with other serialized tests
});
