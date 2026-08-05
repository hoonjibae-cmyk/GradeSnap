# 09. 유니크보카 생성기 분석 및 연동 설계

**대상**: [`hoonjibae-cmyk/Yunique-Voca-Test`](https://github.com/hoonjibae-cmyk/Yunique-Voca-Test)
**분석일**: 2026-08-05
**결론**: 연동 가치가 매우 높습니다. 다만 **그대로는 연동할 수 없고, 한 가지를 반드시 고쳐야 합니다.**

---

## 1. 구조

저장소는 파일 두 개가 전부입니다.

```
index.html      55KB   단일 페이지 앱 (HTML + CSS + JS 전부 인라인)
word_data.csv  266KB   단어 데이터 5,741행
```

**백엔드 없음. DB 없음. 빌드 없음. 저장 없음.**
브라우저에서 CSV를 `fetch`해 읽고, 화면에서 시험지를 만들어 인쇄하는 순수 클라이언트 도구입니다.

### 동작 흐름
```
word_data.csv 로드
   ↓
챕터 선택 + 단어 유형 선택 (표제어 / 연관어 / 동반의어)
   ↓
shuffleArray()로 무작위 섞기 → 앞에서 N개 자르기
   ↓
출제 방향 적용 (영→한 / 한→영 / 혼합)
   ↓
buildExamPaperHtml() → 시험지 HTML 렌더
   ↓
window.print()
```

### 데이터

```csv
Chapter,Type,Word,Meaning
15,표제어,mixture,"n.혼합물, 혼합"
15,연관어,mix,v.섞이다
```

| 항목 | 값 |
|---|---|
| 총 행 수 | 5,741 |
| 챕터 | 1 ~ 48 |
| 표제어 | 1,919 |
| 연관어 | 1,643 |
| 동반의어 | 2,173 |

---

## 2. 🟢 좋은 소식 — 답안 영역이 이미 DOM에 있습니다

이게 이번 분석에서 가장 큰 수확입니다.

시험지와 정답지의 **페이지 분할을 일치시키기 위해**, 시험지에도 정답 텍스트를
`color: transparent`로 넣어 높이를 확보하고 있습니다.

```css
.answer-line--filled { color: #b91c1c; }    /* 정답지: 빨간 정답 */
.answer-line--ghost  { color: transparent; } /* 시험지: 공간만 확보 */
```

```js
const answerLineClass = withAnswers ? 'answer-line--filled' : 'answer-line--ghost';
const answerLine = `<span class="answer-line ${answerLineClass}">${escapeHtml(answerText)}</span>`;
```

레이아웃을 맞추려고 넣은 장치인데, **GradeSnap 입장에서는 답안이 들어갈 자리에
정확한 크기의 DOM 요소가 이미 놓여 있다는 뜻입니다.**

```js
document.querySelectorAll('.answer-line--ghost')
        .forEach(el => el.getBoundingClientRect())
```

이 한 줄이면 문항 140개의 답안 영역 좌표가 전부 나옵니다.
**셀 검출도, 밑줄 검출도, 수동 드래그도 필요 없습니다.**

> [08 §4](08-sample-analysis.md)에서 "문항 160개를 손으로 찍는 건 불가능하니
> 답안 영역 자동 검출이 필수"라고 했는데, 유니크보카에 한해서는 **검출조차 불필요합니다.**

---

## 3. 🔴 나쁜 소식 — 출제 이력이 저장되지 않습니다

**이것이 연동의 유일한 진짜 블로커입니다.**

```js
const shuffled = shuffleArray(filtered);
return shuffled.slice(0, Math.min(wordCount, shuffled.length));
```

문항은 매번 **무작위로 섞입니다.** 그리고 결과는 어디에도 저장되지 않습니다.
`localStorage`도, 서버 전송도, 파일 출력도 없습니다. 코드 전체에서 `fetch`는
CSV를 읽는 단 한 곳뿐입니다.

즉 **인쇄된 시험지의 3번 문항이 어떤 단어였는지 알 방법이 없습니다.**
같은 조건(챕터·유형·문항 수)으로 다시 생성해도 셔플 때문에 다른 시험지가 나옵니다.

정답 데이터가 CSV에 다 있어도, **어떤 정답이 몇 번 문항인지 모르면 채점할 수 없습니다.**

### 부수적 문제 — CSV 파싱 오류

따옴표 이스케이프가 깨진 행이 6개 있습니다.

```
Type 열에 들어간 잘못된 값:
  "명시하다"        1행
  퍼뜨리다          1행
  "                4행
```
`"v.진술하다 v.펼치다"` 같은 쉼표 포함 뜻이 제대로 감싸이지 않아 열이 밀린 것으로 보입니다.
5,741행 중 6행이라 출제에는 티가 안 나지만, **정답표로 쓰려면 정리해야 합니다.**

---

## 4. 연동 설계

### 필요한 변경 — 유니크보카 쪽

시험지를 만드는 시점에 **"이 시험지가 무엇인지"를 기록**하면 됩니다.

```js
// 인쇄 직전에 실행
const examSpec = {
  exam_id: crypto.randomUUID(),
  created_at: <생성 시각>,
  source: 'yunique-voca',
  csv_version: <word_data.csv 해시>,
  meta: { chapters, wordTypes, direction, cutLine, className, title },
  items: words.map((w, i) => ({
    no: i + 1,
    question: <제시어>,
    answer:   <정답>,
    chapter: w.Chapter,
    type: w.Type,
    direction: <해당 문항의 방향>,   // 혼합일 때 문항마다 다름
    bbox: <해당 .answer-line의 정규화 좌표>
  }))
};
```

`bbox`는 인쇄 직전 DOM에서 뽑습니다.

```js
const page = document.querySelector('.exam-paper-shell').getBoundingClientRect();
const r = el.getBoundingClientRect();
const bbox = {
  x: (r.left   - page.left) / page.width,
  y: (r.top    - page.top ) / page.height,
  w:  r.width  / page.width,
  h:  r.height / page.height
};
```

그리고 시험지에 **QR과 기준 마커를 인쇄**합니다.
QR 내용은 `GS:<exam_id>:<page_no>` 하나면 충분합니다.

| 추가 작업 | 규모 |
|---|---|
| 좌표 추출 + examSpec 생성 | ~40줄 |
| QR 렌더 (인라인 라이브러리) | ~20줄 |
| 기준 마커 4개 (CSS) | ~15줄 |
| GradeSnap에 POST 또는 JSON 다운로드 | ~15줄 |

**100줄 이내**입니다. 기존 출제 흐름은 전혀 건드리지 않습니다.

### 저장 방식 — 두 가지 선택지

| 방식 | 내용 | 장단점 |
|---|---|---|
| **A. GradeSnap에 POST** *(권장)* | 생성 시 examSpec을 GradeSnap API로 전송 | 정석. 재시험·통계 등 확장 자유로움. 유니크보카가 네트워크에 의존하게 됨 |
| B. 시드 고정 | 셔플 시드를 QR에 넣고, 채점 때 재생성해 복원 | 저장소 불필요. 단 `word_data.csv`나 셔플 로직이 바뀌면 **과거 시험지가 전부 깨짐** |

B는 가볍지만 위험합니다. CSV는 실제로 업데이트되고 있고(최근 커밋이 `Update word_data.csv`),
한 번 깨지면 조용히 오채점됩니다. **A를 권장합니다.**

### GradeSnap 쪽

`exam_template`을 **PDF 업로드 없이 examSpec JSON으로 생성**하는 경로를 추가합니다.
[04. 데이터 모델](04-data-model.md)의 스키마는 그대로 쓸 수 있습니다.

```
POST /api/templates/from-generator
  → exam_template + template_page + question + answer_region + answer_key 일괄 생성
```

`answer_region.bbox`는 examSpec의 좌표를 그대로 받습니다.
`answer_key.canonical`은 CSV의 뜻/단어, `pass_rule`은 컷트라인에서 옵니다.

---

## 5. 두 경로를 함께 유지합니다

유니크보카 외의 시험지는 **템플릿 없이 그때그때 만들어지는 경우가 많습니다.**
(문법 백지 TEST, 영작클리닉, 교재 기반 단어시험 등)

따라서 GradeSnap은 **두 가지 등록 경로를 모두 지원**해야 합니다.

| 경로 | 대상 | 좌표 확보 방식 |
|---|---|---|
| **A. 생성기 연동** | 유니크보카 (+ 향후 다른 생성기) | DOM에서 자동 추출 — 사람 개입 0 |
| **B. 템플릿 편집기** | 그 외 모든 시험지 | PDF 업로드 → 자동 검출 → 수동 보정 |

경로 A가 있다고 해서 **경로 B가 불필요해지지는 않습니다.**
다만 A 덕분에 **가장 문항 수가 많은 시험지(90~160문항)가 B를 거치지 않게 되어**,
템플릿 편집기의 부담이 크게 줄어듭니다.
편집기는 문항 10~50개 규모의 시험지를 다루면 되므로 수동 드래그 + 격자 복제로 충분합니다.

---

## 6. 다음 단계

### 유니크보카 쪽
1. CSV 파싱 오류 6행 수정 (따옴표 이스케이프)
2. `word_data.csv`에 버전/해시 부여 — 어떤 버전으로 낸 시험인지 추적
3. examSpec 생성 + 좌표 추출 코드 추가
4. QR + 기준 마커 인쇄 추가
5. GradeSnap 연동 (또는 JSON 다운로드 → 수동 업로드로 시작)

### GradeSnap 쪽
6. `POST /api/templates/from-generator` 구현
7. examSpec 스키마 확정 — **이걸 먼저 정해야 양쪽을 병행 개발할 수 있습니다**

### 확인 필요
8. 다른 시험지 생성기가 또 있는지 — 헤더 구조가 유사한 시험지가 여럿 확인됨
   (`문법 백지 TEST`, `영작클리닉`, `Day08-10 단어시험`)
   같은 방식으로 연동 가능한 생성기가 더 있다면 경로 A의 적용 범위가 넓어집니다.