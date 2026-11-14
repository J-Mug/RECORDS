const STYLES = ["train", "glass", "summer", "night", "cup", "rain", "coast", "antenna"] as const;

function hashStyle(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return STYLES[h % STYLES.length];
}

type Props = {
  seed: string;
  className?: string;
  size?: "sm" | "md" | "lg";
};

/** Typographic placeholder only. Third-party artwork is not self-hosted or hot-linked (05_ARTWORK_AND_RIGHTS). */
export function PlaceholderCover({ seed, className, size = "md" }: Props) {
  const style = hashStyle(seed);
  return (
    <div
      className={["cover", `c-${style}`, "cover-placeholder", `cover-${size}`, className]
        .filter(Boolean)
        .join(" ")}
      aria-hidden="true"
    />
  );
}
