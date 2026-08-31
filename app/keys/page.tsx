"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Bar, Gate } from "@/components/Gate";
import { deleteAnswerKey, KEY_DAYS, keyDaysLeft, listAnswerKeys, saveAnswerKey } from "@/lib/db/queries";
import type { AnswerKeyRow, StaffRow } from "@/lib/db/schema";
import type { DriveFile } from "@/lib/drive/client";
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
 *
 * 2026-08-31, 길이 하나 늘었습니다(§13.45). 선생님들은 이미 매번 정답지를
 * **구글 폴더에 올리고 있습니다.** 조교가 그걸 다시 종이로 뽑아 사진 찍는
 * 것은 같은 일을 두 번 하는 것이라, 폴더에서 바로 가져옵니다.
 *
 * 🔴 **어느 길로 오든 저장 전에 사람이 확인합니다.** 정답지가 틀리면 그
 * 시험을 본 반 전체가 같은 오류로 채점됩니다. 자동으로 집어넣지 않는
 * 이유가 그것입니다.
 */
export default function KeysPage() {
  return <Gate>{(db, staff) => <Keys db={db} staff={staff} />}</Gate>;
}

interface Draft {
  no: string;
  expected: string;
  prompt?: string;
}

function Keys({ db, staff }: { db: SupabaseClient; staff: StaffRow }) {
  const [err, setErr] = useState<string | null>(null);
  const onError = setErr;
  const [keys, setKeys] = useState<AnswerKeyRow[]>([]);
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [from, setFrom] = useState<string | null>(null);

  const load = useCallback(async () => setKeys(await listAnswerKeys(db)), [db]);
  useEffect(() => {
    void load().catch((e) => onError(String(e.message ?? e)));
  }, [load, onError]);

  const auth = useCallback(async () => {
    const { data } = await db.auth.getSession();
    return { authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }, [db]);

  /** 사진 한 장을 읽습니다. 예전부터 있던 길입니다. */
  async function readPhoto(file: File | null) {
    if (!file) return;
    setBusy(true);
    setDone(null);
    try {
      const img = await prepareImage(file);
      const r = await fetch("/api/answer-key", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await auth()) },
        body: JSON.stringify({ image: img.base64 }),
      });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j?.error ?? `요청 실패 (${r.status})`);
      // 제목을 못 읽었으면 사람이 적습니다. **제목으로 답안지와 맞춥니다.**
      if (j.title) setTitle(j.title);
      setItems(j.items ?? []);
      setFrom(`사진 · ${file.name}`);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** 구글 폴더의 PDF 하나를 읽습니다. */
  async function readDrive(f: DriveFile) {
    setBusy(true);
    setDone(null);
    try {
      const r = await fetch("/api/drive/keys", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await auth()) },
        body: JSON.stringify({ fileId: f.id, name: f.name }),
      });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j?.error ?? `요청 실패 (${r.status})`);
      if (j.title) setTitle(j.title);
      setItems(j.items ?? []);
      setFrom(`구글 폴더 · ${f.name}`);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await saveAnswerKey(db, {
        title,
        items: items
          .filter((i) => i.no.trim() && i.expected.trim())
          .map((i) => ({ no: i.no.trim(), expected: i.expected.trim(), prompt: (i.prompt ?? "").trim() })),
      });
      setDone(`「${title}」 정답지를 등록했습니다. 이 제목의 답안지부터 적용됩니다.`);
      setTitle("");
      setItems([]);
      setFrom(null);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function edit(i: number, patch: Partial<Draft>) {
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
          선생님이 만들어 두신 <strong>정답지를 한 번 등록하면</strong> 그때부터 그 시험은 채점됩니다.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          <strong>시험 제목으로 맞춥니다</strong> — 답안지에 인쇄된 제목과 같은 것이 가장 좋습니다. 조금 달라도
          붙이지만, 그때는 채점 화면에 그렇게 적힙니다. 그리고 올린 지{" "}
          <strong>{KEY_DAYS}일이 지나면 자동으로 지워집니다.</strong> 다음 학기에 같은 제목으로 다른 시험이
          나오면 옛 정답으로 채점될 수 있어서입니다. 계속 쓰시려면 다시 올리면 됩니다.
        </p>

        <DrivePicker auth={auth} busy={busy} onPick={(f) => void readDrive(f)} onError={onError} />

        <label className="mt-4 block border-t border-slate-200 pt-4">
          <span className="mb-1 block text-sm font-medium">정답지 사진</span>
          <span className="mb-1 block text-xs text-slate-500">
            구글 폴더에 없는 시험, 급하게 만든 재시험지는 이쪽입니다.
          </span>
          <input
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => {
              void readPhoto(e.target.files?.[0] ?? null);
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
            {from && <p className="mt-1 text-xs text-amber-800">{from}에서 읽었습니다.</p>}

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
                  <th className="py-1 font-medium">제시어</th>
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
                        className="w-14 rounded border border-slate-300 px-2 py-1"
                      />
                    </td>
                    {/* 제시어는 채점에 안 씁니다 — 제목이 어긋났을 때 이 정답지를
                        찾아내는 데만 쓰입니다. 그래서 좁게 두고, 비어 있어도 됩니다. */}
                    <td className="py-0.5 pr-2">
                      <input
                        value={it.prompt ?? ""}
                        onChange={(e) => edit(i, { prompt: e.target.value })}
                        className="w-full rounded border border-slate-200 bg-white/60 px-2 py-1 text-slate-500"
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
                onClick={() => setItems((p) => [...p, { no: "", expected: "", prompt: "" }])}
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
                  setFrom(null);
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
            <p className="mt-1 text-xs text-slate-500">아직 없습니다. 위에서 정답지를 가져오거나 찍어 올리십시오.</p>
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

/** 한 번에 보여줄 파일 수. 나머지는 검색으로 좁힙니다. */
const SHOW = 12;

/**
 * 구글 폴더에서 고르기.
 *
 * 폴더가 안 연결돼 있으면 **아무것도 안 보입니다.** 눌러도 안 되는 버튼을
 * 띄우느니 없는 편이 낫고, 사진으로 올리는 길은 그대로 있습니다.
 */
function DrivePicker({
  auth,
  busy,
  onPick,
  onError,
}: {
  auth: () => Promise<{ authorization: string }>;
  busy: boolean;
  onPick: (f: DriveFile) => void;
  onError: (m: string) => void;
}) {
  const [state, setState] = useState<"loading" | "off" | "ready" | "failed">("loading");
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [q, setQ] = useState("");
  const [why, setWhy] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/drive/keys", { headers: await auth() });
        const j = await readJson(r);
        if (!alive) return;
        if (!r.ok) {
          setWhy(j?.error ?? `요청 실패 (${r.status})`);
          setState("failed");
          return;
        }
        if (!j.configured) {
          setState("off");
          return;
        }
        setFiles(j.files ?? []);
        setState("ready");
      } catch (e) {
        if (!alive) return;
        setWhy(e instanceof Error ? e.message : String(e));
        setState("failed");
      }
    })();
    return () => {
      alive = false;
    };
  }, [auth]);

  const shown = useMemo(() => {
    const needle = q.normalize("NFKC").trim().toLowerCase();
    const hit = needle
      ? files.filter((f) => `${f.folder} ${f.name}`.normalize("NFKC").toLowerCase().includes(needle))
      : files;
    return { hit, list: hit.slice(0, SHOW) };
  }, [files, q]);

  // 연결 안 됨 · 읽는 중은 조용히 넘어갑니다. 사진 경로가 그대로 있습니다.
  if (state === "off") return null;
  if (state === "loading") return <p className="mt-3 text-xs text-slate-400">구글 폴더를 읽는 중…</p>;
  if (state === "failed") {
    return (
      <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
        구글 폴더를 못 읽었습니다 — {why} <strong>아래에서 사진으로 올리면 됩니다.</strong>
      </p>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-sm font-medium">구글 폴더에서 가져오기</p>
      <p className="mt-0.5 text-xs text-slate-500">
        선생님들이 올려 두신 <strong>「답지」 파일</strong>입니다. 최근 것부터 {files.length}개.
      </p>
      {files.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          폴더에서 「답지」가 들어간 파일을 못 찾았습니다. 아래에서 사진으로 올리십시오.
        </p>
      ) : (
        <>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="선생님 이름이나 시험 이름으로 찾기"
            className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <ul className="mt-2 divide-y divide-slate-200">
            {shown.list.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm">{f.name}</span>
                  <span className="block text-xs text-slate-500">
                    {f.folder || "폴더 없음"} · {f.modifiedTime.slice(0, 10)}
                    {!f.readable && <strong className="ml-1 text-amber-700">PDF가 아님</strong>}
                  </span>
                </span>
                <button
                  onClick={() => onPick(f)}
                  disabled={busy || !f.readable}
                  className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-30"
                >
                  읽기
                </button>
              </li>
            ))}
          </ul>
          {shown.hit.length > SHOW && (
            <p className="mt-1 text-xs text-slate-500">
              {shown.hit.length - SHOW}개 더 있습니다 — 위에서 이름으로 좁히십시오.
            </p>
          )}
          {shown.hit.length === 0 && <p className="mt-2 text-xs text-slate-500">찾는 이름이 없습니다.</p>}
        </>
      )}
      {/* 읽기만 하고 저장은 안 합니다 — 확인 표가 아래에 뜹니다. */}
      <p className="mt-2 text-xs text-slate-400">
        누르면 <strong>읽어서 아래 표에 채웁니다.</strong> 확인하고 등록을 눌러야 저장됩니다.
      </p>
    </div>
  );
}
