import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Crown } from "@/components/Logo";
import { ACADEMY } from "@/lib/brand";

export const metadata: Metadata = {
  title: "자동채점 사용 가이드",
  description: `${ACADEMY} 직원용 자동채점 사용 가이드`,
  robots: { index: false, follow: false },
};

const toc = [
  ["scope", "사용 범위"],
  ["account", "1. 로그인과 계정"],
  ["intake", "2. 촬영과 접수"],
  ["status", "3. 채점 상태"],
  ["review", "4. 검수와 확정"],
  ["keys", "5. 정답지 등록"],
  ["roster", "6. 명단 확인"],
  ["rules", "7. 보안 원칙"],
  ["trouble", "문제 해결"],
] as const;

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="inline-flex items-center gap-2.5 font-bold tracking-tight">
            <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-blue-700 to-cyan-500 text-white shadow-lg shadow-blue-900/15">
              <Crown className="h-5 w-auto" />
            </span>
            <span>
              자동채점
              <small className="block text-[11px] font-semibold tracking-[0.14em] text-slate-400">GRADESNAP GUIDE</small>
            </span>
          </Link>
          <nav className="flex items-center gap-2" aria-label="바로가기">
            <a href="https://portal.yussam.com" className="hidden rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-300 sm:inline-flex">
              워크스페이스
            </a>
            <Link href="/" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-800">
              자동채점 열기 ↗
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 pt-5 sm:px-6 sm:pt-9">
        <div className="relative overflow-hidden rounded-[2rem] bg-[linear-gradient(125deg,#071a45_0%,#114eb8_58%,#09aaca_100%)] px-6 py-10 text-white shadow-[0_24px_70px_rgba(15,52,110,.22)] sm:px-12 sm:py-14 lg:px-16">
          <div className="absolute -right-16 -top-24 size-72 rounded-full border-[46px] border-white/5" />
          <div className="absolute -bottom-28 right-56 size-56 rounded-full bg-cyan-300/10" />
          <div className="relative max-w-3xl">
            <p className="text-sm font-bold tracking-[0.18em] text-cyan-200">YUSSAM WORKSPACE · USER GUIDE</p>
            <h1 className="mt-4 text-4xl font-black tracking-[-0.045em] sm:text-5xl lg:text-6xl">
              찍고, 확인하고,<br />확정하면 끝납니다.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-blue-100 sm:text-lg">
              재시험 답안지를 촬영해 접수하고, 자동채점 결과를 사람이 검수한 뒤 명단으로 정리하는 전체 과정을 안내합니다.
            </p>
            <div className="mt-7 flex flex-wrap gap-2.5">
              <a href="#quick" className="rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-blue-800 shadow-lg shadow-blue-950/15">1분 사용법 보기</a>
              <Link href="/" className="rounded-xl border border-white/25 bg-white/10 px-5 py-2.5 text-sm font-bold text-white">바로 접수하기</Link>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-7 px-4 py-7 sm:px-6 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="sticky top-24 hidden self-start rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:block">
          <p className="px-2 pb-2 text-xs font-bold tracking-[0.12em] text-slate-400">가이드 목차</p>
          <nav className="space-y-0.5" aria-label="가이드 목차">
            {toc.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="block rounded-lg px-2 py-2 text-sm font-medium text-slate-600 hover:bg-blue-50 hover:text-blue-700">{label}</a>
            ))}
          </nav>
        </aside>

        <div className="min-w-0">
          <section id="scope" className="scroll-mt-24 overflow-hidden rounded-2xl border border-rose-200 bg-white shadow-sm">
            <div className="border-l-4 border-rose-500 p-5 sm:p-6">
              <p className="text-xs font-black tracking-[0.14em] text-rose-600">사용 전에 먼저 확인</p>
              <h2 className="mt-2 text-xl font-black tracking-tight sm:text-2xl">재시험 답안지만, 채점이 밀릴 때만 사용합니다.</h2>
              <p className="mt-3 leading-7 text-slate-600">
                재시험도 손으로 채점하는 것이 원칙입니다. 답안지가 쌓여 학생을 기다리게 할 것 같을 때 사용하세요.
                <strong className="text-slate-950"> 클리닉 본 시험과 인클래스 테스트 답안지는 어떤 경우에도 올리지 않습니다.</strong>
              </p>
            </div>
          </section>

          <section id="quick" className="mt-5 grid scroll-mt-24 grid-cols-2 gap-3 md:grid-cols-4">
            <QuickStep n="1" title="한 명씩 촬영" body="양면이면 앞·뒤 모두" />
            <QuickStep n="2" title="바로 접수" body="채점은 뒤에서 진행" />
            <QuickStep n="3" title="사진과 대조" body="전사·판정 직접 검수" />
            <QuickStep n="4" title="PASS/FAIL 확정" body="확정 결과만 명단 반영" />
          </section>

          <GuideSection id="account" n="01" title="로그인하고 계정 승인을 받습니다" lead="처음 한 번만 계정을 만들고 관리자의 승인을 받으면 됩니다.">
            <ol className="space-y-3">
              <Step n="1"><Link href="/signup" className="font-bold text-blue-700 underline">계정 만들기</Link>에서 이름(실명)·이메일·비밀번호를 입력합니다.</Step>
              <Step n="2">가입하면 관리자에게 승인 신청이 전달됩니다. 가입만으로는 답안지 화면이 열리지 않습니다.</Step>
              <Step n="3">승인 후 로그인합니다. 승인 대기 화면이라면 <b>승인됐는지 확인</b>을 눌러 보세요.</Step>
            </ol>
            <Callout>임시 비밀번호를 받았다면 로그인 후 <b>내 계정</b>에서 바로 바꾸세요. 로그인할 수 없으면 관리자에게 재발급을 요청합니다.</Callout>
            <Screenshot src="/help/01-login.png" alt="자동채점 로그인 화면" caption="로그인 화면은 사용 안내를 계정 없이도 열 수 있게 구성되어 있습니다." />
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <MiniCard title="아이폰 Safari">공유 버튼 → 홈 화면에 추가</MiniCard>
              <MiniCard title="안드로이드 Chrome">오른쪽 위 ⋮ → 홈 화면에 추가</MiniCard>
            </div>
            <p className="mt-3 text-sm text-slate-500">늘 같은 브라우저나 홈 화면 아이콘으로 열어야 로그인 상태가 이어집니다.</p>
          </GuideSection>

          <GuideSection id="intake" n="02" title="한 학생의 답안지를 촬영해 접수합니다" lead="여러 명을 모아 한꺼번에 올리지 않고, 학생이 제출하는 즉시 한 명씩 처리합니다.">
            <Screenshot src="/help/02-intake.png" alt="반과 학생 이름, 답안지 사진을 확인하고 접수하는 화면" caption="실제 접수 화면과 같은 구성입니다. 화면 속 이름과 반은 설명용 가상 정보입니다." />
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <CheckItem title="반">입력하면 반별 명단에 반영됩니다. 접수 후 비워지며, 최근 반 버튼으로 다시 선택할 수 있습니다.</CheckItem>
              <CheckItem title="학생 이름">알면 입력하고 모르면 비워 둡니다. 비워 두면 시험지 머리말에서 읽습니다.</CheckItem>
              <CheckItem title="답안지 사진">양면이면 앞·뒤를 모두 올립니다. 순서는 상관없이 문항 번호로 합칩니다.</CheckItem>
              <CheckItem title="철자 엄격">학원 방침에 따라 정한 설정입니다. 학생마다 임의로 바꾸지 않습니다.</CheckItem>
            </div>
            <Callout tone="warn">한 번에 한 학생의 답안지만 올리세요. 종이 전체와 문항 번호가 보이도록 세워서 찍고, 그림자·손가락·잘린 모서리가 없는지 확인합니다.</Callout>
            <ol className="mt-5 space-y-3">
              <Step n="1">상단 날짜가 오늘인지 확인하고 반과 학생 이름을 입력합니다.</Step>
              <Step n="2">답안지 전체를 촬영합니다. 가로로 누운 사진은 ↺ ↻ 버튼으로 바로 세웁니다.</Step>
              <Step n="3"><b>접수하고 채점 시작</b>을 누릅니다. 채점 결과를 기다리지 말고 다음 학생을 받습니다.</Step>
            </ol>
          </GuideSection>

          <GuideSection id="status" n="03" title="채점 상태를 확인하고 필요한 조치를 합니다" lead="접수 목록에서 진행 상태와 사람이 확인해야 할 답안지를 구분합니다.">
            <Screenshot src="/help/03-status.png" alt="대기, 채점 중, 채점됨, 확정 상태가 표시된 접수 목록" caption="‘채점됨’ 줄 전체를 누르면 검수 화면으로 이동합니다." />
            <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <StatusRow badge="대기 · 채점 중" tone="blue">자동채점이 진행 중입니다. 그대로 두고 다음 학생을 받습니다.</StatusRow>
              <StatusRow badge="채점됨" tone="amber">채점이 끝났습니다. 해당 줄을 눌러 사람이 검수합니다.</StatusRow>
              <StatusRow badge="확정" tone="green">검수와 최종 판단이 끝났습니다. 이 결과만 명단에 반영됩니다.</StatusRow>
              <StatusRow badge="실패" tone="red">다시를 누릅니다. 반복되면 사진을 새로 찍어 다시 접수합니다.</StatusRow>
              <StatusRow badge="중단됨" tone="slate">결과가 없습니다. 빠진 장을 포함해 다시 접수합니다.</StatusRow>
            </div>
            <Callout tone="warn">뒷장을 빠뜨렸거나 다른 학생 사진을 올렸다면 즉시 <b>중단</b>하세요. 대기 상태에서는 비용이 들지 않지만, 채점이 시작된 뒤에는 그때까지 사용된 비용이 남습니다.</Callout>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <MiniCard title="🔶 커트라인">한두 문항으로 결과가 달라질 수 있어 반드시 직접 확인합니다.</MiniCard>
              <MiniCard title="⚠️ 밀림">번호와 답이 어긋날 수 있으므로 사진과 전사를 대조합니다.</MiniCard>
              <MiniCard title="📄 일부만 찍힘">빠진 장이 있습니다. 중단한 뒤 모든 면을 다시 접수합니다.</MiniCard>
              <MiniCard title="직접 채점할 문항">정답을 알 수 없는 문항입니다. 검수 화면에서 사람이 ○ 또는 ✗를 선택합니다.</MiniCard>
            </div>
          </GuideSection>

          <GuideSection id="review" n="04" title="원본 사진과 자동채점 결과를 대조합니다" lead="자동채점은 초안입니다. 최종 PASS/FAIL은 확인한 사람이 확정합니다.">
            <Screenshot src="/help/04-review.png" alt="원본 답안지와 전사 결과를 나란히 확인하는 검수 화면" caption="실제 검수 화면과 같은 구성입니다. 답안 내용은 설명용 가상 정보입니다." />
            <ol className="mt-6 space-y-3">
              <Step n="1">원본 사진을 눌러 크게 보고, <b>학생이 쓴 것</b>이 종이와 같은지 문항별로 확인합니다.</Step>
              <Step n="2">판정이 다르면 ○ 또는 ✗로 고칩니다. 사람이 바꾼 결과는 기록에 남습니다.</Step>
              <Step n="3">학생 이름이나 반이 잘못 읽혔다면 <b>이름·반 고치기</b>로 수정합니다. 다시 채점할 필요는 없습니다.</Step>
              <Step n="4">직접 채점할 문항을 모두 처리한 뒤 <b>PASS로 확정</b> 또는 <b>FAIL로 확정</b>을 누릅니다.</Step>
            </ol>
            <Callout tone="warn">학생의 오타를 실제 단어로 고쳐 읽는 경우는 확신도가 높게 표시될 수도 있습니다. 커트라인 근처 답안지는 특히 원본 사진을 직접 확인하세요.</Callout>
            <Callout>순서배열·문장삽입처럼 답이 지문에 달린 문항은 <b>정답 모름 — 직접 채점</b>으로 표시됩니다. 사람이 판정하기 전까지 PASS/FAIL이 나오지 않을 수 있습니다.</Callout>
          </GuideSection>

          <GuideSection id="keys" n="05" title="필요한 시험은 정답지를 먼저 등록합니다" lead="순서배열·문장삽입 문항을 자동으로 판정하려면 해당 시험의 정답지가 필요합니다.">
            <Screenshot src="/help/05-keys.png" alt="구글 폴더에서 정답지 파일을 읽고 등록하는 화면" caption="구글 폴더의 답지를 읽은 뒤 번호와 정답을 확인하고 등록합니다." />
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <MiniCard title="구글 폴더에서 가져오기">‘답지’가 포함된 파일을 찾아 읽습니다. 인쇄된 글자를 직접 읽으므로 우선 사용하는 방법입니다.</MiniCard>
              <MiniCard title="사진으로 올리기">구글 폴더에 없는 급한 재시험 정답지는 사진으로 읽을 수 있습니다.</MiniCard>
            </div>
            <ol className="mt-5 space-y-3">
              <Step n="1">정답지 메뉴에서 파일을 찾아 <b>읽기</b>를 누릅니다.</Step>
              <Step n="2">시험 제목과 모든 번호·정답을 확인하고 잘못 읽힌 칸을 고칩니다.</Step>
              <Step n="3"><b>정답지 등록</b>을 눌러 저장합니다. 읽기만 눌러서는 등록되지 않습니다.</Step>
            </ol>
            <Callout tone="warn">정답지가 틀리면 같은 시험을 본 학생 모두가 잘못 채점됩니다. 제목이 비슷한 다른 시험의 답지가 아닌지 반드시 확인하세요.</Callout>
            <p className="mt-4 text-sm leading-6 text-slate-600">등록 후 원본 파일이 수정되면 목록에 다시 나타납니다. 다시 읽어서 등록해야 최신 정답이 반영됩니다. 등록된 정답지는 30일 후 자동으로 지워지므로 계속 사용할 때는 다시 등록합니다.</p>
          </GuideSection>

          <GuideSection id="roster" n="06" title="확정된 결과를 명단에서 확인합니다" lead="명단에는 사람이 검수해 확정한 결과만 표시됩니다.">
            <div className="grid gap-3 sm:grid-cols-3">
              <MiniCard title="재시험 대상">확정된 FAIL 학생과 오답 문항을 확인합니다.</MiniCard>
              <MiniCard title="통과">확정된 PASS 학생을 확인합니다.</MiniCard>
              <MiniCard title="복사·인쇄">정리된 명단을 복사해 메신저에 붙이거나 인쇄합니다.</MiniCard>
            </div>
            <Callout>명단에 학생이 보이지 않으면 접수 목록에서 <b>채점됨</b> 상태로 남아 있는지 확인하세요. 검수 후 확정해야 명단에 들어갑니다.</Callout>
          </GuideSection>

          <GuideSection id="rules" n="07" title="답안지와 계정을 안전하게 다룹니다" lead="학생 답안지에는 이름과 필체 등 개인정보가 포함됩니다.">
            <ul className="grid gap-3 sm:grid-cols-2">
              <Rule>학원 업무와 학생 답안지 채점에만 사용합니다.</Rule>
              <Rule>답안지 사진을 카카오톡·사진첩·개인 클라우드로 보내지 않습니다.</Rule>
              <Rule>종이 원본은 학원에 두고 외부로 가져가지 않습니다.</Rule>
              <Rule>계정을 다른 사람에게 빌려주지 않습니다.</Rule>
              <Rule>모든 사용은 시각·건수·비용과 함께 계정별로 기록됩니다.</Rule>
              <Rule>답안지 사진은 90일 후 자동 삭제되며, 삭제 요청은 관리자에게 전달합니다.</Rule>
            </ul>
          </GuideSection>

          <GuideSection id="trouble" n="?" title="문제가 생겼을 때" lead="아래 순서로 확인해도 해결되지 않으면 관리자에게 알려 주세요.">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <Trouble q="로그인이 안 됩니다">이메일과 비밀번호를 다시 확인합니다. 비밀번호를 잊었다면 관리자에게 재발급을 요청합니다.</Trouble>
              <Trouble q="화면이 열리지 않습니다">아직 승인 전이거나 계정 사용이 중지된 상태입니다. 승인됐는지 확인을 누른 뒤 관리자에게 문의합니다.</Trouble>
              <Trouble q="채점이 실패했습니다">다시를 누릅니다. 반복되면 종이 전체가 선명하게 보이도록 사진을 새로 찍어 접수합니다.</Trouble>
              <Trouble q="채점이 오래 걸립니다">대기열이 있으면 순서대로 처리됩니다. 기다리는 동안 다음 학생의 답안지를 계속 접수할 수 있습니다.</Trouble>
              <Trouble q="뒷장을 빼먹었습니다">접수 목록에서 즉시 중단하고, 해당 답안지를 지운 뒤 앞·뒤를 모두 다시 접수합니다.</Trouble>
              <Trouble q="커트라인을 못 읽었습니다">결과 줄이나 검수 화면에서 커트라인 숫자를 직접 입력해 반영합니다. 전체 채점을 다시 돌릴 필요는 없습니다.</Trouble>
            </div>
          </GuideSection>

          <section className="mt-6 rounded-[1.75rem] bg-[linear-gradient(125deg,#0b1d46,#165ac2)] p-8 text-center text-white shadow-lg sm:p-10">
            <h2 className="text-2xl font-black tracking-tight">재시험 답안지를 접수해 보세요.</h2>
            <p className="mt-2 text-blue-100">촬영 후 접수하고, 자동채점 결과를 반드시 검수해 확정합니다.</p>
            <Link href="/" className="mt-5 inline-flex rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-blue-800">자동채점 열기 ↗</Link>
          </section>

          <footer className="py-9 text-center text-xs text-slate-400">{ACADEMY} · YUSSAM WORKSPACE · 자동채점 사용 가이드</footer>
        </div>
      </div>
    </main>
  );
}

function QuickStep({ n, title, body }: { n: string; title: string; body: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><span className="grid size-8 place-items-center rounded-lg bg-blue-600 text-sm font-black text-white">{n}</span><strong className="mt-3 block text-sm sm:text-base">{title}</strong><span className="mt-1 block text-sm leading-5 text-slate-500">{body}</span></div>;
}

function GuideSection({ id, n, title, lead, children }: { id: string; n: string; title: string; lead: string; children: ReactNode }) {
  return <section id={id} className="mt-5 scroll-mt-24 rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-8"><header className="flex items-start gap-3 sm:gap-4"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-sm font-black text-blue-700">{n}</span><div><h2 className="text-2xl font-black tracking-[-0.03em] text-slate-950 sm:text-3xl">{title}</h2><p className="mt-1.5 leading-6 text-slate-500">{lead}</p></div></header><div className="mt-6 text-[15px] leading-7 text-slate-700 sm:text-base">{children}</div></section>;
}

function Step({ n, children }: { n: string; children: ReactNode }) {
  return <li className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-lg bg-blue-50 text-xs font-black text-blue-700">{n}</span><span>{children}</span></li>;
}

function Screenshot({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return <figure className="mt-6"><div className="overflow-hidden rounded-2xl border border-slate-300 bg-slate-100 shadow-[0_16px_45px_rgba(15,35,72,.12)]"><Image src={src} alt={alt} width={1264} height={708} sizes="(max-width: 1024px) 100vw, 900px" className="h-auto w-full" /></div><figcaption className="mt-2.5 text-center text-xs leading-5 text-slate-500">{caption}</figcaption></figure>;
}

function Callout({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return <div className={`mt-5 rounded-r-xl border-l-4 p-4 text-sm leading-6 ${tone === "warn" ? "border-amber-500 bg-amber-50 text-amber-950" : "border-blue-600 bg-blue-50 text-blue-950"}`}>{children}</div>;
}

function MiniCard({ title, children }: { title: string; children: ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><strong className="block text-sm text-slate-950">{title}</strong><p className="mt-1 text-sm leading-6 text-slate-600">{children}</p></div>;
}

function CheckItem({ title, children }: { title: string; children: ReactNode }) {
  return <div className="rounded-xl border border-slate-200 p-4"><strong className="flex items-center gap-2 text-sm text-slate-950"><span className="grid size-5 place-items-center rounded-full bg-emerald-100 text-xs text-emerald-700">✓</span>{title}</strong><p className="mt-2 text-sm leading-6 text-slate-600">{children}</p></div>;
}

const tones = { blue: "bg-blue-100 text-blue-700", amber: "bg-amber-100 text-amber-800", green: "bg-emerald-100 text-emerald-700", red: "bg-rose-100 text-rose-700", slate: "bg-slate-200 text-slate-700" };

function StatusRow({ badge, tone, children }: { badge: string; tone: keyof typeof tones; children: ReactNode }) {
  return <div className="grid gap-2 border-b border-slate-100 p-4 last:border-0 sm:grid-cols-[150px_1fr] sm:items-center"><span className={`w-fit rounded-full px-2.5 py-1 text-xs font-bold ${tones[tone]}`}>{badge}</span><p className="text-sm leading-6 text-slate-600">{children}</p></div>;
}

function Rule({ children }: { children: ReactNode }) {
  return <li className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6"><span className="font-black text-blue-600">✓</span><span>{children}</span></li>;
}

function Trouble({ q, children }: { q: string; children: ReactNode }) {
  return <div className="grid gap-1 border-b border-slate-100 p-4 last:border-0 sm:grid-cols-[210px_1fr] sm:gap-5"><strong className="text-sm text-slate-950">{q}</strong><p className="text-sm leading-6 text-slate-600">{children}</p></div>;
}
