"use client";

import { useState } from "react";
import { PlaceholderCover } from "@/components/catalog/PlaceholderCover";

type Props = {
  src?: string | null;
  srcLg?: string | null;
  seed: string;
  size?: "sm" | "md" | "lg";
  alt?: string;
  showAttribution?: boolean;
  className?: string;
};

/** Hotlinked Cover Art Archive thumbnail. Falls back to the typographic block if missing or on error. Never self-hosts the file. */
export function AlbumCover({ src, srcLg, seed, size = "md", alt = "", showAttribution = false, className }: Props) {
  const [failed, setFailed] = useState(false);
  const url = (size === "lg" ? srcLg || src : src) || null;
  if (!url || failed) {
    return <PlaceholderCover seed={seed} size={size} className={className} />;
  }
  return (
    <figure className={["cover-art", `cover-${size}`, className].filter(Boolean).join(" ")}>
      <img
        className="cover-art-img"
        src={url}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
      {showAttribution ? (
        <figcaption className="cover-attribution">
          Cover:{" "}
          <a href="https://coverartarchive.org/" target="_blank" rel="noreferrer">
            Cover Art Archive
          </a>
        </figcaption>
      ) : null}
    </figure>
  );
}
