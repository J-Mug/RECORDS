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

describe("Walkie RLS and item rules", () => {
  const ids: { a?: string; b?: string; song1?: string; song2?: string; sectionA?: string; itemA?: string; sectionB?: string } = {};
  const created: { itemIds: string[]; sectionIds: string[] } = { itemIds: [], sectionIds: [] };

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
    await a.supabase.from("walkie_item").delete().eq("user_id", ids.a);
    await b.supabase.from("walkie_item").delete().eq("user_id", ids.b);
    await a.supabase.from("walkie_section").delete().eq("user_id", ids.a);
    await b.supabase.from("walkie_section").delete().eq("user_id", ids.b);
    const { data: songs, error } = await client()
      .from("song")
      .select("id")
      .eq("status", "PUBLISHED")
      .limit(2);
    if (error || !songs || songs.length < 2) throw new Error("Need two published songs");
    ids.song1 = songs[0].id;
    ids.song2 = songs[1].id;
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
    if (ids.a) {
      await a.supabase.from("walkie_item").delete().eq("user_id", ids.a);
      await a.supabase.from("walkie_section").delete().eq("user_id", ids.a);
    }
    if (ids.b) {
      await b.supabase.from("walkie_item").delete().eq("user_id", ids.b);
      await b.supabase.from("walkie_section").delete().eq("user_id", ids.b);
    }
  });

  it("rejects unauthorized (anonymous) reads and writes", async () => {
    loadEnvLocal();
    const anon = client();
    const { data, error } = await anon.from("walkie_item").select("id, note");
    assert.equal(error, null);
    assert.deepEqual(data, []);
    const { error: insertError } = await anon.from("walkie_item").insert({
      user_id: ids.a,
      song_id: ids.song1,
    });
    assert.ok(insertError, "anonymous insert should fail");
  });

  it("prevents adding the same song twice", async () => {
    loadEnvLocal();
    const { supabase } = await signIn(process.env.WALKIE_TEST_A_EMAIL!, process.env.WALKIE_TEST_A_PASSWORD!);
    const first = await supabase.rpc("save_to_walkie", { p_song_id: ids.song1, p_section_id: null });
    assert.equal(first.error, null, first.error?.message);
    assert.equal(first.data.created, true);
    ids.itemA = first.data.item.id;
    created.itemIds.push(ids.itemA!);
    const second = await supabase.rpc("save_to_walkie", { p_song_id: ids.song1, p_section_id: null });
    assert.equal(second.error, null, second.error?.message);
    assert.equal(second.data.created, false);
    const { data: rows } = await supabase.from("walkie_item").select("id").eq("song_id", ids.song1);
    assert.equal(rows?.length, 1);
    const { error: insertError } = await supabase.from("walkie_item").insert({
      user_id: ids.a,
      song_id: ids.song1,
    });
    assert.ok(insertError, "unique constraint should reject a second row");
  });

  it("moves an item between sections and reorders it", async () => {
    loadEnvLocal();
    const { supabase } = await signIn(process.env.WALKIE_TEST_A_EMAIL!, process.env.WALKIE_TEST_A_PASSWORD!);
    const { data: section, error } = await supabase
      .from("walkie_section")
      .insert({ user_id: ids.a, name: "CITY POP", sort_order: 0 })
      .select("id")
      .single();
    assert.equal(error, null, error?.message);
    ids.sectionA = section!.id;
    created.sectionIds.push(ids.sectionA!);
    const saved = await supabase.rpc("save_to_walkie", { p_song_id: ids.song2, p_section_id: null });
    assert.equal(saved.error, null, saved.error?.message);
    const itemId = saved.data.item.id as string;
    created.itemIds.push(itemId);
    const moved = await supabase.rpc("move_and_reorder_walkie_items", {
      p_section_id: ids.sectionA,
      p_item_ids: [itemId, ids.itemA],
    });
    assert.equal(moved.error, null, moved.error?.message);
    const { data: rows } = await supabase
      .from("walkie_item")
      .select("id, section_id, sort_order")
      .in("id", [itemId, ids.itemA])
      .order("sort_order");
    assert.equal(rows?.length, 2);
    assert.equal(rows![0].section_id, ids.sectionA);
    assert.equal(rows![0].id, itemId);
    assert.equal(rows![0].sort_order, 0);
    assert.equal(rows![1].section_id, ids.sectionA);
    assert.equal(rows![1].sort_order, 1);
  });

  it("deletes an item for the owner", async () => {
    loadEnvLocal();
    const { supabase } = await signIn(process.env.WALKIE_TEST_A_EMAIL!, process.env.WALKIE_TEST_A_PASSWORD!);
    const { error } = await supabase.from("walkie_item").delete().eq("id", ids.itemA);
    assert.equal(error, null, error?.message);
    const { data } = await supabase.from("walkie_item").select("id").eq("id", ids.itemA);
    assert.equal(data?.length, 0);
  });

  it("blocks horizontal privilege escalation and keeps notes private", async () => {
    loadEnvLocal();
    const a = await signIn(process.env.WALKIE_TEST_A_EMAIL!, process.env.WALKIE_TEST_A_PASSWORD!);
    const saved = await a.supabase.rpc("save_to_walkie", { p_song_id: ids.song1, p_section_id: ids.sectionA });
    assert.equal(saved.error, null, saved.error?.message);
    const privateItem = saved.data.item.id as string;
    created.itemIds.push(privateItem);
    const { error: noteError } = await a.supabase
      .from("walkie_item")
      .update({ note: "secret memo <script>alert(1)</script>" })
      .eq("id", privateItem);
    assert.equal(noteError, null, noteError?.message);

    const b = await signIn(process.env.WALKIE_TEST_B_EMAIL!, process.env.WALKIE_TEST_B_PASSWORD!);
    const { data: visible } = await b.supabase.from("walkie_item").select("id, note, user_id");
    assert.ok(!(visible ?? []).some((row) => row.id === privateItem || row.note?.includes("secret")));

    const { error: stealInsert } = await b.supabase.from("walkie_item").insert({
      user_id: ids.a,
      song_id: ids.song2,
    });
    assert.ok(stealInsert, "B must not insert as A");

    const { error: stealUpdate } = await b.supabase
      .from("walkie_item")
      .update({ note: "hacked" })
      .eq("id", privateItem);
    assert.equal(stealUpdate, null);
    const { data: afterUpdate } = await a.supabase.from("walkie_item").select("note").eq("id", privateItem).single();
    assert.equal(afterUpdate?.note?.startsWith("secret memo"), true);

    const { error: stealDelete } = await b.supabase.from("walkie_item").delete().eq("id", privateItem);
    assert.equal(stealDelete, null);
    const { data: stillThere } = await a.supabase.from("walkie_item").select("id").eq("id", privateItem);
    assert.equal(stillThere?.length, 1);

    const { data: sectionB, error: sectionError } = await b.supabase
      .from("walkie_section")
      .insert({ user_id: ids.b, name: "B only", sort_order: 0 })
      .select("id")
      .single();
    assert.equal(sectionError, null, sectionError?.message);
    ids.sectionB = sectionB!.id;
    const bSaved = await b.supabase.rpc("save_to_walkie", { p_song_id: ids.song1, p_section_id: null });
    assert.equal(bSaved.error, null, bSaved.error?.message);
    const bItem = bSaved.data.item.id as string;
    const { error: crossSection } = await b.supabase
      .from("walkie_item")
      .update({ section_id: ids.sectionA })
      .eq("id", bItem);
    assert.ok(crossSection, "B must not attach an item to A's section");
    const { error: crossRpc } = await b.supabase.rpc("move_and_reorder_walkie_items", {
      p_section_id: ids.sectionA,
      p_item_ids: [bItem],
    });
    assert.ok(crossRpc, "RPC must reject moving into another user's section");
  });
});
