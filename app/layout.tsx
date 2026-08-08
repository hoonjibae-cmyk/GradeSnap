import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GradeSnap",
  description: "찍으면 채점되는 AI 답안 채점",
  appleWebApp: { capable: true, title: "GradeSnap", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#1D5FE8",
  // 조교가 답안지 사진을 확대해 볼 일이 있습니다. 확대를 막지 않습니다.
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
