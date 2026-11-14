"use client";

import { AlbumCover } from "@/components/catalog/AlbumCover";
import { SaveToWalkie } from "@/components/walkie/SaveToWalkie";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type NowPlaying = {
  songId: string;
  title: string;
  artistName: string;
  videoId: string | null;
  coverUrl?: string | null;
};

type PlayerContextValue = {
  nowPlaying: NowPlaying | null;
  play: (track: NowPlaying) => void;
  stop: () => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

declare global {
  interface Window {
    YT?: {
      Player: new (element: HTMLElement | string, options: Record<string, unknown>) => YtPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

type YtPlayer = {
  loadVideoById: (id: string) => void;
  playVideo: () => void;
  stopVideo: () => void;
  destroy: () => void;
};

function loadYouTubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  return new Promise((resolve) => {
    const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    if (!existing) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.appendChild(script);
    }
    if (window.YT?.Player) resolve();
  });
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const play = useCallback((track: NowPlaying) => setNowPlaying(track), []);
  const stop = useCallback(() => setNowPlaying(null), []);
  const value = useMemo(() => ({ nowPlaying, play, stop }), [nowPlaying, play, stop]);
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}

export function DockPlayer() {
  const { nowPlaying, stop } = usePlayer();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);

  useEffect(() => {
    if (!nowPlaying?.videoId) {
      playerRef.current?.stopVideo?.();
      return;
    }
    let cancelled = false;
    setPlayerError(null);
    void (async () => {
      try {
        await loadYouTubeApi();
        if (cancelled || !hostRef.current) return;
        if (playerRef.current) {
          playerRef.current.loadVideoById(nowPlaying.videoId as string);
          return;
        }
        playerRef.current = new window.YT!.Player(hostRef.current, {
          videoId: nowPlaying.videoId,
          width: "100%",
          height: "100%",
          playerVars: {
            rel: 0,
            playsinline: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (event: { target: YtPlayer }) => event.target.playVideo(),
            onError: () => setPlayerError("이 영상은 재생할 수 없습니다."),
          },
        });
      } catch {
        if (!cancelled) setPlayerError("YouTube 플레이어를 불러오지 못했습니다.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nowPlaying?.videoId]);

  useEffect(() => {
    return () => {
      try {
        playerRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };
  }, []);

  if (!nowPlaying) return null;

  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
    `${nowPlaying.artistName} ${nowPlaying.title}`,
  )}`;

  return (
    <div className="player-dock" role="region" aria-label="재생 중인 곡">
      <div className="player-dock-inner">
        <AlbumCover seed={nowPlaying.songId} size="sm" src={nowPlaying.coverUrl} alt="" className="player-cover" />
        {nowPlaying.videoId ? (
          <div className="player-frame-wrap">
            <div ref={hostRef} className="player-frame" />
          </div>
        ) : (
          <div className="player-fallback">
            <p>연결된 공식 YouTube 영상이 없습니다.</p>
            <a className="btn btn-ghost" href={searchUrl} target="_blank" rel="noreferrer">
              YouTube에서 찾기
            </a>
          </div>
        )}
        <div className="player-meta">
          <p className="player-kicker">Now playing</p>
          <p className="player-title">{nowPlaying.title}</p>
          <p className="player-artist">{nowPlaying.artistName}</p>
          {playerError ? <p className="admin-error">{playerError}</p> : null}
          {!nowPlaying.videoId ? null : (
            <a className="player-yt-link" href={`https://www.youtube.com/watch?v=${nowPlaying.videoId}`} target="_blank" rel="noreferrer">
              YouTube에서 열기
            </a>
          )}
          <div className="player-save">
            <SaveToWalkie songId={nowPlaying.songId} compact />
          </div>
        </div>
        <button className="btn btn-ghost player-close" type="button" onClick={stop}>
          닫기
        </button>
      </div>
    </div>
  );
}
