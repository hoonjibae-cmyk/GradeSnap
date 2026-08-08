import type { MetadataRoute } from "next";

/**
 * 조교는 휴대폰으로 씁니다. 홈 화면에 추가하면 주소창 없이 앱처럼 뜨고,
 * **그게 하루 종일 열어두는 화면에 맞습니다.**
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GradeSnap — 찍으면 채점",
    short_name: "GradeSnap",
    description: "답안지를 찍어 올리면 채점하고, 재시험 명단까지 만듭니다.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#1D5FE8",
    lang: "ko",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
