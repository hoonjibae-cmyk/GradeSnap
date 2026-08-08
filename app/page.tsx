"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Bar, Gate } from "@/components/Gate";
import { deleteSheet, intake, retrySheet, sheetsOn } from "@/lib/db/queries";
import { needsReview, type SheetRow, type StaffRow } from "@/lib/db/schema";
import { prepareImage, rotateBy, type PreparedImage } from "@/lib/image";

/**
 * 접수 화면 — 조교가 하루 종일 열어두는 곳입니다.
 *
 * 한 반을 모아서 한꺼번에 돌리는 화면이 아닙니다. **학생이 시험지를 내면
 * 그 자리에서 찍어 접수하고, 채점은 그 즉시 뒤에서 돌아갑니다.** 앞 학생이
 * 채점되는 중에 다음 학생을 받아도 됩니다. 조교 둘이 각자 그렇게 합니다.
 */
export default function Home() {
  return <Gate>{(db, staff) => <Intake db={db} staff={staff} />}</Gate>;
}

/** 동시에 몇 장을 채점할지. 한 장에 1~2분이라 넷이면 줄이 안 밀립니다. */
const LANES = 4;
/** 잡아놓고 죽은 것으로 보는 시간. DB의 `claim_next`와 같은 값이라야 합니다. */
const STALE_MS = 10 * 60 * 1000;
const PREFS = "gradesnap.intake";

function todayLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function Intake({ db, staff }: { db: SupabaseClient; staff: StaffRow }) {
  const [day, setDay] = useState(todayLocal());
  const [sheets, setSheets] = useState<SheetRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const active = useRef(0);
  const [busyLanes, setBusyLanes] = useState(0);

  const refresh = useCallback(async () => {
    const rows = await sheetsOn(db, day);
    setSheets(rows);
    return rows;
  }, [db, day]);

  /**
   * 채점 갈래 하나. 한 장 집어 채점하고, 끝나면 다음을 집습니다.
   * 집을 게 없다고 하면 멈춥니다. **이게 큐 드라이버 전부입니다.**
   */
  const runLane = useCallback(
    async (first?: string) => {
      if (active.current >= LANES) return;
      active.current++;
      setBusyLanes(active.current);
      let sheetId = first;
      try {
        for (;;) {
          const { data } = await db.auth.getSession();
          const token = data.session?.access_token;
          if (!token) throw new Error("로그인이 풀렸습니다. 다시 로그인하십시오.");
          const r = await fetch("/api/grade-sheet", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify(sheetId ? { sheetId } : {}),
          });
          sheetId = undefined; // 첫 판만 지정하고, 그다음부터는 떠도는 것을 집습니다.
          const j = await r.json();
          if (!r.ok) throw new Error(j?.error ?? `요청 실패 (${r.status})`);
          void refresh().catch(() => {});
          if (j.done) return;
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        active.current--;
        setBusyLanes(active.current);
        void refresh().catch(() => {});
      }
    },
    [db, refresh],
  );

  /** 남은 게 있으면 갈래를 채웁니다. 남의 브라우저가 놓고 간 것도 여기서 주워집니다. */
  const ensureLanes = useCallback(
    (rows: SheetRow[]) => {
      const now = Date.now();
      const pending = rows.filter(
        (s) =>
          s.status === "queued" ||
          (s.status === "running" && s.claimed_at !== null && now - Date.parse(s.claimed_at) > STALE_MS),
      ).length;
      for (let i = active.current; i < Math.min(LANES, pending); i++) void runLane();
    },
    [runLane],
  );

  useEffect(() => {
    void refresh()
      .then(ensureLanes)
      .catch((e) => setErr(String(e.message ?? e)));
  }, [refresh, ensureLanes]);

  // 5초마다 봅니다. 조교 둘이 같은 화면을 보므로 남이 넣은 것도 여기서 나타납니다.
  useEffect(() => {
    const t = setInterval(() => void refresh().then(ensureLanes).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [refresh, ensureLanes]);

  const graded = sheets.filter((s) => s.status === "graded" || s.status === "confirmed").length;
  const review = sheets.filter(needsReview).length;
  const cost = sheets.reduce((a, s) => a + Number(s.cost_usd ?? 0), 0);

  return (
    <main className="mx-auto max-w-3xl p-5 pb-24">
      <Bar db={db} staff={staff}>
        <a href="/roster" className="font-medium text-slate-700 underline">
          명단
        </a>
        <a href="/quick" className="text-slate-500 underline">
          빠른 시험
        </a>
      </Bar>

      {err && (
        <p className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span>{err}</span>
          <button onClick={() => setErr(null)} className="shrink-0 underline">
            닫기
          </button>
        </p>
      )}

      <Receive
        db={db}
        onReceived={(sheet) => {
          void refresh().catch(() => {});
          void runLane(sheet.id); // 접수하는 즉시 그 장부터 채점을 겁니다.
        }}
      />

      <section className="mt-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
            />
            <span className="text-sm text-slate-600">
              접수 {sheets.length} · 채점됨 {graded}
            </span>
          </div>
          <span className="text-xs text-slate-500">
            {busyLanes > 0 && <span className="mr-2 text-slate-700">채점 중 {busyLanes}</span>}${cost.toFixed(2)}
          </span>
        </div>

        {review > 0 && (
          <p className="mb-3 rounded-lg border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900">
            🔶 <strong>{review}명은 사람이 반드시 봐야 합니다.</strong> 커트라인에 걸렸거나, 번호가 밀렸거나,
            판정을 내지 못한 답안지입니다.
          </p>
        )}

        <Sheets db={db} sheets={sheets} onChange={() => void refresh().catch(() => {})} />
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// 접수 — 한 학생분
// ---------------------------------------------------------------------------

function Receive({ db, onReceived }: { db: SupabaseClient; onReceived: (s: SheetRow) => void }) {
  const [imgs, setImgs] = useState<PreparedImage[]>([]);
  const [className, setClassName] = useState("");
  const [strict, setStrict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 반과 철자 방침은 학생이 바뀌어도 그대로입니다. 매번 다시 고르게 하지 않습니다.
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS) ?? "{}");
      if (typeof p.className === "string") setClassName(p.className);
      if (typeof p.strict === "boolean") setStrict(p.strict);
    } catch {
      /* 저장된 게 깨졌으면 그냥 기본값으로 */
    }
  }, []);
  useEffect(() => {
    localStorage.setItem(PREFS, JSON.stringify({ className, strict }));
  }, [className, strict]);

  async function onPick(files: FileList | null) {
    if (!files?.length) return;
    setErr(null);
    try {
      const prepared = await Promise.all([...files].map((f) => prepareImage(f)));
      setImgs((prev) => [...prev, ...prepared]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function rotate(k: number, delta: 90 | -90) {
    const next = await rotateBy(imgs[k], delta);
    setImgs((p) => p.map((x, i) => (i === k ? next : x)));
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const sheet = await intake(db, imgs, { className, cutLine: "", strictSpelling: strict });
      setImgs([]); // 다음 학생을 바로 받을 수 있게 비웁니다.
      onReceived(sheet);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-700">반</span>
          <input
            value={className}
            onChange={(e) => setClassName(e.target.value)}
            placeholder="예: 중3 A (안 써도 됩니다)"
            className="w-44 rounded-lg border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
          <span>철자 엄격</span>
        </label>
        <span className="text-xs text-slate-500">한 번 정해두면 다음 학생에도 그대로 붙습니다.</span>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">이 학생의 답안지</span>
        <span className="mb-2 block text-xs text-slate-500">
          <strong>양면이면 앞·뒤를 모두</strong> 찍으십시오. 순서는 상관없습니다 — 문항 번호로 합칩니다.
          시험 이름과 커트라인은 시험지에서 읽습니다.
        </span>
        <input
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          onChange={(e) => {
            void onPick(e.target.files);
            e.target.value = "";
          }}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-white"
        />
      </label>

      {imgs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-3">
          {imgs.map((im, k) => (
            <figure key={k} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={im.objectUrl}
                alt=""
                className={`h-28 w-auto rounded-lg border object-contain ${
                  im.looksSideways ? "border-2 border-amber-400" : "border-slate-200"
                }`}
              />
              <button
                onClick={() => setImgs((p) => p.filter((_, i) => i !== k))}
                className="absolute right-1 top-1 rounded bg-white/90 px-1.5 text-xs text-slate-600 shadow"
                aria-label="빼기"
              >
                ✕
              </button>
              <figcaption className="mt-1 flex items-center justify-center gap-1.5 text-xs text-slate-500">
                <button onClick={() => void rotate(k, -90)} className="rounded border border-slate-300 px-1.5" aria-label="왼쪽으로">
                  ↺
                </button>
                <span>{k + 1}쪽</span>
                <button onClick={() => void rotate(k, 90)} className="rounded border border-slate-300 px-1.5" aria-label="오른쪽으로">
                  ↻
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {imgs.some((i) => i.looksSideways) && (
        <p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
          가로로 누운 사진이 있습니다. 답안지가 <strong>세워져 보이도록 돌려 주십시오.</strong> 눕힌 채로도
          읽기는 하지만 칸을 놓칩니다.
        </p>
      )}
      {err && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-800">{err}</p>}

      <button
        onClick={() => void submit()}
        disabled={!imgs.length || busy}
        className="mt-4 w-full rounded-lg bg-slate-900 px-5 py-3 font-medium text-white disabled:opacity-40"
      >
        {busy ? "접수 중…" : imgs.length ? `접수하고 채점 시작 (${imgs.length}쪽)` : "사진을 찍어 주십시오"}
      </button>
      <p className="mt-2 text-center text-xs text-slate-500">
        접수하면 바로 뒤에서 채점됩니다. <strong>기다리지 말고 다음 학생을 받으십시오.</strong>
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 접수 목록
// ---------------------------------------------------------------------------

const STATUS: Record<SheetRow["status"], string> = {
  uploading: "올리는 중",
  queued: "대기",
  running: "채점 중",
  graded: "채점됨",
  failed: "실패",
  confirmed: "확정",
};

function Sheets({ db, sheets, onChange }: { db: SupabaseClient; sheets: SheetRow[]; onChange: () => void }) {
  if (!sheets.length) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
        이 날짜에 접수된 답안지가 없습니다.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
      {sheets.map((s) => (
        <Row key={s.id} db={db} s={s} onChange={onChange} />
      ))}
    </ul>
  );
}

/** 채점이 끝났으면 줄 전체가 링크, 아니면 그냥 칸. */
function Wrap({ open, id, children }: { open: boolean; id: string; children: React.ReactNode }) {
  return open ? (
    <a href={`/sheets/${id}`} className="min-w-0 flex-1 -m-1 rounded p-1 active:bg-slate-50">
      {children}
    </a>
  ) : (
    <div className="min-w-0 flex-1">{children}</div>
  );
}

function Row({ db, s, onChange }: { db: SupabaseClient; s: SheetRow; onChange: () => void }) {
  const [cut, setCut] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const v = s.final_verdict ?? s.verdict;
  const drift = (s.warnings ?? []).some((w) => w.level === "drift");
  const incomplete = (s.warnings ?? []).some((w) => w.level === "incomplete");
  const noCut = s.status === "graded" && s.cut === null;
  const open = s.status === "graded" || s.status === "confirmed";

  async function applyCut() {
    setBusy(true);
    setErr(null);
    try {
      const { data } = await db.auth.getSession();
      const r = await fetch(`/api/sheets/${s.id}/recount`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token ?? ""}` },
        body: JSON.stringify({ cutLine: cut }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `요청 실패 (${r.status})`);
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="p-3">
      {/*
        휴대폰으로 쓰는 화면입니다. 이름 글자만 링크로 두면 손가락으로 맞히기
        어려워, **줄 전체가 눌리게** 합니다. 채점이 끝난 줄만 열립니다 —
        열 게 없는 줄을 링크로 두면 헛걸음합니다.
      */}
      <div className="flex items-center justify-between gap-3">
        <Wrap open={open} id={s.id}>
          <p className="truncate font-medium">
            {s.student_name || <span className="text-slate-400">이름 못 읽음</span>}
            {s.title && <span className="ml-2 text-sm font-normal text-slate-500">{s.title}</span>}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
            <span>{new Date(s.created_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
            {s.class_name && <span>{s.class_name}</span>}
            <span>{STATUS[s.status]}</span>
            {s.n_wrong !== null && (
              <span>
                오답 {s.n_wrong}
                {s.cut !== null && ` / 허용 ${s.cut}`}
              </span>
            )}
            {s.near_boundary && <span className="font-medium text-amber-700">🔶 커트라인</span>}
            {drift && <span className="font-medium text-amber-700">⚠️ 밀림</span>}
            {incomplete && <span className="font-medium text-rose-700">📄 일부만 찍힘</span>}
            {s.error && <span className="text-rose-600">{s.error}</span>}
          </p>
        </Wrap>
        <div className="flex shrink-0 items-center gap-2">
          {v && (
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                v === "pass" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
              }`}
            >
              {v === "pass" ? "PASS" : "FAIL"}
            </span>
          )}
          {s.status === "failed" && (
            <button
              onClick={() => void retrySheet(db, s.id).then(onChange)}
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            >
              다시
            </button>
          )}
          {(s.status === "uploading" || s.status === "failed") && (
            <button
              onClick={() => confirm("이 답안지를 지웁니다.") && void deleteSheet(db, s).then(onChange)}
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500"
            >
              삭제
            </button>
          )}
          {open && (
            <a href={`/sheets/${s.id}`} className="rounded border border-slate-300 px-2.5 py-1.5 text-xs">
              {s.status === "confirmed" ? "보기" : "검수 ›"}
            </a>
          )}
        </div>
      </div>

      {/* 커트라인을 못 읽으면 판정이 없습니다. 다시 채점할 것 없이 숫자만 넣습니다. */}
      {noCut && (
        <div className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
          커트라인을 못 읽어 <strong>PASS/FAIL을 내지 않았습니다.</strong> 시험지에 적힌 대로 넣어 주십시오 —
          다시 채점하지 않고 세기만 합니다.
          <div className="mt-2 flex gap-2">
            <input
              value={cut}
              onChange={(e) => setCut(e.target.value)}
              placeholder="예: -8 까지 pass"
              className="w-48 rounded border border-amber-300 bg-white px-2 py-1 text-sm"
            />
            <button
              onClick={() => void applyCut()}
              disabled={busy || !cut.trim()}
              className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-40"
            >
              {busy ? "…" : "반영"}
            </button>
          </div>
          {err && <p className="mt-1 text-xs text-rose-700">{err}</p>}
        </div>
      )}

      {s.missing !== null && s.missing > 0 && !s.robust_to_missing && (
        <p className="mt-2 rounded-lg bg-rose-50 p-2 text-sm text-rose-900">
          못 읽은 {s.missing}칸이 <strong>결과를 뒤집을 수 있어 PASS/FAIL을 내지 않았습니다.</strong> 나머지 장을
          찍어 다시 접수하거나 검수하십시오.
        </p>
      )}
    </li>
  );
}
