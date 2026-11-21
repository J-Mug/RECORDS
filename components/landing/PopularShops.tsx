import { AlbumCover } from "@/components/catalog/AlbumCover";
import { loadPopularShops } from "@/lib/shop/load";
import { createPublicSupabaseClient, getSupabasePublicConfig } from "@/lib/supabase/public";

export async function PopularShops() {
  const config = getSupabasePublicConfig();
  const shops = config.ready ? await loadPopularShops(createPublicSupabaseClient()) : [];

  return (
    <section className="block" id="shops">
      <div className="wrap">
        <div className="sec-head">
          <p className="sec-kicker">Popular Shops</p>
          <h2>인기 있는 Shop</h2>
          <p>다른 사람의 쇼윈도를 방문하는 일. 취향이 다음 음악을 안내합니다.</p>
        </div>
        {shops.length === 0 ? (
          <p className="shop-empty">아직 공개된 숍이 없습니다.</p>
        ) : (
          <>
            {shops.some((shop) => shop.covers.length > 0) ? (
              <p className="cover-section-note">Cover: Cover Art Archive</p>
            ) : null}
            <div className="shop-row">
              {shops.map((shop) => (
                <article key={shop.handle}>
                  <a className="shop-card-link" href={`/shop/${shop.handle}`}>
                    <div className="shop-room">
                      <div className="shop-room-window">
                        {shop.covers.length ? (
                          shop.covers.map((cover) => (
                            <AlbumCover
                              key={cover.albumId}
                              seed={cover.albumId}
                              src={cover.src}
                              className="mini"
                              alt=""
                            />
                          ))
                        ) : (
                          <p className="shop-room-empty">아직 진열된 곡이 없습니다.</p>
                        )}
                      </div>
                    </div>
                    <div className="shop-meta">
                      <h3>{shop.name}</h3>
                      <p>
                        @{shop.handle}
                        {shop.region ? ` · ${shop.region}` : ""}
                        {shop.itemCount ? ` · ${shop.itemCount}곡` : ""}
                      </p>
                    </div>
                  </a>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
