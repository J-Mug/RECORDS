import { Fragment } from "react";
import { Cover } from "@/components/landing/Cover";
import { myShopShelves } from "@/data/examples";

export function MyShop() {
  return (
    <section className="block" id="myshop">
      <div className="wrap myshop-soft">
        <div className="myshop-copy">
          <p className="sec-kicker">My Shop</p>
          <h2>
            나의 Shop은
            <br />
            쇼윈도입니다
          </h2>
          <p>
            Walkie에는 많이 담아도 됩니다. Shop에는 그중 스무 곡, 서른 곡만 골라 놓으세요.
            방문한 사람이 그 여백에서 다음 곡을 발견합니다.
          </p>
          <p className="flow">
            <b>Library</b> → <b>Walkie</b> → <b>Shop</b> → 발견
          </p>
        </div>
        <div className="shelf">
          {myShopShelves.map((shelf) => (
            <Fragment key={shelf.label}>
              <p className="shelf-label">{shelf.label}</p>
              <div className="shelf-row">
                {shelf.covers.map((cover) => (
                  <Cover id={cover} key={`${shelf.label}-${cover}`} />
                ))}
              </div>
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}
