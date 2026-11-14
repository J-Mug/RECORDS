import { CityMusic } from "@/components/landing/CityMusic";
import { ExampleBanner } from "@/components/landing/ExampleBanner";
import { Footer } from "@/components/landing/Footer";
import { GenreDiscovery } from "@/components/landing/GenreDiscovery";
import { Hero } from "@/components/landing/Hero";
import { MusicDelivery } from "@/components/landing/MusicDelivery";
import { MyShop } from "@/components/landing/MyShop";
import { PopularShops } from "@/components/landing/PopularShops";
import { SiteNav } from "@/components/landing/SiteNav";
import { TodaysDiscovery } from "@/components/landing/TodaysDiscovery";

export default function HomePage() {
  return (
    <>
      <ExampleBanner />
      <SiteNav />
      <main>
        <Hero />
        <TodaysDiscovery />
        <PopularShops />
        <GenreDiscovery />
        <CityMusic />
        <MusicDelivery />
        <MyShop />
      </main>
      <Footer />
    </>
  );
}
