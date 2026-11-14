"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { getSupabaseBrowserClient, getSupabasePublicConfig } from "@/lib/supabase/client";

export function SaveToWalkie({
  songId,
  compact = false,
}: {
  songId: string;
  compact?: boolean;
}) {
  const { ready, user } = useAuth();
  const pathname = usePathname();
  const config = getSupabasePublicConfig();
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!config.ready || !user) {
      setSaved(false);
      return;
    }
    const supabase = getSupabaseBrowserClient();
    const { data, error: queryError } = await supabase
      .from("walkie_item")
      .select("id")
      .eq("song_id", songId)
      .maybeSingle();
    if (queryError) {
      setError(queryError.message);
      return;
    }
    setSaved(Boolean(data));
  }, [config.ready, songId, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!ready) return null;

  if (!user) {
    const next = `${pathname}`;
    return (
      <a className="btn btn-ghost" href={`/login?next=${encodeURIComponent(next)}`}>
        {compact ? "워키에 담기" : "워키에 담기"}
      </a>
    );
  }

  async function onSave() {
    if (saved || pending) return;
    setPending(true);
    setError(null);
    const supabase = getSupabaseBrowserClient();
    const { data, error: rpcError } = await supabase.rpc("save_to_walkie", {
      p_song_id: songId,
      p_section_id: null,
    });
    setPending(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setSaved(true);
    void data;
  }

  return (
    <span className="save-walkie">
      <button
        className={saved ? "btn btn-ghost" : "btn btn-fill"}
        type="button"
        disabled={saved || pending}
        onClick={() => void onSave()}
        aria-pressed={saved}
      >
        {pending ? "담는 중…" : saved ? "워키에 담김" : "워키에 담기"}
      </button>
      {error ? <span className="admin-error">{error}</span> : null}
    </span>
  );
}
