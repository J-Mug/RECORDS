import { Cover } from "@/components/landing/Cover";
import { shops } from "@/data/examples";

export function PopularShops() {
  return (
    <section className="block" id="shops">
      <div className="wrap">
        <div className="sec-head">
          <p className="sec-kicker">Popular Shops</p>
          <h2>인기 있는 Shop</h2>
          <p>다른 사람의 쇼윈도를 방문하는 일. 취향이 다음 음악을 안내합니다.</p>
        </div>
        <div className="shop-row">
          {shops.map((shop) => (
            <article key={shop.handle}>
              <div className="shop-room">
                <div className="shop-room-window">
                  {shop.covers.map((cover, index) => (
                    <Cover id={cover} className="mini" key={`${shop.handle}-${index}`} />
                  ))}
                </div>
              </div>
              <div className="shop-meta">
                <h3>{shop.name}</h3>
                <p>
                  {shop.handle} · {shop.region} · {shop.mood} · 예시 Shop
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
