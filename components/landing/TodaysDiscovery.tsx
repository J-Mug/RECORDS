import { Cover } from "@/components/landing/Cover";
import { ExampleBadge } from "@/components/landing/ExampleBadge";
import { discoveryAlbums } from "@/data/examples";

export function TodaysDiscovery() {
  return (
    <section className="block" id="discovery">
      <div className="wrap">
        <div className="sec-head">
          <p className="sec-kicker">Today’s Discovery</p>
          <h2>오늘의 발견</h2>
          <p>
            매일 조금씩 바뀌는 도시의 아침. 지금 누군가의 선반 위에 놓인 곡입니다.{" "}
            <ExampleBadge />
          </p>
        </div>
        <div className="album-row">
          {discoveryAlbums.map((album) => (
            <article className="album-card" key={album.title}>
              <div className="cover-frame">
                <Cover id={album.cover} />
              </div>
              <h3>{album.title}</h3>
              <p>{album.artist} · 예시 앨범</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
