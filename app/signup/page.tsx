"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Gate } from "@/components/Gate";

/**
 * 가입 주소 — **조교에게 보내는 링크가 여기입니다.**
 *
 * 로그인 화면에도 "처음입니다 — 계정 만들기"가 있지만, 그건 눌러야
 * 나옵니다. 메신저로 주소를 뿌릴 때는 **열자마자 가입 칸**이어야 합니다.
 * 안 그러면 링크마다 "들어가서 아래 작은 글씨를 누르세요"를 같이 적게 되고,
 * 그 한 줄을 못 읽은 사람이 로그인 칸에서 헤맵니다.
 *
 * 화면은 로그인 관문 그대로입니다 — 가입 뒤 승인 대기·승인 완료 흐름이
 * 전부 `Gate` 안에 있어서, 여기서 다시 만들면 두 벌이 됩니다.
 */
export default function SignupPage() {
  return <Gate signup>{() => <AlreadyIn />}</Gate>;
}

/**
 * 승인까지 끝난 계정이 가입 주소를 열었을 때.
 *
 * 즐겨찾기에 가입 링크를 넣어두면 매일 여기로 옵니다. 가입할 게 없으니
 * 접수 화면으로 넘깁니다 — **뒤로 가기에 남기지 않으려고** `replace`입니다.
 */
function AlreadyIn() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return <p className="p-6 text-sm text-slate-500">이미 로그인되어 있습니다 — 접수 화면으로 갑니다…</p>;
}
