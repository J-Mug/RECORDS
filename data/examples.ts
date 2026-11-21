export const EXAMPLE_NOTICE =
  "오늘의 발견, 장르, 도시 음악 칸은 가상의 예시입니다. Shop 칸은 실제 공개 숍이며, 표지는 Cover Art Archive에서 가져옵니다.";

export type CoverId =
  | "train"
  | "glass"
  | "summer"
  | "night"
  | "cup"
  | "rain"
  | "coast"
  | "antenna";

export type AlbumExample = {
  title: string;
  artist: string;
  cover: CoverId;
};

export type ShopExample = {
  name: string;
  handle: string;
  region: string;
  mood: string;
  covers: CoverId[];
};

export type CityExample = {
  city: string;
  title: string;
  artist: string;
  cover: CoverId;
};

export type GenreExample = {
  name: string;
};

export const discoveryAlbums: AlbumExample[] = [
  { title: "아침 열차", artist: "아오이 하버", cover: "train" },
  { title: "유리 창문", artist: "네온 유키", cover: "glass" },
  { title: "여름의 끝", artist: "카미히코키 클럽", cover: "summer" },
];

export const shops: ShopExample[] = [
  {
    name: "하루 레코드",
    handle: "@haru",
    region: "서울",
    mood: "City Pop",
    covers: ["train", "coast", "cup", "glass", "summer", "rain"],
  },
  {
    name: "모리의 선반",
    handle: "@mori",
    region: "부산",
    mood: "Anime / Rock",
    covers: ["antenna", "night", "summer", "rain", "cup", "coast"],
  },
  {
    name: "소라 진열장",
    handle: "@sora",
    region: "대구",
    mood: "심야 발라드",
    covers: ["rain", "glass", "night", "cup", "train", "antenna"],
  },
];

export const genres: GenreExample[] = [
  { name: "City Pop" },
  { name: "Anime" },
  { name: "Rock" },
  { name: "Idol" },
  { name: "Jazz" },
  { name: "Folk" },
  { name: "Indie" },
  { name: "Night" },
];

export const cities: CityExample[] = [
  { city: "서울", title: "아침 열차", artist: "아오이 하버", cover: "train" },
  { city: "부산", title: "여름의 끝", artist: "카미히코키 클럽", cover: "summer" },
  { city: "대구", title: "비 오는 금요일", artist: "스즈메 레코드", cover: "rain" },
  { city: "인천", title: "옥상 안테나", artist: "네온 유키", cover: "antenna" },
];

export const deliveryTypes = [
  "Postcard 즉시",
  "Express 1시간",
  "Standard 6시간",
  "Long Distance 24시간",
  "Overnight 다음날 아침",
] as const;

export const myShopShelves: { label: string; covers: CoverId[] }[] = [
  { label: "Today’s Pick · 예시 진열", covers: ["train", "glass", "cup", "coast"] },
  { label: "Favorites", covers: ["night", "summer", "rain", "antenna"] },
];
