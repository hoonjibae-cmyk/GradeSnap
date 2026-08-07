import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 답안지 사진은 한 장에 수 MB입니다. 업로드는 Supabase Storage로 직접 올리고
  // 서버 액션에는 큰 바디가 오지 않게 합니다.
  experimental: { serverActions: { bodySizeLimit: "1mb" } },
};

export default nextConfig;
