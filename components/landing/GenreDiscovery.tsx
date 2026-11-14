import { genres } from "@/data/examples";

export function GenreDiscovery() {
  return (
    <section className="block" id="genre">
      <div className="wrap">
        <div className="sec-head">
          <p className="sec-kicker">Music / Genre</p>
          <h2>장르로 발견하기</h2>
        </div>
        <div className="genre-soft">
          {genres.map((genre) => (
            <a className="genre-chip" href="#genre" key={genre.name}>
              {genre.name}
            </a>
          ))}
        </div>
        <p className="genre-note">라이브러리는 세상의 음악, Walkie는 나의 음악입니다.</p>
      </div>
    </section>
  );
}
