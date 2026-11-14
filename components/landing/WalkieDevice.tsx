export function WalkieDevice() {
  return (
    <div className="hero-object">
      <div className="surface">
        <div className="walkie-body" role="img" aria-label="Walkie 휴대용 플레이어 일러스트">
          <div className="walkie-screen">
            <span className="walkie-brand">WALKIE</span>
            <span className="walkie-track">아침 열차</span>
            <span className="walkie-artist">아오이 하버 · 예시</span>
          </div>
          <div className="walkie-reels" aria-hidden="true">
            <span className="reel" />
            <span className="reel" />
          </div>
          <div className="walkie-controls" aria-hidden="true">
            <span className="w-btn" />
            <span className="w-btn play" />
            <span className="w-btn" />
          </div>
        </div>
      </div>
      <p className="walkie-cap">Walkie — 나의 음악을 담는 휴대용 플레이어</p>
    </div>
  );
}
