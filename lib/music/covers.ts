export type AlbumCoverRef = {
  albumId: string;
  src: string;
  srcLg: string | null;
  attribution: string;
};

const ATTR = "Cover: Cover Art Archive";

export async function fetchAlbumCovers(
  supabase: { from: (table: string) => any },
  albumIds: Array<string | null | undefined>,
): Promise<Map<string, AlbumCoverRef>> {
  const ids = [...new Set(albumIds.filter((id): id is string => Boolean(id)))];
  const covers = new Map<string, AlbumCoverRef>();
  if (!ids.length) return covers;
  const { data, error } = await supabase
    .from("media_asset")
    .select("entity_id, source_url, original_url, attribution_text")
    .eq("entity_type", "ALBUM")
    .eq("asset_type", "ALBUM_COVER")
    .eq("status", "ACTIVE")
    .in("entity_id", ids);
  if (error || !data) return covers;
  for (const row of data as Array<{
    entity_id: string;
    source_url: string | null;
    original_url: string | null;
    attribution_text: string | null;
  }>) {
    if (!row.source_url) continue;
    covers.set(row.entity_id, {
      albumId: row.entity_id,
      src: row.source_url,
      srcLg: row.original_url || row.source_url,
      attribution: row.attribution_text || ATTR,
    });
  }
  return covers;
}
