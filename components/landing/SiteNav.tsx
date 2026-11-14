export function SiteNav() {
  return (
    <header className="nav">
      <div className="nav-inner">
        <a className="logo" href="#top">
          Records
        </a>
        <nav className="nav-links" aria-label="주요 메뉴">
          <a href="/search">검색</a>
          <a href="/walkie">워키</a>
          <a href="#discovery">라이브러리</a>
          <a href="#myshop">워키</a>
          <a href="#shops">샵</a>
          <a href="#delivery">배송</a>
          <a href="/login">로그인</a>
        </nav>
        <a className="nav-cta" href="#top">
          시작하기
        </a>
      </div>
    </header>
  );
}
