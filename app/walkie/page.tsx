import { CatalogNav } from "@/components/catalog/CatalogNav";
import { WalkieBoard } from "@/components/walkie/WalkieBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Walkie — RECORDS" };

export default function WalkiePage() {
  return (
    <div className="catalog-shell">
      <CatalogNav />
      <main className="catalog-main">
        <p className="kicker">Private warehouse</p>
        <h1 className="admin-title">워키</h1>
        <WalkieBoard />
      </main>
    </div>
  );
}
