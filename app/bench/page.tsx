import { DEFAULT_EFFORT, DEFAULT_MODEL } from "@/lib/grading/client";
import Bench from "./bench";

/**
 * 화면이 **지금 실제로 쓰는 설정**을 알아야 하는 이유.
 *
 * 비교의 기준은 그 답안지를 채점한 값이라 옛 설정일 수 있습니다. 실제로
 * 2026-08-08 답안지는 `Opus·high`로 채점됐고 그 뒤 운영이 `Opus·low`로
 * 옮겨갔습니다. 그 상태에서 "비용 70%"를 보면 **30% 아낀다고 읽히는데,
 * 지금 쓰는 설정 대비로는 15%입니다.** 돈에 관한 결정을 그 숫자로 하면
 * 안 됩니다.
 *
 * 설정은 서버 환경 변수라 브라우저가 못 읽습니다. 그래서 이 바깥 껍데기만
 * 서버에서 돌려 값을 넘겨줍니다 — `NEXT_PUBLIC_`으로 복사해두면 두 곳이
 * 갈릴 수 있고, 갈리면 화면이 조용히 틀린 기준을 말합니다.
 */
export default function Page() {
  return <Bench live={{ model: DEFAULT_MODEL, effort: DEFAULT_EFFORT }} />;
}
