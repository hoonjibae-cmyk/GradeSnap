/**
 * 목동유쌤영어 로고.
 *
 * 파일이 아니라 **인라인 SVG**로 둡니다. 로그인 화면에서는 크게, 상단 줄에서는
 * 20px로, 인쇄물에서는 검정 가까이 — 한 파일로는 그 셋을 다 못 맞춥니다.
 *
 * 글자('목동유쌤영어')는 SVG에 넣지 않고 HTML 텍스트로 둡니다. SVG 안의
 * 한글은 보는 기기에 그 폰트가 없으면 깨집니다.
 */

import { ACADEMY } from "@/lib/brand";

export { ACADEMY };

let uid = 0;

/** 왕관 마크만. 색은 그라데이션이 기본이고, `mono`면 한 색으로 칠합니다. */
export function Crown({ className = "h-8 w-auto", mono }: { className?: string; mono?: string }) {
  // 한 화면에 여러 번 그려도 그라데이션 id가 안 부딪히게 합니다.
  const id = `crown-${++uid}`;
  return (
    <svg viewBox="0 0 100 78" className={className} role="img" aria-label="목동유쌤영어">
      {!mono && (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="0.6">
            <stop offset="0" stopColor="#2E6FB7" />
            <stop offset="0.5" stopColor="#2A55A0" />
            <stop offset="1" stopColor="#25356E" />
          </linearGradient>
        </defs>
      )}
      <g fill={mono ?? `url(#${id})`}>
        <path
          d="M7 66 C7 42 9 21 14 8 C19 23 26 37 33 47 C39 35 45 20 50 7
             C55 20 61 35 67 47 C74 37 81 23 86 8 C91 21 93 42 93 66
             C77 73 23 73 7 66 Z"
        />
        <circle cx="14" cy="5" r="2.6" />
        <circle cx="50" cy="4" r="2.6" />
        <circle cx="86" cy="5" r="2.6" />
      </g>
      {/* 가운데 추 — 이 로고에서 가장 눈에 띄는 요소라 작게 그려도 남깁니다 */}
      <path d="M50 9 V44" stroke="#FFFFFF" strokeWidth="2.4" fill="none" />
      <circle cx="50" cy="49" r="6.4" fill="#FFFFFF" />
      <circle cx="26" cy="53" r="5.2" fill="#FFFFFF" />
      <circle cx="74" cy="53" r="5.2" fill="#FFFFFF" />
    </svg>
  );
}

/** 왕관 + 학원 이름. 세로로 쌓는 큰 형태와 가로로 눕히는 작은 형태가 있습니다. */
export function Wordmark({ stacked = false, className = "" }: { stacked?: boolean; className?: string }) {
  if (stacked) {
    return (
      <div className={`flex flex-col items-center ${className}`}>
        <Crown className="h-16 w-auto" />
        <p className="mt-2 text-xl font-black tracking-tight text-[#25356E]">{ACADEMY}</p>
      </div>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <Crown className="h-5 w-auto" />
      <span className="font-bold tracking-tight text-[#25356E]">{ACADEMY}</span>
    </span>
  );
}
