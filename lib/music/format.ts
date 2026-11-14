export function formatDuration(ms: number | null | undefined) {
  if (!ms || ms < 0) return "—";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "";
  return value.slice(0, 10);
}
