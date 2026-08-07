import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GradeSnap",
  description: "찍으면 채점되는 AI 답안 채점",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
