# hyuml-editor

Mermaid 문법으로 UML 다이어그램을 그리는 **코드 ↔ 캔버스 양방향 편집기**입니다.

- 왼쪽 코드 창에서 Mermaid 코드를 고치면 오른쪽 캔버스가 바로 바뀝니다.
- 캔버스에서 클래스 이름·멤버·관계 라벨을 고치면 코드의 **해당 부분만** 바뀝니다.
- 도형 위치·크기·색 같은 시각 정보는 코드에 섞지 않고 별도 레이아웃 데이터로 관리합니다. 그래서 코드를 고쳐도 **이미 배치한 도형은 움직이지 않습니다.**

지원 다이어그램: **클래스**(`classDiagram`), **시퀀스**(`sequenceDiagram`), **유스케이스**(`usecase-beta`)

> 설계·진행 상황·변경 이력의 상세 기록은 [PROGRESS.md](PROGRESS.md)에 있습니다. 코드를 수정하기 전에 먼저 읽어 주세요.

---

## 목차

1. [빠른 시작](#1-빠른-시작)
2. [사용 방법](#2-사용-방법)
3. [지원 문법 예시](#3-지원-문법-예시)
4. [아키텍처](#4-아키텍처)
5. [기능별 구현 방법](#5-기능별-구현-방법)
6. [사용한 디자인 패턴](#6-사용한-디자인-패턴)
7. [핵심 알고리즘](#7-핵심-알고리즘)
8. [폴더 구조](#8-폴더-구조)
9. [테스트](#9-테스트)
10. [기술 스택](#10-기술-스택)

---

## 1. 빠른 시작

패키지 매니저는 npm입니다(`package-lock.json`). Node 최소 버전은 지정돼 있지 않으며, Node 24에서 확인했습니다.

```bash
npm install          # 의존성 설치
npm run dev          # 개발 서버 실행 → 터미널에 나온 주소를 브라우저로 열기
```

| 스크립트 | 명령어 | 용도 |
|---|---|---|
| `npm run dev` | `vite` | 개발 서버 |
| `npm run build` | `tsc -b && vite build` | 타입 검사 후 `dist/`에 정적 파일 빌드 |
| `npm run preview` | `vite preview` | 빌드 결과 미리보기 |
| `npm run test` | `vitest run` | 단위 테스트 1회 실행 |
| `npm run test:watch` | `vitest` | 테스트 감시 모드 |
| `npm run e2e` | `node e2e/run.mjs` | 브라우저(Chromium) UI 시나리오 검증 — [9절](#9-테스트) 참고 |
| `npm run typecheck` | `tsc -b` | 타입 검사만 |
| `npm run lint` | `oxlint` | 린트 |

`npm run build` 결과물(`dist/`)은 서버가 필요 없는 정적 파일이라 Netlify·Vercel·GitHub Pages 같은 정적 호스팅에 그대로 올릴 수 있습니다. GitHub Pages처럼 하위 경로(`/저장소명/`)로 배포할 때는 `vite.config.ts`에 `base: '/저장소명/'`을 추가해야 합니다.

---

## 2. 사용 방법

### 화면 구성

```
┌──────────────┬─┬────────────────────────────────────────┐
│ 코드 창       │ │ 캔버스                       [툴바]     │
│ (Monaco)     │↔│                                         │
│              │ │   ┌───────┐        ┌───────┐            │
│ classDiagram │ │   │ Order │───────▶│Payment│            │
│ class Order  │ │   └───────┘        └───────┘            │
│ ...          │ │                                         │
│──────────────│ │                                         │
│ 진단(오류)목록 │ │                            DKU Software │
└──────────────┴─┴────────────────────────────────────────┘
```

- 가운데 세로 막대를 끌면 코드 창 너비가 바뀝니다. 툴바의 `💻 코드 창`으로 숨기거나 보일 수 있습니다.
- 코드에 오류가 있으면 코드 창 아래 진단 목록에 표시되고, 클릭하면 해당 줄로 이동합니다. 오류가 있는 동안 캔버스는 **마지막으로 정상이었던 그림을 유지**합니다.
- 코드를 고쳐도 이미 있는 도형의 위치는 바뀌지 않고, 새 도형만 빈 곳에 놓입니다. 도형 이름 하나가 사라지고 새 이름 하나가 생기면(간선 연결이 같을 때, 연결이 없는 도형끼리는 항상) 이름 변경으로 보고 위치와 스타일을 그대로 이어받습니다.

### 캔버스 조작

| 하고 싶은 것 | 방법 |
|---|---|
| 화면 이동 | 빈 곳을 드래그 |
| 확대/축소 | 마우스 휠 (커서 위치 기준) |
| 도형 이동 | 도형 드래그 |
| 여러 도형 선택 | **Ctrl(맥은 Cmd) 또는 Shift를 누른 채 드래그** (상자 안에 완전히 들어온 도형이 선택됨), 또는 Ctrl+클릭 |
| 도형 크기 조절 | 마우스를 올리면 나오는 모서리 손잡이를 드래그. `↺` 버튼으로 자동 크기로 복귀 |
| 이름·멤버 수정 | 글자를 클릭해 바로 입력. **Enter**/바깥 클릭 = 확정, **Esc** = 취소 |
| 관계 라벨 추가 | 연결선을 더블클릭 |
| 글꼴 크기·색·배경색 | 글자를 편집하는 동안 위에 뜨는 서식 도구 |
| 연결선 꺾기 | 연결선에 마우스를 올리면 나오는 **동그란 손잡이**를 드래그 → 꺾임점 생성 |
| 꺾임점 이동/삭제 | **네모 손잡이** 드래그 / 더블클릭 |
| 자동 경로로 되돌리기 | 꺾임점 근처의 `↺` 버튼 |
| 그룹 만들기 | 도형 여러 개 선택 → 툴바 `그룹` → 이름 입력 → `묶기` |
| 그룹 이동/이름 변경/해제 | 그룹 이름표를 드래그 / 클릭해서 수정 / 서식 도구의 `그룹 해제` |
| 실행 취소 / 다시 실행 | `Ctrl+Z` / `Ctrl+Shift+Z` 또는 `Ctrl+Y` (코드 창에 포커스가 있으면 코드 창 자체의 Undo가 동작) |

마우스를 올린 도형의 테두리와 연결선은 굵게 강조됩니다.

### 툴바

| 버튼 | 기능 |
|---|---|
| `▶ 적용` | 코드를 즉시 반영 (평소에는 입력을 멈추고 0.3초 뒤 자동 반영) |
| `↶` `↷` | 실행 취소 / 다시 실행 |
| `자동 정렬` + 엔진 선택 | 전체를 다시 배치합니다. 클래스·유스케이스는 dagre 또는 ELK, 시퀀스는 선언 순서대로 같은 간격 |
| `빈 칸 숨김`/`빈 칸 표시` | 멤버가 없는 클래스 구획을 숨길지 보일지 전환 |
| `그룹 (n)` | 선택한 도형 n개를 그룹으로 묶기 |
| 글꼴 크기 | 다이어그램 기본 글꼴 (8~24pt) |
| 전체 제목/간선 스타일 | 모든 제목 글꼴·색, 모든 간선 굵기·색 일괄 변경 (개별로 바꾼 것은 제외) |
| `PNG` `JPEG` `SVG` | 이미지 내보내기. PNG/JPEG는 **300dpi 정보가 기록**되어 Word·LaTeX에 원래 크기로 들어갑니다 |
| `.mmd` | Mermaid 코드만 저장 |
| `흰 배경` 체크 | 다크 모드여도 밝은 테마·흰 배경으로 이미지 내보내기 (기본 켜짐) |
| `프로젝트 저장` / `프로젝트 열기` | 코드 + 레이아웃(위치·스타일)을 한 파일(.json)로 저장/복원 |
| 다크 모드, `💻 코드 창` | 테마 전환, 코드 창 표시 전환 |

---

## 3. 지원 문법 예시

자체 파서가 인식하는 문법입니다. 인식하지 못한 줄은 오류가 아니라 **경고**로 표시되고, 나머지는 계속 그려집니다.

**클래스 다이어그램**
```
classDiagram
  direction LR
  class Order {
    +id: string
    +pay(amount: number) bool
  }
  Order "1" --> "0..*" Item : contains
  Animal <|-- Dog
  namespace Shop {
    class Order
  }
```
그 밖에 `A : +foo() int`(한 줄 멤버), `class A["표시 이름"]`, `class A~T~`(제네릭), `<<interface>> A`, `..`(점선 관계), 멤버 끝 `$`/`*`(static/abstract)를 지원합니다.

**유스케이스 다이어그램** (Mermaid 12 `usecase-beta`)
```
usecase-beta
  actor User(사용자)
  Login(로그인)
  User --> Login
  Login ..>:include Auth
  systemBoundary Shop[쇼핑몰]
    Login
  end
```

**시퀀스 다이어그램**
```
sequenceDiagram
  participant A as Alice
  actor B
  A->>+B: hello
  B-->>-A: ok
  Note over A,B: memo
  loop retry
    A->>B: ping
  end
```
화살표 `->` `-->` `->>` `-->>` `-x` `--x` `-)` `--)` `<<->>`, `alt/else`, `opt`, `par/and`, `critical/option`, `break`, `rect`, `box`, `autonumber`, `title`, `activate/deactivate/destroy`를 지원합니다.

---

## 4. 아키텍처

### 핵심 아이디어: 문서는 두 가지뿐

```
DiagramDocument = { source: Mermaid 코드(문자열),  layout: 좌표·크기·스타일·꺾임점 }
```

저장·Undo·파일로 남는 것은 이 두 값뿐이고, 나머지(파싱된 모델, 간선 경로, 라벨 위치, 화면 요소)는 **언제든 이 두 값에서 다시 계산되는 파생값**입니다.

- **코드**는 "무엇이 있는가"(클래스, 관계, 멤버)를 담당합니다.
- **layout**은 "어디에 어떻게 보이는가"를 담당하며 코드 창에는 절대 나타나지 않습니다.

둘을 섞지 않기 때문에 코드를 고쳐도 위치가 보존되고, 반대로 도형을 옮겨도 코드는 바뀌지 않습니다.

### 데이터 흐름

```
[코드 창] ─입력─▶ doc.source ─(0.3초 디바운스)─▶ commitNow()
                                                   │
           parseDiagram : 헤더를 보고 플러그인 선택 → class / sequence / usecase 파서
                                                   │  (오류가 있으면 여기서 멈추고 이전 그림 유지)
                                                   ▼
           reconcile : 기존 도형 좌표는 그대로, 새 도형만 레이아웃 엔진(dagre/ELK)으로 배치
                                                   ▼
                          store: model + doc.layout
                                                   ▼
           toFlowElements : 도형 노드 + 그룹 상자 + 직교 경로 + 라벨 위치 계산
                                                   ▼
           React Flow 렌더링 (클래스/유스케이스/참여자/시퀀스 본문/그룹/간선 컴포넌트)

[캔버스 글자 편집] ─▶ edits.ts 가 최소 TextEdit 계산 ─▶ applyEdit ─▶ 코드 갱신 + layout 키 이전
                                                                 └▶ 코드 창에도 해당 범위만 반영
[캔버스 드래그·스타일] ─▶ layout 만 변경 (코드는 그대로)
```

### 3계층 구조

| 계층 | 폴더 | 역할 |
|---|---|---|
| **순수 로직** | `src/core/` | 파서, 편집 계산, reconcile, 라우팅, 레이아웃. React·스토어를 전혀 모르는 순수 함수라 테스트가 쉽습니다. |
| **상태** | `src/store/` | zustand + immer 스토어를 세 슬라이스로 나눴습니다. `documentSlice`는 저장·Undo 대상과 모든 명령, `derivedSlice`는 파생 상태와 파싱 파이프라인, `uiSlice`는 다크 모드·선택·알림처럼 Undo 대상이 아닌 상태입니다. |
| **표현** | `src/view/`, `src/ui/` | 모델을 화면 요소로 변환하고 렌더링합니다. 컴포넌트는 로직 없이 스토어 명령만 호출합니다. |

---

## 5. 기능별 구현 방법

### 5.1 파싱 (코드 → 모델)
- `core/diagrams/*/parser.ts` — Mermaid 라이브러리에 의존하지 않는 **자체 줄 단위 파서**입니다. 정규식(`d` 플래그로 매치 위치까지 획득)으로 한 줄씩 해석합니다.
- 모든 이름·멤버·라벨의 **소스 위치(`SourceRange`)를 모델에 기록**합니다. 캔버스 편집을 정확한 코드 편집으로 바꾸기 위한 핵심 정보입니다.
- 파서는 **절대 예외를 던지지 않고** 문제를 `Diagnostic`(오류/경고)으로 돌려줍니다. 레지스트리에서 한 번 더 `try/catch`로 막습니다.
- 실제 `mermaid` 라이브러리는 자체 파서가 깨끗할 때만 비동기로 불러와 **호환성 경고**를 추가하는 용도로만 씁니다.

### 5.2 위치 보존 (reconcile)
- `core/document/reconcile.ts`의 `reconcileLayout()`는 코드가 바뀔 때 다음과 같이 처리합니다.
  - **기존 도형**: 좌표를 0px도 바꾸지 않습니다. 자동 크기 도형은 크기만 내용에 맞춥니다.
  - **사라졌다 다시 나타난 도형**: 휴지통(trash)에서 좌표를 복원합니다. 타이핑 중 이름이 잠깐 깨져도 제자리로 돌아옵니다.
  - **이름이 바뀐 도형**: "사라진 1개 + 새로 생긴 1개"이고 연결 관계가 같으면 같은 도형으로 보고 좌표를 승계합니다.
  - **새 도형**: 레이아웃 엔진이 전체를 계산하면 `placeAddedNodes()`가 새 도형 좌표만 가져와, 연결된 기존 도형을 기준으로 평행이동하고 겹치면 밀어냅니다.
- 시퀀스는 `sequence/reconcile.ts`가 같은 원칙으로 참여자의 가로 위치만 다룹니다.

### 5.3 캔버스 → 코드 편집
- `core/diagrams/*/edits.ts`는 "무엇을 어떻게 바꿀지"를 `EditResult`(최소 `TextEdit[]` + 이름 변경 정보)로 계산하는 순수 함수입니다.
- 파서가 기록한 범위만 바꾸므로 같은 단어가 주석·타입·다른 라벨에 있어도 건드리지 않습니다. 클래스 이름 변경은 그 클래스를 가리키는 **모든 참조 위치**를 함께 바꿉니다.
- 스토어의 `applyEdit()`는 다음 순서로 처리합니다.
  1. 소스에 편집을 적용합니다.
  2. 이름이 바뀌면 `keys.ts`의 `migrate*()`로 좌표·스타일·꺾임점의 **키를 새 이름으로 이전**합니다.
  3. `editorBridge`를 통해 Monaco 코드 창에도 **해당 범위만** 적용해 커서와 코드 창 Undo를 보존합니다.

### 5.4 스타일 키
- 스타일은 순서가 아닌 **의미 기반 키**로 저장합니다. 예: `node:Order/title`, `node:Order/member:a:+id: string`, `edge:A|association|B/label`, `msg:A->B:hello/text`.
- 줄 순서를 바꾸거나 다른 줄을 지워도 스타일이 엉뚱한 요소로 옮겨가지 않습니다.

### 5.5 실행 취소 / 다시 실행
- 변경 직전의 `{source, layout}` 문서 **참조**를 `past` 스택에 쌓습니다(최대 100개). immer로 관리되는 불변 객체라 복사 없이 참조만 저장해도 안전합니다.
- 같은 종류의 연속 입력(타이핑, 같은 요소의 글꼴 크기 연타)은 1.2초 안이면 **하나의 Undo 단위로 병합**합니다.
- 드래그는 `beginInteraction`/`endInteraction`으로 감싸고, 실제로 움직이지 않았으면 빈 기록을 제거합니다.

### 5.6 비동기 처리와 경쟁 조건
- 코드 입력은 300ms **디바운스** 후 반영합니다.
- 레이아웃 엔진은 비동기라서 커밋마다 순번(`parseSeq`)을 붙여 **늦게 끝난 오래된 결과는 버립니다.**
- 엔진을 기다리는 동안 사용자가 도형을 옮겼을 수 있으므로, 결과를 적용하는 시점에 reconcile을 한 번 더 실행해 그 변경을 잃지 않습니다.
- 선택한 엔진이 실패하면 dagre로, 그것도 실패하면 단순 배치로 **폴백**합니다.

### 5.7 렌더링
- `view/toFlowElements.ts`가 모델 + layout을 React Flow의 노드·간선 배열로 바꿉니다. 스토어가 **유일한 상태**이고 React Flow는 화면 표시만 합니다. 드래그 같은 React Flow 이벤트는 `FlowCanvas`에서 스토어 명령으로 번역됩니다.
- 입력이 같으면 같은 노드 객체를 돌려주는 `WeakMap` 캐시로 드래그 중 다른 도형이 다시 그려지지 않게 합니다.
- 그룹 상자의 위치·크기는 저장하지 않고 **구성원 도형에서 매번 계산**합니다.

### 5.8 연결선 꺾기
- 꺾임점은 `layout.edgeWaypoints[간선id]`에 저장합니다. 꺾임점이 있으면 그 점들을 지나는 직교 경로를, 없으면 자동 경로를 그립니다.
- 드래그 중 이동·종료 이벤트는 `window`에서 받습니다. 손잡이 요소가 사라져도 드래그가 끊기지 않습니다. 좌표는 5px 격자에 맞춥니다.
- 자동 정렬을 하면 기존 꺾임점은 의미가 없어지므로 모두 지웁니다.

### 5.9 그룹
- 그룹은 코드로 표현됩니다. 클래스는 `namespace`, 시퀀스는 `box`, 유스케이스는 `systemBoundary`입니다.
- 만들기·해제·이름 변경은 모두 `groupEdits.ts`가 계산한 코드 편집입니다.
- 그룹 상자를 드래그하면 구성원 전체가 함께 이동합니다.

### 5.10 내보내기와 파일 형식
- 이미지는 `html-to-image`로 캔버스를 캡처합니다. 현재 확대 상태와 무관하게 다이어그램 전체를 1:1로 찍으며, 편집 손잡이·툴바(`hy-no-export` 클래스)는 제외합니다.
- `export/dpi.ts`는 PNG에 `pHYs` 청크(CRC 포함)를, JPEG에는 JFIF 밀도 정보를 **직접 바이트로 써서** 300dpi를 기록합니다.
- 프로젝트 파일은 `%%% graph` 아래에 코드를, `%%% layout` 아래에 JSON을 담은 텍스트입니다. 읽을 때는 모든 값을 검증·보정하고 이전 버전(v1·v2) 파일도 변환합니다. 이 과정에서는 절대 예외를 던지지 않습니다.

### 5.11 테마와 스타일링
- CSS 모듈이나 Tailwind 없이 **인라인 스타일 객체**를 씁니다. 전역 CSS는 `src/index.css`(리셋)뿐입니다.
- 색은 `core/theme.ts`의 `THEMES.light/dark`에서 `themeOf(isDarkMode)`로 골라 컴포넌트에 전달합니다.
- 글꼴·간격 토큰(`TYPO`, `SEQ`)은 **크기 측정 코드와 렌더링 코드가 같은 값을 쓰도록** 한 곳에 모았습니다.

---

## 6. 사용한 디자인 패턴

| 패턴 | 적용 위치 | 이유 |
|---|---|---|
| **플러그인 / 레지스트리** | `core/diagrams/registry.ts`의 `DiagramPlugin` 목록 | 다이어그램 종류 추가 = 모델 정의 + 플러그인 등록. 헤더 키워드로 플러그인을 고릅니다. |
| **판별 유니온 (Discriminated Union)** | `DiagramModel = ClassModel \| SequenceModel \| UsecaseModel` (`kind` 필드) | 종류별 분기를 타입 검사기가 강제합니다. |
| **전략 (Strategy)** | `core/layout/engine.ts`의 `LayoutEngine` (dagre / ELK), `export/exporter.ts`의 형식별 exporter | 실행 중 교체 가능. 엔진은 좌표만 돌려주고 경로·라벨은 공통 코드가 계산합니다. |
| **함수형 코어 / 명령형 셸** | `core/`는 순수 함수, 부수 효과는 `store/`·`ui/`에만 | 핵심 로직을 DOM 없이 단위 테스트할 수 있습니다. |
| **단일 진실 공급원 + 파생 상태** | 문서는 `{source, layout}`, 나머지는 `derivedSlice`에서 재계산 | 상태 불일치를 구조적으로 막습니다. |
| **단방향 데이터 흐름 / 제어 컴포넌트** | React Flow 변경 이벤트 → 스토어 명령 → 다시 렌더 | 노드 상태를 React Flow가 따로 들고 있지 않습니다. |
| **메멘토 (Memento)** | Undo 스택에 불변 문서 스냅샷 참조 저장 | 되돌리기가 "이전 객체로 교체" 한 줄입니다. |
| **커맨드 결과 객체** | `EditResult` (편집 목록 + 이름 변경 정보 또는 거부 사유) | 계산과 적용을 분리해 편집 계산을 테스트할 수 있습니다. |
| **슬라이스 패턴** | zustand 스토어를 document / derived / ui 세 조각으로 합성 | 책임별로 파일을 나눕니다. |
| **브리지 / 어댑터** | `store/editorBridge.ts` (스토어 → Monaco), `view/toFlowElements.ts` (도메인 모델 → React Flow) | 스토어가 Monaco·React Flow를 직접 알지 않게 합니다. |
| **지연 로딩 (Lazy Loading)** | ELK·mermaid를 `import()`로 필요할 때만 로드 | 초기 로딩을 가볍게 유지합니다. |
| **메모이제이션** | `toFlowElements`의 `WeakMap` 노드 캐시, `useMemo` | 드래그 중 불필요한 재렌더를 방지합니다. |
| **에러 바운더리** | `ui/ErrorBoundary.tsx` (편집기 / 코드 창 / 캔버스 영역별) | 한 영역의 오류가 앱 전체를 멈추지 않게 합니다. |
| **방어적 입력 검증** | `schema.ts`의 `parseLayout`, `serializer.ts`의 `deserialize` | 외부 파일을 신뢰하지 않습니다. 값 보정, 경고 수집, 예외 없음. |

---

## 7. 핵심 알고리즘

| 알고리즘 | 위치 | 내용 |
|---|---|---|
| **직교 경로 탐색 (A\*)** | `core/layout/orthoRouter.ts` | 도형 가장자리 좌표로 만든 희소 격자 위에서 A\*를 실행합니다. 비용 = 길이 + 꺾임 벌점 + 다른 간선이 이미 쓴 통로 벌점입니다. 단순 ㄱ/ㄹ자 경로가 도형을 뚫을 때만 사용합니다. |
| **끝점 슬롯 분배** | `core/layout/routing.ts` | 흐름 방향(TB/LR 등)에 맞춰 나가고 들어오는 변을 고르고, 한 변에 붙는 모든 끝점을 상대 위치 순으로 균등 배치해 겹치지 않게 합니다. 짧은 간선부터 확정합니다. |
| **라벨 배치 (탐욕적 점수화)** | `core/layout/labels.ts` | 모든 간선 라벨의 후보 위치마다 도형·다른 라벨·선분과의 겹침을 점수로 매겨 가장 좋은 곳을 고릅니다. |
| **계층 배치** | `core/layout/dagreEngine.ts` | dagre(network-simplex)로 배치한 뒤 같은 계층 도형의 윗변을 맞춥니다(Mermaid와 같은 모양). 그룹은 dagre cluster로 처리합니다. |
| **이름 변경 감지** | `core/document/reconcile.ts`의 `edgeSignature` | 도형의 연결 관계를 "관계 종류:방향:상대" 문자열로 만들어 비교합니다. |
| **내용 기반 안정 키** | `class/parser.ts`, `sequence/keys.ts` | 멤버·메시지에 순서 대신 내용 기반 키를 주고, 같은 내용이 반복되면 `#2`, `#3`을 붙입니다. |
| **텍스트 편집 적용** | `core/text.ts`의 `applyTextEdits` | 편집을 뒤에서부터 적용해 앞쪽 오프셋이 밀리지 않게 하고, 겹치는 편집은 버그로 보고 예외를 던집니다. |

---

## 8. 폴더 구조

```
src/
├─ main.tsx, App.tsx, index.css
├─ core/                       # 순수 로직
│  ├─ types.ts, text.ts, theme.ts
│  ├─ diagrams/                # 다이어그램 종류별 파서·모델·편집
│  │  ├─ registry.ts, editResult.ts, groups.ts, groupEdits.ts, measureShapes.ts, mermaidValidate.ts
│  │  ├─ class/   usecase/   sequence/
│  ├─ document/                # 문서 스키마, reconcile, 스타일 키, 파일 직렬화
│  └─ layout/                  # 레이아웃 엔진, 경로, 라벨, 크기 측정
├─ store/                      # zustand 스토어 (document / derived / ui 슬라이스)
├─ view/                       # 모델 → React Flow 요소 변환
├─ ui/                         # React 컴포넌트 (편집기 셸, 툴바, 코드 창, 캔버스)
│  ├─ editor/   canvas/   canvas/sequence/
└─ export/                     # 이미지·파일 내보내기, DPI 기록
```

파일별 상세 역할은 [PROGRESS.md 2절](PROGRESS.md)을 참고하세요.

---

## 9. 테스트

### 단위 테스트

```bash
npm run test
```

- Vitest, Node 환경에서 `src/**/*.test.ts`를 실행합니다(현재 12개 파일, 132개 테스트).
- 대상: 세 파서와 편집 함수, reconcile(이름 변경 승계·고립 노드 정책), 경로·라벨, 스토어(커밋 순서, Undo, 오류 시 직전 상태 유지, 좌표 불변, 종류 전환), 저장·불러오기 왕복, 그룹 생성·해제 들여쓰기, DPI 기록.
- `src/view/perf.test.ts`는 클래스 30개·40개의 파싱 → reconcile → toFlowElements 시간을 측정해 출력하고(`[perf]` 로그, 1초 상한 단언), 드래그 프레임 비용도 함께 보여줍니다. 수치를 보려면 `npx vitest run src/view/perf.test.ts --reporter=verbose`.

### E2E (브라우저 시나리오)

실제 Chromium으로 앱을 조작해 클래스·유스케이스·시퀀스 각각에서 코드 입력 → 렌더링, 도형 드래그, Undo/Redo, 코드 추가 시 좌표 불변, 이름 변경 시 좌표 승계, 문법 오류 시 직전 그림 유지, 그룹 만들기(Ctrl+드래그), PNG 300dpi 내보내기, 프로젝트 저장·불러오기를 확인합니다. 단계별 스크린샷은 `docs/screenshots/`에 저장됩니다.

```bash
npm install
npx playwright install chromium   # 최초 1회: 브라우저 내려받기
npm run dev                       # 터미널 1: 개발 서버 (기본 http://localhost:5173)
npm run e2e                       # 터미널 2: 시나리오 실행 (다른 주소는 E2E_URL 환경변수)
```

- 개발 서버에서만 `window.__hyuml`(스토어)이 노출되며 프로덕션 빌드에는 포함되지 않습니다. 스크립트는 이 값으로 좌표·소스를 검증합니다.
- Monaco 편집기는 CDN에서 내려받으므로 인터넷 연결이 필요합니다.
- 요구사항별 충족 여부는 [docs/REQUIREMENTS_CHECK.md](docs/REQUIREMENTS_CHECK.md)에 있습니다.

---

## 10. 기술 스택

| 분류 | 사용 |
|---|---|
| UI | React 19, TypeScript |
| 빌드 / 테스트 / 린트 | Vite 8, Vitest 5, oxlint |
| 상태 관리 | zustand 5 + immer 11 |
| 캔버스 | @xyflow/react (React Flow) 12 |
| 코드 편집기 | Monaco (@monaco-editor/react) |
| 레이아웃 | @dagrejs/dagre, elkjs (Web Worker) |
| 내보내기 | html-to-image |
| 호환성 검증 | mermaid 12 (렌더링에는 사용하지 않음) |
