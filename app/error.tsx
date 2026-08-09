"use client";

import { useEffect } from "react";

/**
 * 화면이 죽었을 때 보여줄 것.
 *
 * 이게 없으면 브라우저의 **"This page couldn't load"** 가 뜹니다. 영어이고,
 * 무엇이 잘못됐는지 한 글자도 안 알려주고, 조교가 할 수 있는 일도 없습니다.
 * 실제로 마이그레이션을 안 돌린 상태에서 관리 화면을 열었더니 그렇게 됐습니다.
 *
 * 여기서는 **메시지를 그대로 보여줍니다.** 대개 원인이 그 한 줄에 있고,
 * 원장님께 그대로 옮기면 바로 짚을 수 있습니다.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[page]", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-lg p-6 pt-16">
      <h1 className="text-lg font-bold">화면을 그리지 못했습니다.</h1>
      <p className="mt-1 text-sm text-slate-600">
        아래 문구를 그대로 알려주시면 원인을 짚을 수 있습니다. <strong>채점된 결과는 그대로 있습니다.</strong>
      </p>

      <pre className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
        {error.message || "(메시지 없음)"}
        {error.digest && `\n\n(코드: ${error.digest})`}
      </pre>

      <div className="mt-4 flex gap-2">
        <button onClick={reset} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          다시 시도
        </button>
        <a href="/" className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
          접수 화면으로
        </a>
      </div>
    </main>
  );
}
