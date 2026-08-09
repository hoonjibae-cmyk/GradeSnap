/**
 * 로그인 화면의 겉모습.
 *
 * 원장님이 주신 브랜드 이미지를 CSS로 다시 지은 것입니다 — 파랑에서 청록으로
 * 흐르는 배경, 흩어진 사각형, **모서리에 스캔 표시가 있는 유리 카드**.
 * 그 카드가 로그인 상자입니다. "찍어서 읽는다"가 이 제품의 전부라
 * 로그인 화면부터 그 모양을 하고 있는 편이 맞습니다.
 *
 * 그림 파일 대신 CSS로 짠 이유는 **어느 화면 크기에서도 안 잘리기** 때문입니다.
 * 배경 이미지를 깔면 휴대폰에서는 가운데가 잘리고 PC에서는 늘어납니다.
 */

import { ACADEMY } from "@/lib/brand";

/** 파랑→청록 배경과 장식. 로그인 전 화면은 전부 이 위에 올립니다. */
export function Backdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#0B4FD1]">
      {/* 바탕 — 왼쪽 위 파랑에서 오른쪽 아래 청록으로 */}
      <div className="absolute inset-0 bg-[linear-gradient(150deg,#1247C8_0%,#0C63DC_42%,#12A8C8_78%,#19D3B4_100%)]" />
      {/* 위쪽을 한 번 더 눌러 로고가 뜨게 합니다 */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_70%_at_50%_0%,rgba(10,40,140,0.55),transparent_60%)]" />

      {/* 흩어진 사각형 — 원본 이미지의 '인식 중' 신호 */}
      <Squares />

      <div className="relative flex min-h-dvh flex-col items-center justify-center px-5 py-10">{children}</div>
    </div>
  );
}

/** 위치를 손으로 잡습니다. 난수를 쓰면 볼 때마다 달라져 인상이 안 남습니다. */
const SQUARES = [
  { top: "12%", left: "6%", size: 10, o: 0.35 },
  { top: "17%", left: "12%", size: 16, o: 0.5 },
  { top: "24%", left: "5%", size: 8, o: 0.28 },
  { top: "30%", left: "11%", size: 12, o: 0.4 },
  { top: "14%", right: "8%", size: 12, o: 0.35 },
  { top: "21%", right: "13%", size: 18, o: 0.45 },
  { top: "28%", right: "6%", size: 9, o: 0.3 },
  { bottom: "14%", left: "9%", size: 14, o: 0.3 },
  { bottom: "22%", right: "10%", size: 11, o: 0.32 },
];

function Squares() {
  return (
    <div aria-hidden className="absolute inset-0">
      {SQUARES.map((s, i) => (
        <span
          key={i}
          className="absolute rounded-[3px] bg-cyan-200"
          style={{ ...s, width: s.size, height: s.size, opacity: s.o }}
        />
      ))}
      {/* 반짝임 둘 */}
      <Sparkle className="right-[13%] top-[21%] h-5 w-5 opacity-80" />
      <Sparkle className="left-[11%] top-[27%] h-4 w-4 opacity-60" />
    </div>
  );
}

function Sparkle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`absolute ${className}`} fill="#E6FBFF" aria-hidden>
      <path d="M12 0c.7 5.8 5.5 10.6 12 12-6.5 1.4-11.3 6.2-12 12-.7-5.8-5.5-10.6-12-12C6.5 10.6 11.3 5.8 12 0z" />
    </svg>
  );
}

/** 아이콘 + GradeSnap + 태그라인. */
export function BrandMark() {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative">
        <div className="absolute -inset-3 rounded-[28px] bg-cyan-300/25 blur-xl" aria-hidden />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.png" alt="" className="relative h-20 w-20 rounded-[22px] shadow-lg shadow-blue-950/40" />
      </div>
      <p className="mt-4 text-4xl font-bold tracking-tight text-white">
        Grade<span className="text-cyan-300">Snap</span>
      </p>
      <p className="mt-1.5 text-[11px] font-semibold tracking-[0.32em] text-cyan-100/80">SCAN. GRADE. SUCCEED.</p>
    </div>
  );
}

/**
 * 모서리에 스캔 표시가 있는 유리 카드.
 *
 * 표시는 테두리가 아니라 **네 귀퉁이의 ㄱ자 조각**입니다. 테두리를 두르면
 * 그냥 상자가 되고, 원본 이미지가 말하는 "찍는 자리"라는 뜻이 사라집니다.
 */
export function ScanCard({ children }: { children: React.ReactNode }) {
  const corner = "absolute h-7 w-7 border-white/85";
  return (
    <div className="relative w-full max-w-sm">
      <div className="rounded-2xl border border-white/10 bg-white/15 p-6 shadow-2xl shadow-blue-950/30 backdrop-blur-md">
        {children}
      </div>
      <span aria-hidden className={`${corner} -left-px -top-px rounded-tl-2xl border-l-[3px] border-t-[3px]`} />
      <span aria-hidden className={`${corner} -right-px -top-px rounded-tr-2xl border-r-[3px] border-t-[3px]`} />
      <span aria-hidden className={`${corner} -bottom-px -left-px rounded-bl-2xl border-b-[3px] border-l-[3px]`} />
      <span aria-hidden className={`${corner} -bottom-px -right-px rounded-br-2xl border-b-[3px] border-r-[3px]`} />
    </div>
  );
}

/** 학원 표기. 배경이 파랑이라 흰 왕관을 씁니다. */
export function AcademyLine() {
  return (
    <div className="flex flex-col items-center gap-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/crown-white.svg" alt="" className="h-7 w-auto opacity-95" />
      <p className="text-sm font-bold tracking-tight text-white">{ACADEMY}</p>
      <p className="text-[11px] text-cyan-100/70">직원 전용 · 학원 계정으로만 들어올 수 있습니다</p>
    </div>
  );
}
