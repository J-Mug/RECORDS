import type { Metadata } from "next";
import { PlayerProvider, DockPlayer } from "@/components/player/PlayerProvider";
import { AuthProvider } from "@/components/auth/AuthProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "RECORDS — 좋아하는 음악을 진열하고, 나누고, 기록하는 곳.",
  description:
    "RECORDS는 스트리밍 서비스가 아닙니다. J-POP을 발견하고, Walkie에 모으고, 나만의 Shop에 취향을 진열하는 음악 도시입니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=Noto+Sans+KR:wght@200;300;400;500&display=swap"
          rel="stylesheet"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
      </head>
      <body><AuthProvider><PlayerProvider>{children}<DockPlayer /></PlayerProvider></AuthProvider></body>
    </html>
  );
}
