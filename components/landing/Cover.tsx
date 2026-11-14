import type { CoverId } from "@/data/examples";

type CoverProps = {
  id: CoverId;
  className?: string;
};

export function Cover({ id, className }: CoverProps) {
  return <div className={["cover", `c-${id}`, className].filter(Boolean).join(" ")} />;
}
