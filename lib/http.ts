/**
 * 서버 응답을 JSON으로 읽습니다. **JSON이 아닐 때가 진짜 문제입니다.**
 *
 * 2026-08-11, Sonnet 5로 실험을 돌리다 이걸 봤습니다:
 *
 * > `Unexpected token 'A', "An error o"... is not valid JSON`
 *
 * 297초 걸린 요청이었고 **실험 자체는 끝나서 결과가 저장돼 있었습니다.**
 * 그런데 화면은 실패라고 말했습니다. 오래 걸리는 요청은 우리 라우트가 아니라
 * **앞단(게이트웨이)이 먼저 끊고** JSON이 아닌 오류 문서를 돌려주는데,
 * `res.json()`이 그걸 파싱하려다 터진 것입니다.
 *
 * 그러면 조교·원장이 보는 문장이 "JSON 파싱 실패"가 됩니다. 무엇을 해야
 * 하는지가 안 적힌 문장이고, 심지어 **틀린 문장**입니다 — 일은 됐습니다.
 *
 * 그래서 세 가지를 지킵니다.
 *
 *   1. 본문을 **글로 먼저 받습니다.** 파서가 원문을 삼키지 않게.
 *   2. JSON이 아니면 **무엇이 왔는지** 그대로 보여줍니다(앞부분).
 *   3. 시간 초과로 보이면 **"다시 눌러 보라"가 아니라 "새로 고쳐 확인하라"**
 *      고 말합니다. 이미 끝났을 수 있고, 다시 누르면 돈이 두 번 나갑니다.
 */

/** 시간 초과로 앞단이 끼어들었을 때 흔히 오는 상태 코드. */
const TIMEOUT_STATUS = [408, 502, 503, 504];

export function looksLikeTimeout(status: number, body: string): boolean {
  return TIMEOUT_STATUS.includes(status) || /timeout|timed out|too long/i.test(body);
}

/**
 * 응답 본문을 JSON으로. 못 읽으면 **사람이 읽을 수 있는 오류**를 던집니다.
 *
 * `ok`가 false여도 JSON이면 그대로 돌려줍니다 — 라우트가 `{error}`를 담아
 * 보내는 경우가 있고, 그 문장이 상태 코드보다 낫습니다.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseJson<T = any>(status: number, body: string): T {
  const text = body.trim();
  if (text) {
    try {
      return JSON.parse(text) as T;
    } catch {
      /* 아래에서 사람 말로 바꿉니다 */
    }
  }
  if (looksLikeTimeout(status, text)) {
    throw new Error(
      `시간이 초과됐습니다 (${status}). **이미 끝났을 수 있으니 다시 누르지 말고 화면을 새로 고쳐 확인하십시오** — ` +
        "다시 누르면 같은 일에 돈이 두 번 나갑니다.",
    );
  }
  throw new Error(
    text
      ? `서버가 JSON이 아닌 것을 돌려줬습니다 (${status}): ${text.slice(0, 120)}`
      : `서버가 빈 응답을 돌려줬습니다 (${status}).`,
  );
}

/** `fetch` 결과를 바로 받습니다. 화면에서는 이걸 씁니다. */
export async function readJson<T = any>(res: Response): Promise<T> {
  return parseJson<T>(res.status, await res.text());
}
