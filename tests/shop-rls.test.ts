import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

const SECRET_NOTE = "SECRET_WALKIE_NOTE_DO_NOT_LEAK";

describe("Shop RLS and display rules", () => {
  const ids: {
    a?: string;
    b?: string;
    song1?: string;
    song2?: string;
    shopA?: string;
    shopB?: string;
    itemA?: string;
  } = {};

  before(async () => {
    loadEnvLocal();
    const emailA = process.env.WALKIE_TEST_A_EMAIL;
    const passA = process.env.WALKIE_TEST_A_PASSWORD;
    const emailB = process.env.WALKIE_TEST_B_EMAIL;
    const passB = process.env.WALKIE_TEST_B_PASSWORD;
    if (!emailA || !passA || !emailB || !passB) {
      throw new Error("WALKIE_TEST_* credentials missing from .env.local");
    }
    const a = await signIn(emailA, passA);
    const b = await signIn(emailB, passB);
    ids.a = a.user.id;
    ids.b = b.user.id;
    await a.supabase.from("shop_item").delete().eq("shop_id", (await a.supabase.from("shop").select("id").eq("user_id", ids.a).single()).data!.id);
    await b.supabase.from("shop_item").delete().eq("shop_id", (await b.supabase.from("shop").select("id").eq("user_id", ids.b).single()).data!.id);
    await a.supabase.from("walkie_item").delete().eq("user_id", ids.a);
    await b.supabase.from("walkie_item").delete().eq("user_id", ids.b);
    const shopA = await a.supabase.from("shop").select("id").eq("user_id", ids.a).single();
    const shopB = await b.supabase.from("shop").select("id").eq("user_id", ids.b).single();
    if (shopA.error || shopB.error || !shopA.data || !shopB.data) throw new Error("test users must have shops");
    ids.shopA = shopA.data.id;
    ids.shopB = shopB.data.id;
    const { data: songs, error } = await client().from("song").select("id").eq("status", "PUBLISHED").limit(2);
    if (error || !songs || songs.length < 2) throw new Error("Need two published songs");
    ids.song1 = songs[0].id;
    ids.song2 = songs[1].id;
    const saved = await a.supabase.rpc("save_to_walkie", { p_song_id: ids.song1, p_section_id: null });
    if (saved.error) throw new Error(saved.error.message);
    const { error: noteError } = await a.supabase
      .from("walkie_item")
      .update({ note: SECRET_NOTE })
      .eq("user_id", ids.a)
      .eq("song_id", ids.song1);
    if (noteError) throw new Error(noteError.message);
  });

  after(async () => {
    loadEnvLocal();
    const emailA = process.env.WALKIE_TEST_A_EMAIL;
    const passA = process.env.WALKIE_TEST_A_PASSWORD;
    const emailB = process.env.WALKIE_TEST_B_EMAIL;
    const passB = process.env.WALKIE_TEST_B_PASSWORD;
    if (!emailA || !passA || !emailB || !passB) return;
    const a = await signIn(emailA, passA);
    const b = await signIn(emailB, passB);
    if (ids.shopA) await a.supabase.from("shop_item").delete().eq("shop_id", ids.shopA);
    if (ids.shopB) await b.supabase.from("shop_item").delete().eq("shop_id", ids.shopB);
    if (ids.a) await a.supabase.from("walkie_item").delete().eq("user_id", ids.a);
    if (ids.b) await b.supabase.from("walkie_item").delete().eq("user_id", ids.b);
  });

  it("rejects unauthorized (anonymous) writes and keeps shops readable", async () => {
    loadEnvLocal();
    const anon = client();
    const { data, error } = await anon.from("shop").select("id, name, user_id").eq("id", ids.shopA);
    assert.equal(error, null);
    assert.equal(data?.length, 1);
    const { error: insertError } = await anon.from("shop_item").insert({
      shop_id: ids.shopA,
      song_id: ids.song1,
    });
    assert.ok(insertError, "anonymous insert should fail");
    const { error: updateError } = await anon.from("shop").update({ name: "hacked" }).eq("id", ids.shopA);
    assert.equal(updateError, null);
    const { data: after } = await anon.from("shop").select("name").eq("id", ids.shopA).single();
    assert.notEqual(after?.name, "hacked");
  });

  it("displays a walkie song, prevents duplicates, and does not copy the walkie note", async () => {
    loadEnvLocal();
    const { supabase } = await signIn(process.env.WALKIE_TEST_A_EMAIL!, process.env.WALKIE_TEST_A_PASSWORD!);
    const first = await supabase.rpc("display_on_shop", { p_song_id: ids.song1, p_comment: "public caption" });
    assert.equal(first.error, null, first.error?.message);
    assert.equal(first.data.created, true);
    assert.equal(first.data.item.note, "public caption");
    assert.equal(String(first.data.item.note).includes("SECRET"), false);
    ids.itemA = first.data.item.id;
    const second = await supabase.rpc("display_on_shop", { p_song_id: ids.song1, p_comment: "ignored" });
    assert.equal(second.error, null, second.error?.message);
    assert.equal(second.data.created, false);
    assert.equal(second.data.item.note, "public caption");
    const { data: rows } = await supabase.from("shop_item").select("id, note").eq("shop_id", ids.shopA).eq("song_id", ids.song1);
    assert.equal(rows?.length, 1);
    const { error: insertError } = await supabase.from("shop_item").insert({
      shop_id: ids.shopA,
      song_id: ids.song1,
    });
    assert.ok(insertError, "unique constraint should reject a second display");
  });

  it("does not expose walkie notes through shop reads", async () => {
    loadEnvLocal();
    const anon = client();
    const { data: shopItems, error } = await anon
      .from("shop_item")
      .select("id, note, song_id, shop_id")
      .eq("shop_id", ids.shopA);
    assert.equal(error, null);
    assert.ok((shopItems ?? []).length >= 1);
    assert.ok(!(shopItems ?? []).some((row) => (row.note ?? "").includes("SECRET")));
    const { data: walkie } = await anon.from("walkie_item").select("id, note, user_id");
    assert.deepEqual(walkie, []);
    const b = await signIn(process.env.WALKIE_TEST_B_EMAIL!, process.env.WALKIE_TEST_B_PASSWORD!);
    const { data: bWalkie } = await b.supabase.from("walkie_item").select("id, note, user_id").eq("user_id", ids.a);
    assert.equal((bWalkie ?? []).length, 0);
    const { data: bShop } = await b.supabase.from("shop_item").select("note").eq("id", ids.itemA).single();
    assert.equal(bShop?.note, "public caption");
  });

  it("blocks horizontal privilege escalation", async () => {
    loadEnvLocal();
    const a = await signIn(process.env.WALKIE_TEST_A_EMAIL!, process.env.WALKIE_TEST_A_PASSWORD!);
    const b = await signIn(process.env.WALKIE_TEST_B_EMAIL!, process.env.WALKIE_TEST_B_PASSWORD!);
    const { error: stealInsert } = await b.supabase.from("shop_item").insert({
      shop_id: ids.shopA,
      song_id: ids.song1,
    });
    assert.ok(stealInsert, "B must not insert into A's shop");

    await b.supabase.rpc("save_to_walkie", { p_song_id: ids.song2, p_section_id: null });
    const { error: stealWithOwnSong } = await b.supabase.from("shop_item").insert({
      shop_id: ids.shopA,
      song_id: ids.song2,
    });
    assert.ok(stealWithOwnSong, "B must not attach an item to A's shop");

    const { error: stealUpdate } = await b.supabase.from("shop_item").update({ note: "hacked" }).eq("id", ids.itemA);
    assert.equal(stealUpdate, null);
    const { data: afterUpdate } = await a.supabase.from("shop_item").select("note").eq("id", ids.itemA).single();
    assert.equal(afterUpdate?.note, "public caption");

    const { error: stealShop } = await b.supabase.from("shop").update({ name: "stolen", introduction: "nope" }).eq("id", ids.shopA);
    assert.equal(stealShop, null);
    const { data: shopAfter } = await a.supabase.from("shop").select("name, introduction").eq("id", ids.shopA).single();
    assert.notEqual(shopAfter?.name, "stolen");
    assert.notEqual(shopAfter?.introduction, "nope");

    const { error: stealDelete } = await b.supabase.from("shop_item").delete().eq("id", ids.itemA);
    assert.equal(stealDelete, null);
    const { data: stillThere } = await a.supabase.from("shop_item").select("id").eq("id", ids.itemA);
    assert.equal(stillThere?.length, 1);

    const { error: stealReorder } = await b.supabase.rpc("reorder_shop_items", { p_item_ids: [ids.itemA] });
    assert.ok(stealReorder, "RPC must reject reordering another user's items");

    const displayWithoutWalkie = await a.supabase.rpc("display_on_shop", { p_song_id: ids.song2, p_comment: null });
    assert.ok(displayWithoutWalkie.error, "cannot display a song that is not in Walkie");
  });
});
