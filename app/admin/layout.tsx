export const metadata = {
  title: "RECORDS — Admin",
};

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="admin-shell">
      <header className="admin-bar">
        <a className="logo" href="/">
          Records
        </a>
        <nav className="admin-bar-links">
          <a href="/admin/candidates">Candidates</a>
          <a href="/">홈</a>
        </nav>
      </header>
      {children}
    </div>
  );
}
