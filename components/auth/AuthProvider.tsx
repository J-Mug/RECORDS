"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import {
  getSupabaseBrowserClient,
  getSupabasePublicConfig,
} from "@/lib/supabase/client";

export type Profile = {
  id: string;
  handle: string;
  display_name: string;
  role: string | null;
};

type AuthContextValue = {
  ready: boolean;
  user: User | null;
  profile: Profile | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (input: {
    email: string;
    password: string;
    handle: string;
    displayName: string;
  }) => Promise<{ error: string | null; needsConfirm: boolean }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const config = useMemo(() => getSupabasePublicConfig(), []);
  const [ready, setReady] = useState(!config.ready);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase
      .from("profiles")
      .select("id, handle, display_name, role")
      .eq("id", userId)
      .maybeSingle();
    setProfile((data as Profile | null) ?? null);
  }, []);

  useEffect(() => {
    if (!config.ready) {
      setReady(true);
      return;
    }
    const supabase = getSupabaseBrowserClient();
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const sessionUser = data.session?.user ?? null;
      setUser(sessionUser);
      if (sessionUser) void loadProfile(sessionUser.id);
      else setProfile(null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionUser = session?.user ?? null;
      setUser(sessionUser);
      if (sessionUser) void loadProfile(sessionUser.id);
      else setProfile(null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [config.ready, loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signUp = useCallback(
    async (input: { email: string; password: string; handle: string; displayName: string }) => {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.auth.signUp({
        email: input.email,
        password: input.password,
        options: {
          data: { handle: input.handle, display_name: input.displayName },
        },
      });
      return {
        error: error?.message ?? null,
        needsConfirm: Boolean(data.user && !data.session),
      };
    },
    [],
  );

  const signOut = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }, []);

  const value = useMemo(
    () => ({ ready, user, profile, signIn, signUp, signOut }),
    [ready, user, profile, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
