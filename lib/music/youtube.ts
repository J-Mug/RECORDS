export function extractYouTubeVideoId(url: string): string | null {
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

export function youtubeSearchUrl(artist: string, title: string) {
  const q = [artist, title].filter(Boolean).join(" ");
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}

export function youtubeWatchUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}
