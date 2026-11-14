import { redirect } from "next/navigation";

export const metadata = { title: "이루릴의 J-POP 아카이브 — RECORDS" };

export default function IruliShortLink() {
  redirect("/shop/iruli");
}
