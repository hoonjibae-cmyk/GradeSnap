import type { Metadata } from "next";
import { ACADEMY } from "@/lib/brand";

/**
 * 사용 안내 — **조교에게 주소 하나로 보낼 수 있는 매뉴얼**입니다.
 *
 * 로그인 없이 열립니다. 처음 오는 사람은 계정도 승인도 없는 상태로 읽어야
 * 하고, 승인 대기 중에 읽을 것이 없으면 아무 데도 안 물어보고 그냥 기다립니다.
 *
 * **학생 것은 한 글자도 없습니다.** 이름도, 점수도, 사진도, 반 이름도
 * 예시조차 실제를 쓰지 않습니다. 그래서 로그인 밖에 둘 수 있는 것이고,
 * 이 원칙이 깨지는 순간 이 페이지는 관문 안으로 들어가야 합니다.
 *
 * 검색에는 안 걸리게 해뒀습니다(`robots`). 막는 게 아니라, 학원 내부 문서가
 * 검색 결과에 뜰 이유가 없어서입니다.
 */
export const metadata: Metadata = {
  title: "GradeSnap 사용 안내",
  description: "목동유쌤영어학원 · 조교·직원용 사용 안내",
  robots: { index: false, follow: false },
};

export default function HelpPage() {
  return (
    <main className="mx-auto max-w-2xl p-5 pb-24">
      <header className="border-b border-slate-200 pb-4">
        <p className="text-xs font-semibold tracking-[0.2em] text-slate-400">{ACADEMY}학원</p>
        <h1 className="mt-1 text-2xl font-bold">GradeSnap 사용 안내</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-600">
          답안지를 찍으면 채점됩니다. <strong className="text-slate-900">다만 최종 판단은 사람이 합니다</strong> —
          이 프로그램은 읽고 세는 일을 대신할 뿐이고, 통과 여부는 <b>확인한 사람이 확정합니다.</b>
        </p>
        {/*
          범위를 맨 위에 답니다. 아래 어딘가에 적어두면 "찍으면 채점된다"만
          읽고 본 시험 답안지를 올립니다. **안 쓰는 자리가 쓰는 자리보다
          많은 도구**라, 어디에 쓰는지부터 말해야 합니다.
        */}
        <p className="mt-3 rounded-lg border border-slate-300 bg-white p-3 text-sm leading-relaxed text-slate-700">
          <b>재시험 답안지만, 그것도 채점이 밀릴 때만 올립니다.</b>
          <br />
          재시험도 손으로 채점하는 것이 원칙입니다. 답안지가 쌓여 <b>학생을 기다리게 할 것 같을 때</b> 씁니다.
          <br />
          클리닉 본 시험과 인클래스 테스트 답안지는 <b>어떤 경우에도 올리지 않습니다.</b>
        </p>
      </header>

      <nav className="no-print mt-4 flex flex-wrap gap-2 text-sm">
        <a href="/" className="rounded-lg border border-slate-300 px-3 py-1.5">
          로그인
        </a>
        <a href="/signup" className="rounded-lg border border-slate-300 px-3 py-1.5">
          계정 만들기
        </a>
      </nav>

      <Section n={1} title="계정 만들기">
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            <Path>/signup</Path> 을 열어 <b>이름(실명)·이메일·비밀번호</b>를 넣고 가입합니다.
          </li>
          <li>가입하면 원장님께 승인 신청이 올라갑니다.</li>
          <li>승인되면 그때부터 화면이 열립니다. 「승인됐는지 확인」을 눌러 보십시오.</li>
        </ol>
        <Note>
          <b>가입 = 사용 허가가 아닙니다.</b> 승인 전에는 답안지도 학생 이름도 보이지 않습니다. 하루가 지나도
          안 열리면 원장님께 말씀하십시오 — 신청이 안 들어간 것일 수 있습니다.
        </Note>
        <p>이름은 실명으로 적으십시오. 원장님이 승인 화면에서 보는 것이 그 이름뿐입니다.</p>
      </Section>

      <Section n={2} title="휴대폰 홈 화면에 올려두기">
        <p>매번 주소를 치지 않게 아이콘으로 만들어 두십시오. 앱 설치가 아니라 바로가기입니다.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>아이폰(Safari)</b> — 아래 공유 단추 → <b>홈 화면에 추가</b>
          </li>
          <li>
            <b>안드로이드(Chrome)</b> — 오른쪽 위 ⋮ → <b>홈 화면에 추가</b>
          </li>
        </ul>
        <Note>
          다른 브라우저로 열면 <b>로그인이 풀린 것처럼 보입니다.</b> 늘 같은 브라우저(홈 화면 아이콘)로
          들어오십시오.
        </Note>
      </Section>

      <Section n={3} title="접수 — 재시험 답안지를 받는 자리">
        <Note tone="warn">
          <b>먼저 판단할 것 하나.</b> 재시험도 손으로 채점하는 것이 원칙입니다. 답안지가 쌓여{" "}
          <b>학생을 기다리게 할 것 같을 때만</b> 프로그램을 씁니다. 애매하면 손으로 채점하십시오.
        </Note>
        <p>
          쓰기로 했으면, 여러 명을 모아서 한꺼번에 돌리는 게 아닙니다. <b>학생이 내면 그 자리에서 찍고
          접수합니다.</b>
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>맨 위 날짜가 오늘인지 봅니다.</li>
          <li>
            <b>반</b> — 적어두면 명단이 반별로 나옵니다. 안 적어도 됩니다. 한 번 쓴 반은 다음부터 단추로 나옵니다.
          </li>
          <li>
            <b>학생 이름</b> — 알면 적고, 모르면 비웁니다. 비우면 시험지에서 읽습니다.
          </li>
          <li>
            <b>사진</b> — 이 학생의 답안지를 전부 찍습니다(4번 항목).
          </li>
          <li>
            <b>접수</b>를 누릅니다. <b>기다리지 말고 다음 학생을 받으십시오.</b> 채점은 뒤에서 돌아갑니다.
          </li>
        </ol>
        <Note>
          반과 이름은 <b>접수하면 비워집니다.</b> 일부러 그렇게 만들었습니다 — 남겨두면 다음 학생에게 앞
          학생 이름이 조용히 붙습니다.
        </Note>
        <p>
          「철자 엄격」은 <b>학원 방침이라 원장님이 정합니다.</b> 켜면 철자가 한 글자만 달라도 오답, 끄면 한두
          글자 오타는 정답으로 봅니다. 조교가 학생마다 바꾸는 칸이 아닙니다.
        </p>
      </Section>

      <Section n={4} title="사진 — 여기서 대부분의 사고가 납니다">
        <p>채점이 틀리는 가장 흔한 이유는 모델이 아니라 사진입니다.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>양면이면 앞·뒤를 모두</b> 찍습니다. 순서는 상관없습니다 — 문항 번호로 합칩니다.
          </li>
          <li>
            <b>번호와 답 칸이 잘리지 않게</b> 종이 전체가 화면에 들어오게 찍습니다.
          </li>
          <li>
            <b>세워서</b> 찍습니다. 가로로 누우면 「돌려 주십시오」 경고가 뜹니다. ↺ ↻ 로 돌린 뒤 접수하십시오.
          </li>
          <li>그림자와 손가락을 피하고, 종이를 펴서 찍습니다.</li>
        </ul>
        <Note tone="warn">
          <b>한 학생의 답안지만</b> 한 번에 접수하십시오. 다른 학생 것이 섞여 들어가면 그 학생 결과가 됩니다.
        </Note>
      </Section>

      <Section n={5} title="목록에 뜨는 표시">
        <Rows
          rows={[
            ["대기 · 채점 중", "돌아가는 중입니다. 그냥 두십시오."],
            ["채점됨", "끝났습니다. 눌러서 검수합니다."],
            ["확정", "검수가 끝났습니다. 이것만 명단에 나갑니다."],
            ["실패", "채점이 안 됐습니다. 「다시」를 누르십시오. 두 번 실패하면 원장님께."],
            ["PASS / FAIL", "커트라인과 오답 수로 낸 판정입니다."],
            ["🔶 커트라인", "한두 문항으로 결과가 갈립니다. 반드시 사람이 확인하십시오."],
            ["⚠️ 밀림", "번호와 답이 어긋나 보입니다. 전사를 종이와 대조하십시오."],
            ["📄 일부만 찍힘", "빠진 장이 있습니다. 나머지를 찍어 다시 접수하십시오."],
            ["커트라인 못 읽음", "빨간펜에 가렸을 때입니다. 숫자만 넣으면 다시 채점하지 않고 셉니다."],
          ]}
        />
      </Section>

      <Section n={6} title="검수 — 사람이 하는 부분">
        <p>「채점됨」 줄을 누르면 검수 화면이 열립니다.</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            위쪽 <b>사진을 눌러 크게 보고</b>, 표의 「학생이 쓴 것」이 종이와 같은지 봅니다.
          </li>
          <li>
            다르면 ○ / ✗ 를 눌러 고칩니다. <b>고친 것은 파란색으로 남습니다.</b>
          </li>
          <li>이름이 잘못 읽혔으면 제목 옆에서 고칩니다. 다시 채점하지 않습니다.</li>
          <li>
            다 봤으면 <b>PASS / FAIL로 확정</b>합니다. <b>확정한 것만 명단에 나갑니다.</b> 잘못 눌렀으면
            「확정 취소」로 되돌립니다.
          </li>
        </ol>
        <Note tone="warn">
          가장 조심할 것: <b>오타를 실재하는 단어로 고쳐 읽는 경우</b>가 있습니다. 학생이 틀리게 쓴 것을
          맞게 옮겨 적어버리는 것이라 확신도로는 안 걸러집니다. 그래서 사진을 봅니다.
        </Note>
        <Note>
          <b>확정은 조교도 합니다.</b> 대신 누가 확정했는지 기록에 남습니다. 애매하면 확정하지 말고
          선생님께 물어보십시오 — 안 누르면 그 학생은 명단 어디에도 안 나가고, 화면에 「확정 안 됨」으로
          남습니다.
        </Note>
      </Section>

      <Section n={7} title="명단">
        <p>
          <Path>/roster</Path> 에서 그날 <b>재시험 명단</b>과 학생별 오답을 봅니다. 복사해서 메신저에 붙이거나
          인쇄할 수 있습니다.
        </p>
        <Note>
          <b>확정된 것만 나옵니다.</b> 명단에 사람이 비면 검수가 안 끝난 것입니다 — 화면 위쪽에 몇 장이
          남았는지 나옵니다.
        </Note>
      </Section>

      <Section n={8} title="지켜야 할 것">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <b>학원 업무용입니다.</b> 학생 답안지 채점 외의 용도로 쓸 수 없습니다.
          </li>
          <li>
            <b>답안지 사진을 다른 앱으로 보내지 마십시오.</b> 카카오톡·사진첩·개인 클라우드 전부
            해당합니다. 찍은 사진은 접수 화면에서 바로 올라갑니다.
          </li>
          <li>
            <b>종이 원본은 학원에 둡니다.</b> 집에 가져가지 마십시오.
          </li>
          <li>
            <b>계정을 남에게 빌려주지 마십시오.</b> 기록이 전부 계정별로 남습니다.
          </li>
          <li>
            <b>모든 사용은 로그로 기록·관리됩니다.</b> 누가 언제 몇 장을 돌렸고 비용이 얼마인지 관리자가
            봅니다. 숨기려는 게 아니라 미리 알리는 것입니다.
          </li>
        </ul>
        <p className="text-sm text-slate-500">
          답안지 사진은 90일이 지나면 자동으로 지워집니다. 학부모가 삭제를 요청하면 원장님이 그 학생 기록을
          통째로 지웁니다.
        </p>
      </Section>

      <Section n={9} title="안 될 때">
        <Rows
          rows={[
            ["로그인이 안 됨", "이메일·비밀번호를 다시 확인하십시오. 그래도 안 되면 원장님께."],
            ["로그인은 되는데 화면이 안 열림", "아직 승인 전입니다. 「승인됐는지 확인」을 눌러 보십시오."],
            ["갑자기 대기 화면으로 바뀜", "계정이 꺼진 것입니다. 원장님께 문의하십시오."],
            ["채점이 「실패」로 끝남", "「다시」를 누르십시오. 반복되면 사진을 다시 찍어 접수합니다."],
            ["채점이 오래 걸림", "한 장에 1~2분입니다. 밀리면 순서대로 나옵니다 — 기다리지 말고 계속 받으십시오."],
            ["사진이 안 올라감", "인터넷을 확인하십시오. 접수 전이면 다시 찍으면 됩니다."],
          ]}
        />
      </Section>

      <footer className="mt-10 border-t border-slate-200 pt-4 text-sm text-slate-500">
        여기에 없는 것은 원장님께 물어보십시오. 혼자 짐작해서 넘기면 그 학생 결과가 틀린 채로 나갑니다.
      </footer>
    </main>
  );
}

// ---------------------------------------------------------------------------
// 조각들
// ---------------------------------------------------------------------------

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="print-block mt-8">
      <h2 className="text-lg font-bold">
        <span className="mr-1.5 text-slate-400">{n}</span>
        {title}
      </h2>
      <div className="mt-2 space-y-2.5 text-[15px] leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

/** 화면 주소. 조교가 그대로 쳐볼 수 있게 글꼴을 바꿔둡니다. */
function Path({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[13px] text-slate-800">{children}</code>;
}

function Note({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" }) {
  const style =
    tone === "warn" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-100 text-slate-700";
  return <p className={`rounded-lg border p-3 text-sm leading-relaxed ${style}`}>{children}</p>;
}

/**
 * 표시 → 뜻. 표 대신 두 칸짜리 줄입니다 —
 * **휴대폰에서 표는 옆으로 밀립니다.**
 */
function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
      {rows.map(([k, v]) => (
        <li key={k} className="p-3 sm:flex sm:gap-4">
          <span className="block font-medium text-slate-900 sm:w-44 sm:shrink-0">{k}</span>
          <span className="mt-0.5 block text-sm text-slate-600 sm:mt-0">{v}</span>
        </li>
      ))}
    </ul>
  );
}
