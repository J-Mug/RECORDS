import { WalkieDevice } from "@/components/landing/WalkieDevice";

export function Hero() {
  return (
    <section className="hero" id="top">
      <div className="wrap">
        <p className="kicker">J-Pop Music City</p>
        <h1>
          좋아하는 음악을
          <br />
          <em>진열하고, 나누고, 기록하는 곳.</em>
        </h1>
        <p className="hero-lead">
          RECORDS는 스트리밍 서비스가 아닙니다. 발견하고, Walkie에 모으고, 나만의 Shop에
          취향을 조용히 진열하는 음악 도시입니다.
        </p>
        <div className="hero-actions">
          <a className="btn btn-fill" href="#top">
            시작하기
          </a>
          <a className="btn btn-ghost" href="#discovery">
            라이브러리 둘러보기
          </a>
        </div>
        <WalkieDevice />
      </div>
    </section>
  );
}
