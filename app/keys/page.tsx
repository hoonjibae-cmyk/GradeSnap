"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Bar, Gate } from "@/components/Gate";
import { deleteAnswerKey, KEY_DAYS, keyDaysLeft, listAnswerKeys, saveAnswerKey } from "@/lib/db/queries";
import type { AnswerKeyRow, StaffRow } from "@/lib/db/schema";
import { readJson } from "@/lib/http";
import { prepareImage } from "@/lib/image";

/**
 * 정답지 — **조교도 여기서 올립니다**(docs/13 §13.43).
 *
 * 처음에는 관리 화면 안에 뒀는데, 관리 화면은 관리자만 열립니다. 이
 * 프로그램은 **채점이 밀릴 때** 쓰는 도구라, 정답지 등록에 관리자를 기다려야
 * 하면 정작 밀리는 그 시간에 못 씁니다.
 *
 * 정답을 **정하는** 사람은 선생님입니다. 정답지는 이미 선생님이 만들어
 * 출력해 둔 종이이고, 조교가 하는 일은 그것을 찍어 올리는 것뿐입니다.
 * 누가 올렸는지는 기록에 남습니다.
 */
export default function KeysPage() {
  return <Gate>{(db, staff) => <Keys db={db} staff={staff} />}</Gate>;
}

function Keys({ db, staff }: { db: SupabaseClient; staff: StaffRow }) {
  const [err, setErr] = useState<string | null>(null);
  const onError = setErr;
  const [keys, setKeys] = useState<AnswerKeyRow[]>([]);
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<{ no: string; expected: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => setKeys(await listAnswerKeys(db)), [db]);
  useEffect(() => {
    void load().catch((e) => onError(String(e.message ?? e)));
  }, [load, onError]);

  async function read(file: File | null) {
    if (!file) return;
    setBusy(true);
    setDone(null);
    try {
      const img = await prepareImage(file);
      const { data } = await db.auth.getSession();
      const r = await fetch("/api/answer-key", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token ?? ""}` },
        body: JSON.stringify({ image: img.base64 }),
      });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j?.error ?? `요청 실패 (${r.status})`);
      // 제목을 못 읽었으면 사람이 적습니다. **제목으로 답안지와 맞춥니다.**
      if (j.title) setTitle(j.title);
      setItems(j.items ?? []);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await saveAnswerKey(db, { title, items: items.filter((i) => i.no.trim() && i.expected.trim()) });
      setDone(`「${title}」 정답지를 등록했습니다. 이 제목의 답안지부터 적용됩니다.`);
      setTitle("");
      setItems([]);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function edit(i: number, patch: Partial<{ no: string; expected: string }>) {
    setItems((prev) => prev.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  }

  return (
    <main className="mx-auto max-w-2xl p-5 pb-24">
      <Bar db={db} staff={staff} />
      {err && (
        <p className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span>{err}</span>
          <button onClick={() => setErr(null)} className="shrink-0 underline">
            닫기
          </button>
        </p>
      )}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h1 className="text-xl font-bold">정답지</h1>
      <p className="mt-1 text-sm text-slate-600">
        순서배열·문장삽입처럼 <strong>지문을 봐야 정답이 나오는 문항</strong>은 프로그램이 알 수 없습니다.
        선생님이 만들어 두신 <strong>정답지를 찍어 올리면</strong> 그때부터 그 시험은 채점됩니다.
      </p>
      <p className="mt-1 text-xs text-slate-500">
        <strong>시험 제목으로 맞춥니다</strong> — 답안지에 인쇄된 제목과 같아야 합니다. 그리고 올린 지{" "}
        <strong>{KEY_DAYS}일이 지나면 자동으로 지워집니다.</strong> 다음 학기에 같은 제목으로 다른 시험이
        나오면 옛 정답으로 채점될 수 있어서입니다. 계속 쓰시려면 다시 올리면 됩니다.
      </p>

      <label className="mt-3 block">
        <span className="mb-1 block text-sm font-medium">정답지 사진</span>
        <input
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(e) => {
            void read(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-white"
        />
      </label>
      {busy && <p className="mt-2 text-sm text-slate-500">읽는 중…</p>}
      {done && <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900">{done}</p>}

      {items.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">
            🔶 저장하기 전에 확인하십시오. <strong>여기가 틀리면 이 시험을 본 반 전체가 틀리게 채점됩니다.</strong>
          </p>

          <label className="mt-3 block text-sm">
            <span className="text-slate-700">시험 제목 — 답안지의 제목과 같아야 합니다</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: Ch.13 문법 추가시험"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </label>

          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th className="py-1 font-medium">번호</th>
                <th className="py-1 font-medium">정답</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td className="py-0.5 pr-2">
                    <input
                      value={it.no}
                      onChange={(e) => edit(i, { no: e.target.value })}
                      className="w-16 rounded border border-slate-300 px-2 py-1"
                    />
                  </td>
                  <td className="py-0.5 pr-2">
                    <input
                      value={it.expected}
                      onChange={(e) => edit(i, { expected: e.target.value })}
                      className="w-full rounded border border-slate-300 px-2 py-1"
                    />
                  </td>
                  <td>
                    <button
                      onClick={() => setItems((p) => p.filter((_, k) => k !== i))}
                      className="px-2 text-xs text-slate-400"
                      aria-label="빼기"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setItems((p) => [...p, { no: "", expected: "" }])}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              줄 추가
            </button>
            <button
              onClick={() => void save()}
              disabled={busy || !title.trim() || !items.length}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {items.length}문항 등록
            </button>
            <button
              onClick={() => {
                setItems([]);
                setTitle("");
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600"
            >
              취소
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-slate-200 pt-3">
        <p className="text-sm font-medium">등록된 정답지 {keys.length}개</p>
        {keys.length === 0 && (
          <p className="mt-1 text-xs text-slate-500">아직 없습니다. 위에서 정답지를 찍어 올리십시오.</p>
        )}
        <ul className="mt-2 divide-y divide-slate-100">
          {keys.map((k) => (
            <li key={k.slug} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                <strong>{k.title}</strong>
                <span className="ml-2 text-xs text-slate-500">
                  {k.items.length}문항 ·{" "}
                  {(() => {
                    const left = keyDaysLeft(k.updated_at);
                    return left <= 3 ? (
                      <strong className="text-amber-700">{left}일 뒤 삭제</strong>
                    ) : (
                      `${left}일 뒤 삭제`
                    );
                  })()}
                </span>
              </span>
              <button
                onClick={() =>
                  confirm(`「${k.title}」 정답지를 지웁니다. 이 시험은 다시 판정 못 하게 됩니다.`) &&
                  void deleteAnswerKey(db, k.slug).then(load).catch((e) => onError(String(e.message ?? e)))
                }
                className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500"
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      </div>
      </section>
    </main>
  );
}

