import { Cover } from "@/components/landing/Cover";
import { ExampleBadge } from "@/components/landing/ExampleBadge";
import { cities } from "@/data/examples";

export function CityMusic() {
  return (
    <section className="block" id="city">
      <div className="wrap">
        <div className="sec-head">
          <p className="sec-kicker">City / Regional</p>
          <h2>도시의 음악</h2>
          <p>
            거주 지역은 넓게만 묻습니다. 정확한 위치는 필요하지 않아요.{" "}
            <ExampleBadge />
          </p>
        </div>
        <div className="city-soft">
          {cities.map((city) => (
            <div className="city-card" key={city.city}>
              <h3>{city.city}</h3>
              <div className="city-song">
                <Cover id={city.cover} />
                <p>
                  {city.title}
                  <span>{city.artist}</span>
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
