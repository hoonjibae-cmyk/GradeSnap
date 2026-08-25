"use client";

import { use, useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Bar, Gate } from "@/components/Gate";
import {
  confirmSheet,
  getSheet,
  itemsOf,
  pageUrls,
  setTeacherVerdict,
  unconfirmSheet,
  updateSheetInfo,
} from "@/lib/db/queries";
import type { ItemRow, SheetRow, StaffRow } from "@/lib/db/schema";
import type { Verdict } from "@/lib/grading/types";
import { label } from "@/lib/grading/provider";
import { tooShort } from "@/lib/grading/suspect";
import { isOpen } from "@/lib/grading/unjudged";
import { readJson } from "@/lib/http";

/**
 * 검수 화면 — **사람이 확인하고 확정하는 곳**입니다.
 *
 * [13 §13.2](../../docs/13-phase1-plan.md)의 "선생님이 채점한다 → 사람이
 * 확인한다"가 실제로 일어나는 화면이고, 여기서 고친 기록이 그대로
 * 정확도 데이터가 됩니다(`items.overturned`).
 *
 * 확정은 조교도 합니다(§13.33). 누가 확정했는지는 `confirmed_by`에
 * 남으므로, 권한을 넓혀도 책임 소재는 그대로입니다.
 */
export default function SheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Gate>{(db, staff) => <Review db={db} staff={staff} id={id} />}</Gate>;
}

/**
 * 이름과 반 — 보기와 고치기.
 *
 * 시험지 머리말이 흐리거나 학생이 이름을 흘려 쓰면 잘못 읽힙니다.
 * **그건 채점을 다시 돌릴 일이 아니라 글자만 고치면 되는 일**입니다.
 * 확정한 뒤에도 고칠 수 있게 뒀습니다 — 오타 정정을 막을 이유가 없고,
 * 막으면 명단에 틀린 이름이 그대로 나갑니다.
 */
function Identity({
  sheet,
  db,
  onSaved,
  onError,
}: {
  sheet: SheetRow;
  db: SupabaseClient;
  onSaved: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sheet.student_name);
  const [cls, setCls] = useState(sheet.class_name);
  const [busy, setBusy] = useState(false);

  // 시험지에서 읽은 이름. 사람이 적은 것과 다르면 짚어줍니다 —
  // **사진이 다른 학생 것일 수도 있습니다.**
  const read = (sheet.transcript?.sheet.student ?? "").trim();
  const differs = read && read !== sheet.student_name.trim();

  async function save() {
    setBusy(true);
    try {
      await updateSheetInfo(db, sheet.id, { student_name: name, class_name: cls });
      await onSaved();
      setEditing(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-500">
          학생 이름
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="mt-0.5 block w-44 rounded-lg border border-slate-300 px-2 py-1.5 text-base text-slate-900"
          />
        </label>
        <label className="text-xs text-slate-500">
          반
          <input
            value={cls}
            onChange={(e) => setCls(e.target.value)}
            placeholder="비워도 됩니다"
            className="mt-0.5 block w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-base text-slate-900"
          />
        </label>
        <button
          onClick={() => void save()}
          disabled={busy}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? "…" : "저장"}
        </button>
        <button
          onClick={() => {
            setName(sheet.student_name);
            setCls(sheet.class_name);
            setEditing(false);
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          취소
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">
          {sheet.student_name || <span className="text-slate-400">이름 못 읽음</span>}
        </h1>
        {sheet.class_name && <span className="text-sm text-slate-500">{sheet.class_name}</span>}
        <button onClick={() => setEditing(true)} className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600">
          이름·반 고치기
        </button>
      </div>
      {differs && (
        <p className="mt-1 text-xs text-amber-700">
          시험지에서 읽은 이름은 <strong>{read}</strong>입니다. 사진이 다른 학생 것은 아닌지 확인하십시오.
        </p>
      )}
    </div>
  );
}

function Review({ db, staff, id }: { db: SupabaseClient; staff: StaffRow; id: string }) {
  const [sheet, setSheet] = useState<SheetRow | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cutText, setCutText] = useState("");

  const load = useCallback(async () => {
    const [s, i] = await Promise.all([getSheet(db, id), itemsOf(db, id)]);
    setSheet(s);
    setItems(i);
  }, [db, id]);

  useEffect(() => {
    void load().catch((e) => setErr(String(e.message ?? e)));
    // 사진은 서명 URL이라 따로, 실패해도 검수는 되게 둡니다.
    pageUrls(db, id)
      .then(setPhotos)
      .catch(() => {});
  }, [db, id, load]);

  /** 셈은 서버가 합니다. 화면이 따로 세면 언젠가 서버와 어긋납니다. */
  const recount = useCallback(
    async (cutLine?: string) => {
      const { data } = await db.auth.getSession();
      const r = await fetch(`/api/sheets/${id}/recount`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token ?? ""}` },
        body: JSON.stringify(cutLine ? { cutLine } : {}),
      });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j?.error ?? `요청 실패 (${r.status})`);
      await load();
    },
    [db, id, load],
  );

  async function mark(item: ItemRow, correct: boolean | null) {
    setBusy(true);
    setErr(null);
    try {
      await setTeacherVerdict(db, item.id, correct);
      await recount();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function applyCut() {
    setBusy(true);
    setErr(null);
    try {
      await recount(cutText);
      setCutText("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function finalize(v: Verdict) {
    setBusy(true);
    setErr(null);
    try {
      await confirmSheet(db, id, v);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!sheet) return <p className="p-6 text-sm text-slate-500">{err ?? "불러오는 중…"}</p>;

  /*
    확정은 **승인된 직원이면 누구나** 합니다. 처음에는 선생님·관리자만
    누를 수 있었는데(§13.33), 실제로는 조교가 합니다.

    막을 근거도 얇았습니다 — 조교는 이미 위 표에서 ○/✗를 전부 뒤집을 수
    있고 오답 수가 곧 판정입니다. 마지막 단추만 잠그면 결정이 막히는 게
    아니라 **결정이 다른 사람 이름으로 남습니다.**

    권한은 DB가 봅니다(`can_confirm()`). 여기서 역할을 안 보는 것은
    화면이 판단을 흉내내지 않기 위해서입니다.
  */
  const confirmed = sheet.status === "confirmed";
  const v = sheet.final_verdict ?? sheet.verdict;
  /*
    판정 못 한 문항(§13.40)은 **오답으로 세지 않습니다.** 서버가 그렇게
    셌으므로 화면도 같아야 합니다 — 다르면 머리말의 오답 수와 아래 표가
    어긋나고, 어느 쪽이 맞는지 아무도 모릅니다.
  */
  const open = items.filter(isOpen);
  const wrong = items.filter((i) => !isOpen(i) && i.final_correct === false).length;
  const changed = items.filter((i) => i.overturned).length;
  const reviewed = items.filter((i) => i.teacher_correct !== null).length;

  return (
    <main className="mx-auto max-w-4xl p-5 pb-24">
      <Bar db={db} staff={staff} />

      {err && (
        <p className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span>{err}</span>
          <button onClick={() => setErr(null)} className="shrink-0 underline">
            닫기
          </button>
        </p>
      )}

      <header className="mb-4">
        <Identity sheet={sheet} db={db} onSaved={load} onError={setErr} />
        <p className="mt-1 text-sm text-slate-600">
          {[sheet.title, new Date(sheet.created_at).toLocaleString("ko-KR")].filter(Boolean).join(" · ")}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {v && (
            <span
              className={`rounded-full px-3 py-1 text-sm font-bold ${
                v === "pass" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
              }`}
            >
              {v === "pass" ? "PASS" : "FAIL"}
              {confirmed && " · 확정"}
            </span>
          )}
          {open.length > 0 && (
            <span className="rounded-full bg-rose-100 px-3 py-1 text-sm font-bold text-rose-800">
              직접 채점할 문항 {open.length}개
            </span>
          )}
          <span className="text-sm text-slate-700">
            오답 {wrong} / {items.length}
            {sheet.cut !== null && <span className="text-slate-500"> · 허용 {sheet.cut}</span>}
          </span>
          <span className="text-xs text-slate-500">
            ${Number(sheet.cost_usd ?? 0).toFixed(3)}
            {sheet.token_usage && ` · ${(sheet.token_usage.reduce((a, u) => a + u.latencyMs, 0) / 1000).toFixed(0)}초`}
            {/*
              **이 장을 실제로 채점한 모델**입니다. 지금 설정이 아니라 그때
              설정이라야 합니다 — 모델을 바꾼 뒤 옛 답안지를 열었을 때
              "왜 이 판정이 나왔나"를 되짚는 자리이기 때문입니다.
            */}
            {sheet.token_usage?.[0]?.model && (
              <span title="이 답안지를 채점한 모델">
                {" · "}
                {label(sheet.token_usage[0].model)}
                {sheet.token_usage[0].effort && ` · ${sheet.token_usage[0].effort}`}
              </span>
            )}
          </span>
        </div>
      </header>

      {sheet.near_boundary && v && (
        <p className="mb-3 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
          🔶 <strong>커트라인에 걸렸습니다 — 반드시 확인하십시오.</strong>
          <br />
          오답 {wrong}개 / 허용 {sheet.cut}개
          {sheet.margin === 0
            ? " — 여유가 없습니다. 한 문항만 더 틀렸으면 결과가 뒤집힙니다."
            : sheet.margin !== null && sheet.margin < 0
              ? ` — 여유 ${-sheet.margin}문항. 이 안에서 판정이 갈립니다.`
              : ""}
        </p>
      )}

      {sheet.status === "graded" && sheet.cut === null && (
        <div className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          커트라인을 못 읽어 <strong>PASS/FAIL을 내지 않았습니다.</strong> 시험지에 적힌 대로 넣어 주십시오 —
          다시 채점하지 않고 세기만 합니다.
          <div className="mt-2 flex gap-2">
            <input
              value={cutText}
              onChange={(e) => setCutText(e.target.value)}
              placeholder="예: -8 까지 pass"
              className="w-48 rounded border border-amber-300 bg-white px-2 py-1 text-sm"
            />
            <button
              onClick={() => void applyCut()}
              disabled={busy || !cutText.trim()}
              className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-40"
            >
              반영
            </button>
          </div>
        </div>
      )}

      {(sheet.warnings ?? []).map((w, i) => (
        <p
          key={i}
          className={`mb-2 rounded-lg border p-3 text-sm ${
            w.level === "drift"
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : w.level === "incomplete"
                ? "border-rose-300 bg-rose-50 text-rose-900"
                : "border-slate-200 bg-slate-100 text-slate-700"
          }`}
        >
          {w.level === "drift" ? "⚠️ " : w.level === "incomplete" ? "📄 " : "ℹ️ "}
          {w.text}
        </p>
      ))}

      {photos.length > 0 && (
        <section className="mb-4 flex flex-wrap gap-3">
          {photos.map((u, i) => (
            <a key={i} href={u} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt={`${i + 1}쪽`} className="h-36 w-auto rounded-lg border border-slate-200 object-contain" />
            </a>
          ))}
          <p className="w-full text-xs text-slate-500">
            모델이 본 이미지입니다. 눌러서 크게 보고 <strong>전사가 종이와 같은지</strong> 확인하십시오.
          </p>
        </section>
      )}

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="p-2 font-medium">번호</th>
              <th className="p-2 font-medium">제시어</th>
              <th className="p-2 font-medium">학생이 쓴 것</th>
              <th className="p-2 font-medium">정답</th>
              <th className="p-2 font-medium">판정</th>
              <th className="p-2 font-medium">비고</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className={`border-t border-slate-100 ${it.overturned ? "bg-sky-50" : ""}`}>
                <td className="p-2 text-slate-500">{it.no}</td>
                <td className="p-2">{it.prompt}</td>
                <td className="p-2 font-medium">
                  {it.prefix && <span className="text-slate-400">{it.prefix}</span>}
                  {it.blank ? (
                    <span className="text-slate-400">(무응답)</span>
                  ) : (
                    it.written.slice(it.prefix.length)
                  )}
                  {!it.legible && <span className="ml-1 text-xs text-amber-700">판독불가</span>}
                  {it.erased && <span className="ml-1 text-xs text-slate-400">지운 자국</span>}
                </td>
                <td className="p-2 text-slate-500">{it.expected}</td>
                <td className="p-2">
                  {isOpen(it) && (
                    <p className="mb-1 text-[11px] font-medium text-rose-700">정답 모름 — 직접 채점</p>
                  )}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => void mark(it, true)}
                      disabled={busy || confirmed}
                      className={`h-7 w-7 rounded border text-sm ${
                        it.final_correct
                          ? "border-emerald-500 bg-emerald-500 font-bold text-white"
                          : "border-slate-300 text-slate-400"
                      } disabled:opacity-40`}
                      aria-label="정답"
                    >
                      ○
                    </button>
                    <button
                      onClick={() => void mark(it, false)}
                      disabled={busy || confirmed}
                      className={`h-7 w-7 rounded border text-sm ${
                        it.final_correct === false && !isOpen(it)
                          ? "border-rose-500 bg-rose-500 font-bold text-white"
                          : "border-slate-300 text-slate-400"
                      } disabled:opacity-40`}
                      aria-label="오답"
                    >
                      ✗
                    </button>
                    {it.teacher_correct !== null && !confirmed && (
                      <button
                        onClick={() => void mark(it, null)}
                        disabled={busy}
                        className="ml-1 text-[11px] text-slate-400 underline"
                        title="시스템 판정으로 되돌립니다"
                      >
                        되돌리기
                      </button>
                    )}
                  </div>
                </td>
                <td className="p-2 text-xs text-slate-500">
                  {it.overturned && <span className="mr-1 font-medium text-sky-700">고침</span>}
                  {/*
                    🔴 **정답인데 눈에 띄게 짧은 답**을 짚습니다(§13.38).

                    이 오류는 학생에게 유리한 쪽으로 틀립니다 — ○가 떠 있고
                    오답 수도 적으니 그냥 넘어갑니다. 틀린 쪽이 눈에 띄는
                    오류와 달리 **아무도 안 보게 생긴 오류**라, 눈을 그 줄로
                    데려올 표시가 필요합니다. 판정은 안 바꿉니다.
                  */}
                  {it.final_correct === true && tooShort(it.written, it.expected) && (
                    <span className="mr-1 font-medium text-amber-700">정답보다 짧습니다 — 확인</span>
                  )}
                  {it.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="mt-3 text-xs text-slate-500">
        검수 {reviewed} / {items.length} · 고친 것 {changed}
        {" — "}
        전사가 종이에 쓰인 것을 그대로 옮겼는지 보십시오. <strong>오타를 실재 단어로 고쳐 읽는 경우</strong>가
        확인됐고 확신도로는 걸러지지 않습니다.
      </p>

      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        {confirmed ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-700">
              <strong>확정됐습니다.</strong> 이 결과가 명단에 나갑니다.
            </p>
            <button
              onClick={() => void unconfirmSheet(db, id).then(load)}
              disabled={busy}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
            >
              확정 취소
            </button>
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-700">
              확인이 끝났으면 확정하십시오. <strong>확정한 것만 명단에 나갑니다.</strong>
              {v && (
                <span className="text-slate-500">
                  {" "}
                  시스템 판정은 {v === "pass" ? "PASS" : "FAIL"}입니다.
                </span>
              )}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => void finalize("pass")}
                disabled={busy}
                className="rounded-lg bg-emerald-600 px-5 py-2.5 font-medium text-white disabled:opacity-40"
              >
                PASS로 확정
              </button>
              <button
                onClick={() => void finalize("fail")}
                disabled={busy}
                className="rounded-lg bg-rose-600 px-5 py-2.5 font-medium text-white disabled:opacity-40"
              >
                FAIL로 확정
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
