export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <a className="logo" href="#top">
          Records
        </a>
        <p style={{ color: "var(--muted)", maxWidth: "28em", margin: "0 auto" }}>
          좋아하는 음악을 진열하고, 나누고, 기록하는 곳.
        </p>
        <div className="footer-links">
          <a href="#discovery">라이브러리</a>
          <a href="#myshop">Walkie</a>
          <a href="#shops">Shop</a>
          <a href="#delivery">Music Delivery</a>
          <a href="#top">소개</a>
          <a href="#top">이용약관</a>
          <a href="#top">개인정보처리방침</a>
        </div>
        <p className="footer-note">
          © 2026 RECORDS · Draft B, MUJI / Kinfolk · 앨범 커버는 디자인된 플레이스홀더이며
          실제 음원·아트워크가 아닙니다.
        </p>
      </div>
    </footer>
  );
}
