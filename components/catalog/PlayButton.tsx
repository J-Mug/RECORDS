"use client";

import { usePlayer, type NowPlaying } from "@/components/player/PlayerProvider";
import { youtubeSearchUrl } from "@/lib/music/youtube";

export function PlayButton({ track }: { track: NowPlaying }) {
  const { play } = usePlayer();
  if (!track.videoId) {
    return (
      <a
        className="btn btn-ghost"
        href={youtubeSearchUrl(track.artistName, track.title)}
        target="_blank"
        rel="noreferrer"
      >
        YouTube에서 찾기
      </a>
    );
  }
  return (
    <button className="btn btn-fill" type="button" onClick={() => play(track)}>
      재생
    </button>
  );
}
