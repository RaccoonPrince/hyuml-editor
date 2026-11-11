# PROGRESS

> **Git 상태**: 2026-10-14 에 `git init` 으로 새로 초기화됨. 최초 커밋 `5ffb136` (2026-10-14 09:20:08 +0900, "최초 커밋: 2026-09-27 기준 작업 상태"). 그 이전 이력은 없다. 코드의 마지막 수정 시점은 2026-09-27 이다.
> 코드 곳곳의 주석에 나오는 `명세 FR-xx / NFR-xx` 는 저장소 밖의 요구사항 명세를 가리킨다. 그 문서는 이 저장소에 없고 내용은 **불명**이다.

> **이 문서의 유지 규칙 (Claude Code 포함 모든 작업자)**: 코드를 수정할 때마다 이 파일을 같이 갱신한다. ① 9절 "변경 이력"에 날짜·무엇을·왜·어느 파일을 추가, ② 구조/규칙이 바뀌면 1~5절 수정, ③ 6~8절(현재 상태·미완성·다음 후보)을 최신으로 유지, ④ 확인 못 한 것은 추측하지 말고 "불명"으로 표기. 이 파일만 읽고도 전체를 이해할 수 있어야 한다.

---

## 0. 실행 환경

| 항목 | 내용 |
|---|---|
| 패키지 매니저 | **npm** (`package-lock.json` 존재, `pnpm-lock.yaml`/`yarn.lock` 없음) |
| Node 요구사항 | `package.json` 에 `engines` 필드 없음, `.nvmrc` 없음 → **공식 요구 버전 불명**. 마지막 확인은 Node v24.21.0 / npm 11.19.0 (이 환경). Vite 8·Vitest 5 를 쓰므로 최신 LTS 이상을 권장하지만 최소 버전은 확인하지 못했다 |
| 모듈 방식 | `"type": "module"` (ESM), TypeScript `~6.0.2` |
| 번들러 / 테스트 | Vite `^8.3.0` (`@vitejs/plugin-react`), Vitest `^5.0.1` (`environment: 'node'`, `include: src/**/*.test.ts`) |
| 린터 | oxlint `^1.81.0` (설정 `.oxlintrc.json`) |

**스크립트 (package.json 그대로)**

| 이름 | 명령어 | 용도 |
|---|---|---|
| `dev` | `vite` | 개발 서버 |
| `build` | `tsc -b && vite build` | 타입 검사 후 `dist/` 빌드 |
| `preview` | `vite preview` | 빌드 결과 미리보기 |
| `test` | `vitest run` | 테스트 1회 실행 |
| `test:watch` | `vitest` | 테스트 감시 모드 |
| `typecheck` | `tsc -b` | 타입 검사만 |
| `lint` | `oxlint` | 린트 |

**처음 받았을 때 (복사-붙여넣기 순서)**

```bash
npm install          # 의존성 설치 (package-lock.json 기준)
npm run typecheck    # 타입 검사
npm run test         # 테스트 (현재 113개 통과)
npm run lint         # 린트
npm run dev          # 개발 서버 → 터미널에 표시된 주소를 브라우저로 열기 (기본 포트는 확인 안 함, 불명)
npm run build        # (선택) 프로덕션 빌드
```

**핵심 의존성 (package.json `dependencies`, 범위 표기 그대로)**

| 패키지 | 버전 | 역할 |
|---|---|---|
| react / react-dom | `^19.2.8` | UI |
| zustand | `^5.0.15` | 스토어 (`zustand/middleware/immer` 사용) |
| immer | `^11.1.18` | 불변 갱신. Undo 스냅샷을 참조로 저장할 수 있는 근거 |
| @xyflow/react | `^12.11.6` | 캔버스(React Flow) |
| @monaco-editor/react | `^4.7.0` | 코드 창 |
| @dagrejs/dagre | `^3.1.1` | 기본 레이아웃 엔진 |
| elkjs | `^0.12.0` | 대체 레이아웃 엔진 (Web Worker, 지연 로드) |
| html-to-image | `^1.11.13` | PNG/JPEG/SVG 내보내기 |
| mermaid | `^12.0.0` | **호환성 경고 검증 전용** (렌더링에는 쓰지 않음) |

> 버전은 `^` 범위이므로 실제 설치 버전은 `package-lock.json` 이 결정한다(여기서는 조회하지 않음 → 정확한 설치 버전 불명).

---

## 1. 아키텍처 개요

핵심 아이디어: **문서 = `{ source(Mermaid 코드), layout(좌표·스타일) }` 두 가지뿐**이고, 그 외(파싱된 모델, 간선 경로, 라벨 위치, React Flow 노드)는 전부 여기서 다시 계산되는 파생값이다. 코드는 "무엇이 있는가(위상)", layout 은 "어디에 어떻게 보이는가"를 맡는다. 두 개를 섞지 않기 때문에 코드를 고쳐도 위치가 보존된다.

```
[Monaco 코드 창] --setSource--> doc.source ──(300ms 디바운스 / ▶적용)──> commitNow()  (derivedSlice.ts)
                                                                          │
   parseDiagram (registry.ts: 헤더 보고 플러그인 선택 → class|sequence|usecase parser)
                                                                          │ 오류 있으면 중단, 마지막 정상 model 유지
                                                                          ▼
                  ┌─ class·usecase: reconcileLayout (reconcile.ts) → 신규 노드만 레이아웃 엔진(dagre/elk)
                  │                  → placeAddedNodes 로 기존 좌표계에 맞춤
                  └─ sequence     : reconcileSequence (sequence/reconcile.ts) – 동기, 엔진 없음
                                                                          ▼
                              store: model + doc.layout.nodes (+ trash)
                                                                          ▼
   FlowCanvas.tsx → toFlowElements (view/)  : 도형 노드, 그룹 상자, 직교 경로(routing.ts), 라벨 배치(labels.ts)
                                                                          ▼
   React Flow 가 UmlClassNode / UsecaseNode / SeqParticipantNode / SeqBody / GroupNode / UmlEdge 렌더

역방향 (캔버스 → 코드):  노드·라벨·멤버 편집 → store.renameShape/editMember/… → core/diagrams/*/edits.ts 가
   TextEdit[] 계산 → store.applyEdit → doc.source 갱신 + layout 키 이전 + Monaco 에 최소 편집 적용 → commitNow()
역방향 (캔버스 → layout): 드래그·리사이즈·꺾임점·스타일 → store.moveNodes/resizeNode/setEdgeWaypoints/… (코드는 안 건드림)
```

`src/` 는 3층으로 나뉜다. 이 분리가 "왜 이렇게 나눴는가"의 답이다.
- **`core/`** : React/zustand 를 모르는 순수 함수. 파서, 편집 계산, reconcile, 라우팅, 레이아웃. 테스트가 쉽다(vitest 환경이 `node`).
- **`store/`** : zustand + immer. 상태 3분할 — `documentSlice`(저장·Undo 대상 `doc`과 모든 명령), `derivedSlice`(파생값: model, diagnostics, trash, 파싱 파이프라인), `uiSlice`(다크모드, 선택, 토스트 등 Undo 제외).
- **`view/` + `ui/`** : 모델·layout → React Flow 요소 변환(`view/`)과 렌더링(`ui/`). 컴포넌트는 로직 없이 store 명령만 호출한다.

## 2. 파일별 역할 사전

### 실제 디렉토리 트리 (`src/`, 아래 표와 대조용)

```
src/
├─ main.tsx, App.tsx, index.css
├─ core/                         # 순수 로직 (React/zustand 모름)
│  ├─ types.ts, text.ts, theme.ts
│  ├─ diagrams/
│  │  ├─ registry.ts, editResult.ts, groups.ts, groupEdits.ts
│  │  ├─ measureShapes.ts, mermaidValidate.ts, groups.test.ts
│  │  ├─ class/      model, parser, notation, edits, index (+ parser/edits 테스트)
│  │  ├─ usecase/    model, parser, edits, measure, index (+ usecase.test.ts)
│  │  └─ sequence/   model, parser, edits, keys, layout, reconcile, measure, boxes, index (+ sequence.test.ts)
│  ├─ document/      schema, reconcile, keys, serializer (+ document.test.ts)
│  └─ layout/        engine, dagreEngine, elkEngine, routing, orthoRouter, labels, measure (+ layout/router 테스트)
├─ store/            useDiagramStore, types, documentSlice, derivedSlice, uiSlice, editorBridge (+ store.test.ts)
├─ view/             toFlowElements, toSequenceElements, flowTypes
├─ ui/
│  ├─ DiagramEditor.tsx, Toolbar.tsx, Toast.tsx, ErrorBoundary.tsx
│  ├─ editor/        CodeEditor.tsx
│  └─ canvas/        FlowCanvas, UmlEdge, UmlClassNode, UsecaseNode, GroupNode, EditableText, FormatToolbar
│     └─ sequence/   SeqBody, SeqParticipantNode, SeqLabel, ParticipantShape
└─ export/           exporter.ts, dpi.ts (+ dpi.test.ts)
```

### 진입 / 셸
| 파일 | 역할 |
|---|---|
| `main.tsx`, `App.tsx` | React 마운트, 바깥 프레임, 최상위 ErrorBoundary |
| `ui/DiagramEditor.tsx` | 레이아웃 셸만 담당: 코드 창 \| 스플리터 \| 캔버스. 마운트 시 `commitNow()` 로 기본 소스를 첫 파싱. 로직 없음 |
| `ui/Toolbar.tsx` | 적용/Undo/자동정렬/엔진 선택/그룹 만들기/글꼴/내보내기·프로젝트 저장·열기/일괄 스타일/다크모드 |
| `ui/editor/CodeEditor.tsx` | Monaco. 입력 → `setSource`. 진단을 Monaco 마커와 하단 목록으로 표시. `registerEditorBridge` 로 store→Monaco 최소 편집 통로를 연다 |
| `ui/ErrorBoundary.tsx`, `ui/Toast.tsx` | 영역별 오류 격리, 알림 표시 |

### core/ (순수 로직)
| 파일 | 역할 |
|---|---|
| `core/types.ts` | `NodeId`, `Point`, `Rect`, `SourceRange`, `TextEdit`, `Diagnostic`, `Direction`, `Side` |
| `core/diagrams/registry.ts` | **다이어그램 종류의 분기점.** `DiagramModel = ClassModel \| SequenceModel \| UsecaseModel`, 플러그인 목록, 헤더로 플러그인 선택(`resolvePlugin`), `parseDiagram`(throw 하지 않음), `toLayoutGraph`, `shapeIds`, `connectorIds`. 새 다이어그램 추가 = 모델 추가 + 플러그인 등록 |
| `core/diagrams/class/` | `parser`(소스 범위를 모델에 기록), `model`, `notation`(화살표·마커 모양), `edits`(제목·멤버·관계 라벨 편집 → TextEdit), `index`(플러그인 + 레이아웃 그래프 변환) |
| `core/diagrams/usecase/` | 액터/유스케이스 파서·모델·편집·크기 측정 |
| `core/diagrams/sequence/` | `parser`, `model`, `edits`, `keys`(문장 키), `layout`(세로 배치), `reconcile`(참여자 가로 배치), `measure`, `boxes`(box 그룹) |
| `core/diagrams/editResult.ts` | 모든 캔버스→코드 편집의 공통 결과 타입 `EditResult` (`edits` + `renamedNode/Member/Edge` + `keyMigration`). **layout 키를 어떻게 옮길지 알려 주는 계약** |
| `core/diagrams/groups.ts`, `groupEdits.ts` | 그룹 = class `namespace` / sequence `box` / usecase `systemBoundary`. 상자 좌표는 저장하지 않고 구성원에서 계산(`groupBounds`) |
| `core/diagrams/measureShapes.ts` | 종류별 "내용이 잘리지 않는 최소 크기" 계산을 한 곳에서 분기 |
| `core/diagrams/mermaidValidate.ts` | 실제 mermaid 라이브러리를 **호환성 경고용으로만** 동적 import 해서 사용. 렌더링·파싱 기준이 아님 |
| `core/document/schema.ts` | `DiagramDocument`/`LayoutState`(version 3) 타입, 기본 소스, 값 정규화, `parseLayout`(v1·v2→v3 마이그레이션, 절대 throw 안 함). **필드 요약은 core/ 표 바로 아래 "핵심 타입 요약"** |
| `core/document/reconcile.ts` | **프로젝트의 핵심.** 코드(위상)가 바뀔 때 기존 layout 을 어떻게 보존할지 결정하는 순수 함수. 아래 3·4절 참조 |
| `core/document/keys.ts` | 스타일 키 규칙(`node:<id>/title` 등)과, 이름이 바뀔 때 좌표·스타일·꺾임점 키를 옮기는 `migrate*` 함수들 |
| `core/document/serializer.ts` | 프로젝트 파일 형식: `%%% graph` + 코드 + `%%% layout` + JSON. 레거시 `{code, layout}` JSON 도 읽음 |
| `core/layout/engine.ts` | 레이아웃 엔진 교체 지점. dagre/elk 를 지연 로드. 엔진은 **노드 좌상단 좌표만** 반환 |
| `core/layout/dagreEngine.ts`, `elkEngine.ts` | 엔진 구현(ELK 는 Web Worker). dagre 쪽에 같은 rank 윗변 정렬(`alignRanks`) |
| `core/layout/routing.ts` | 간선 경로 계산. 변 선택(`chooseSides`), 변마다 끝점 슬롯 균등 분배, 직교 경로, 셀프 루프, 사용자 꺾임점 적용 |
| `core/layout/orthoRouter.ts` | 도형을 피하는 직교 경로 A\*(희소 격자). 다른 간선이 쓴 통로에 벌점(`ChannelUsage`) |
| `core/layout/labels.ts` | 모든 간선의 중앙·양끝 라벨을 한 번에 탐욕적으로 배치(노드·다른 라벨·선분과 겹침 점수화) |
| `core/layout/measure.ts`, `core/text.ts`, `core/theme.ts` | 글자 폭/노드 크기 측정, 텍스트 편집 적용(`applyTextEdits`), 색·타이포 상수 |

#### 핵심 타입 요약 (소스에서 그대로 옮김)

`core/types.ts`
```ts
type NodeId = string;  type EdgeId = string;
interface Point { x: number; y: number }
interface Rect { x: number; y: number; w: number; h: number }
interface SourceRange { start: number; end: number }          // 소스 문자열 오프셋 [start, end)
interface TextEdit { start: number; end: number; text: string } // 모든 캔버스→코드 경로가 만드는 유일한 편집 단위
type Side = 'top'|'right'|'bottom'|'left';  type Direction = 'TB'|'BT'|'LR'|'RL';
interface Diagnostic { message: string; range: SourceRange; severity: 'error'|'warning'|'info'; source?: 'parser'|'mermaid'|'app' }
```

`core/document/schema.ts` — 저장·Undo 대상은 `DiagramDocument` 뿐
```ts
interface DiagramDocument { source: string; layout: LayoutState }
interface LayoutState {
  version: 3;
  nodes: Record<NodeId, NodeLayout>;
  canvas: { fontSizePt: number /*8~24*/; hideEmptyCompartments: boolean; engine: 'dagre'|'elk' };
  textStyles: Record<string, TextStyle>;     // 키 규칙은 keys.ts
  edgeStyles: Record<string, EdgeStyle>;     // 키 = edgeId(그래프형) 또는 메시지/프래그먼트 키(시퀀스)
  edgeWaypoints: Record<EdgeId, Point[]>;    // 사용자 꺾임점, 없으면 자동 경로 (최대 20개)
}
interface NodeLayout { x: number; y: number; w: number; h: number;
  autoSize?: boolean /*true(기본)=내용에 맞춤, 리사이즈하면 false*/; fill?: string }
interface TextStyle { fontSize?: number /*pt*/; color?: string; fill?: string; isCustomized?: boolean }
interface EdgeStyle { stroke?: string; strokeWidth?: number; isCustomized?: boolean }
// LIMITS: fontSize 8~24, strokeWidth 1~6, nodeSize 40~5000, coordinate ±1,000,000
```

`core/diagrams/registry.ts` + 종류별 `model.ts`
```ts
type DiagramModel = ClassModel | SequenceModel | UsecaseModel;          // kind 로 판별
type GraphDiagramModel = ClassModel | UsecaseModel;                      // isGraphModel()
ClassModel    { kind:'class';   direction; nodes: ClassNodeModel[]; edges: RelationEdge[]; groups: DiagramGroup[] }
UsecaseModel  { kind:'usecase'; direction; nodes: UsecaseNode[];    edges: UsecaseEdge[];  groups: DiagramGroup[] }
SequenceModel { kind:'sequence'; participants: Participant[]; statements: SeqStatement[]; autonumber: boolean; title?: string; groups: DiagramGroup[] }
ClassNodeModel{ id; label; generic?; stereotype?; attributes: ClassMember[]; methods: ClassMember[]; refs: SourceRange[]; labelRange?; declIdEnd? }
UsecaseNode   { id; label; type:'actor'|'usecase'; shape:'ellipse'|'rect'; stereotype?; refs; labelRange?; declIdEnd?; quoted: boolean }
Participant   { id; label; type:'participant'|'actor'; refs; aliasRange?; declIdEnd?; declLine?: {range; text} }
RelationEdge  { id; source; target; ends:{source:EndKind; target:EndKind}; line:'solid'|'dotted'; relationType: UmlRelationType;
                parentEnd?; sourceLabel?; targetLabel?; label?; stereotype?; range; labelRange?; labelClauseRange? }
UsecaseEdge   = RelationEdge + { arrowRange; leftToken; rightToken; semantic: boolean }
SeqStatement  = message | note | activate|deactivate|destroy | fragmentStart | fragmentSection | fragmentEnd   // 문장 키는 sequence/keys.ts
DiagramGroup  { id; label; members: NodeId[]; labelRange?; headerLineRange; endLineRange?; color? }
// 모든 모델이 SourceRange 를 들고 있는 이유: 캔버스 편집을 정확한 TextEdit 으로 만들기 위해서
```
`Message`/`Note`/`Fragment`/`FragmentSection` 의 전체 필드는 `core/diagrams/sequence/model.ts` 참고 (여기서는 일부만 확인 → 나머지 필드는 불명).

`core/diagrams/editResult.ts`
```ts
type EditResult =
  | { ok: true; edits: TextEdit[];
      renamedNode?: {from: NodeId; to: NodeId};
      renamedMember?: {nodeId: NodeId; from: string; to: string};
      renamedEdge?: {from: EdgeId; to: EdgeId};
      keyMigration?: Record<string, string> }   // 시퀀스 문장 키 old→new
  | { ok: false; reason: string };
```

### store/
| 파일 | 역할 |
|---|---|
| `useDiagramStore.ts` | 세 슬라이스를 합쳐 `create()(immer(...))` |
| `types.ts` | 슬라이스별 상태·명령 타입의 목록. 어떤 명령이 있는지 보려면 여기부터 |
| `documentSlice.ts` | `doc`, Undo/Redo 스택(`past/future`, 같은 key 1.2초 내 연속 입력은 한 단위로 병합, 최대 100), 모든 편집 명령. `applyEdit` 가 캔버스→코드 반영의 단일 통로 |
| `derivedSlice.ts` | `commitNow` 파싱 파이프라인, 종류 전환 보관(`kindStash`), 휴지통(`trash`), 크기 재맞춤(`refitNodes`), 엔진 실행·폴백(`runLayoutEngine`) |
| `uiSlice.ts` | 다크모드, 코드 창 폭/표시, 선택, 토스트 |
| `editorBridge.ts` | store → Monaco 로 **최소 범위 편집**을 전달하는 통로(커서·Monaco Undo 보존) |

### view/ 와 ui/canvas/
| 파일 | 역할 |
|---|---|
| `view/toFlowElements.ts` | model + layout → React Flow nodes/edges. class·usecase 공통(`toGraphElements`)과 sequence 로 분기. 간선 경로·라벨 위치를 여기서 한 번 계산. 노드 객체 `WeakMap` 캐시로 드래그 중 불필요한 리렌더 방지 |
| `view/toSequenceElements.ts` | 시퀀스용 변환(참여자 노드 + 본문 `seqBody` 하나) |
| `view/flowTypes.ts` | React Flow 노드/간선 데이터 타입, `GROUP_NODE_PREFIX`, `SEQ_BODY_ID` |
| `ui/canvas/FlowCanvas.tsx` | React Flow 설정. **store 가 유일한 노드 상태**이며, 변경 이벤트를 `moveNodes/resizeNode/setSelection` 명령으로 번역만 한다. 그룹 드래그 = 구성원 전체 이동, 휠 줌, 캔버스 Undo 단축키, 화면 맞춤 |
| `ui/canvas/UmlEdge.tsx` | 연결선 렌더 + **꺾임점/라벨 상호작용**(7절 참조). 이름만 보면 "그리기"지만 드래그 상태 머신이 들어 있음 |
| `ui/canvas/UmlClassNode.tsx`, `UsecaseNode.tsx`, `GroupNode.tsx` | 도형 렌더 + 제목/멤버 인라인 편집(`EditableText`) + 리사이즈 + 배경색 |
| `ui/canvas/sequence/*` | `SeqParticipantNode`(머리 줄 참여자), `SeqBody`(생명선·메시지·노트·프래그먼트를 한 노드에서 그림), `SeqLabel`, `ParticipantShape` |
| `ui/canvas/EditableText.tsx` | Enter/blur=확정, Esc=취소. 편집 중이 아니면 항상 외부 값 표시 |
| `ui/canvas/FormatToolbar.tsx` | 라벨 포커스 시 뜨는 글꼴 크기·색·선 굵기 도구 |
| `export/exporter.ts`, `export/dpi.ts` | html-to-image 로 PNG/JPEG/SVG, 300dpi 메타데이터(pHYs/JFIF) 삽입, .mmd·프로젝트 저장 |

### 스타일링

- **방식**: 인라인 `style={{…}}` 객체가 거의 전부다. CSS 모듈·Tailwind·styled-components 는 쓰지 않는다(`package.json` 에 해당 의존성 없음).
- **CSS 파일**: 전역 리셋용 `src/index.css` 하나(`box-sizing`, `html/body/#root` 100% 크기·`overflow:hidden`)와 `FlowCanvas.tsx` 가 가져오는 `@xyflow/react/dist/style.css`. 그 밖의 `.css` 는 없다. `hy-no-export` 는 CSS 규칙이 아니라 "내보내기에서 제외할 요소" 표시용 클래스 이름(`exporter.ts` 의 filter 가 사용).
- **다크 모드**: `uiSlice.isDarkMode` 한 값이 기준이다. 색은 `core/theme.ts` 의 `THEMES.light/dark` → `themeOf(isDark)` 로 얻어 컴포넌트와 `toFlowElements` 에 `theme` 으로 전달한다(CSS 변수·`prefers-color-scheme` 는 쓰지 않음). React Flow 는 `colorMode` prop, Monaco 는 `theme` prop(`vs-dark`/`light`)으로 따로 맞춘다. 이미지 내보내기는 기본적으로 밝은 테마로 잠시 전환해 캡처한다(`Toolbar.runExport`).
- 글꼴·간격 상수는 `theme.ts` 의 `TYPO`(노드 내부), `SEQ`(시퀀스 치수).

## 3. 핵심 설계 원칙 (깨지기 쉬운 규칙)

1. **코드 편집 시 기존 노드 좌표는 0px 변동. 신규 노드만 배치한다.**
   `reconcileLayout()` 은 기존 id 의 layout 을 그대로 두고 `added` 로 새 노드만 반환한다. 엔진은 전체를 계산하지만 `placeAddedNodes()` 가 신규 노드 좌표만 가져와, 연결된 기존 노드를 기준점(anchor)으로 평행이동하고 겹치면 밀어낸다.
2. **`autoSize` 노드는 크기만 갱신하고 좌표는 절대 바꾸지 않는다.** `refitNodes`, `fitSize` 모두 `x,y` 를 건드리지 않는다. 수동 크기(`autoSize:false`)는 잘리지 않을 만큼만 늘리고 줄이지 않는다.
3. **휴지통(trash)**: 타이핑 중 이름이 잠깐 깨져 노드가 사라졌다 돌아오면 좌표를 복원한다(최대 200개).
4. **오류가 있으면 마지막 정상 모델을 유지한다.** `class A {` 만 쳐도 그래프가 무너지지 않는다.
5. **파서는 소스 범위(`SourceRange`)를 모델에 기록하고, 캔버스→코드 편집은 그 범위만 교체한다.** 같은 이름이 주석·타입·라벨에 있어도 건드리지 않는다. 모든 캔버스→코드 경로는 `TextEdit` 만 만든다.
6. **스타일 키는 순서가 아니라 의미 기반**(`node:<id>/title`, `edge:<id>/label`, 시퀀스는 `msg:…`). 엣지 id 는 `src|type|tgt[|label][#n]` 이다. 이름·라벨이 바뀌면 `EditResult.renamed*`/`keyMigration` 으로 layout 키를 옮겨야 한다.
7. **편집 계산은 반드시 최신 소스로 파싱된 모델 위에서** 한다(`modelForEdit`). 디바운스 대기 중이면 즉시 재파싱, 오류면 편집 거부.
8. **Undo 단위는 `{source, layout}` 문서 전체의 스냅샷 참조**(immer 불변이라 참조 저장). Undo 시 Monaco 에는 전체 교체 편집 1개를 적용한다. 드래그는 `beginInteraction/endInteraction` 으로 감싸고, 움직이지 않았으면 빈 Undo 항목을 제거한다.
9. **다이어그램 종류를 바꾸면 좌표를 종류별로 따로 보관**(`kindStash`)해서 다른 종류의 같은 이름 도형 좌표를 물려받지 않게 한다.
10. **자동 정렬은 사용자가 누를 때만** 전체를 재배치하고, 그때 `edgeWaypoints` 도 비운다. 사용자가 직접 옮긴 위치를 자동으로 밀어내지 않는다.
11. **시퀀스 참여자는 y 고정**(`SEQ.top`), 가로로만 이동. 메시지·노트·프래그먼트는 문장 순서로 쌓여 좌표를 저장하지 않는다.
12. **비동기 커밋 순서**: `parseSeq` 로 늦게 끝난 오래된 커밋 결과를 버리고, 엔진 대기 후 적용 시점에 `reconcileLayout` 을 한 번 더 돌려 그사이의 변경을 잃지 않는다.

> ⚠️ **경고 (이 규칙을 모르고 고치면 깨지는 곳)**
> - `reconcile.ts` 의 1:1 리네임 승계는 휴리스틱이다: 사라진 노드 1개 + 새 노드 1개 + **간선 이웃 서명이 동일**할 때만 좌표를 승계한다(`edgeSignature`). 간선이 없는 고립 노드는 서명이 항상 같아서(빈 문자열), 노드 하나를 지우고 다른 이름 하나를 추가하면 리네임으로 오인될 수 있다. 의도된 동작인지는 **불명**.
> - 캔버스 리네임 경로에서는 `applyEdit` 가 `migrateNodeRename` 을 직접 호출하고, 코드 창 리네임 경로에서는 `derivedSlice.apply` 가 호출한다. 이름·키 규칙을 바꾸면 **두 경로와 `keys.ts` 를 같이** 고쳐야 한다.
> - `edits.ts` 의 `edgeBaseId` 는 `parser.ts` 의 edge id 규칙과 **복제**되어 있다(주석에 명시). 한쪽만 바꾸면 라벨 편집 후 스타일·꺾임점이 사라진다.
> - `placeAddedNodes` 의 겹침 회피는 최대 50회 오른쪽으로 밀어내는 단순 방식이다.
> - `fitSize`/`refitNodes` 에 좌표 변경을 넣으면 "0px 변동" 원칙이 깨진다.

## 4. 핵심 흐름 상세

**(a) 코드 입력 → 화면**: `CodeEditor.onChange` → `setSource`(Undo key `typing`, 1.2초 병합) → `scheduleCommit`(300ms) → `commitNow` → `parseDiagram` → (오류면 중단) → `switchKindIfNeeded` → class·usecase: `commitGraph` / sequence: `commitSequence` → `apply` 가 `doc.layout.nodes`, `trash`, `model`, `diagnostics` 를 set → `FlowCanvas` 의 `useMemo(toFlowElements)` 가 재계산 → React Flow 렌더. 그 후 비동기로 mermaid 호환성 경고를 diagnostics 에 추가.

**(b) 노드 이름을 바꿨을 때 위치가 유지되는 메커니즘** — 두 경로가 있다.
- *캔버스에서 이름 변경*: `UmlClassNode`(제목 `EditableText`) → `store.renameShape` (`documentSlice.ts`) → `editClassTitle`(`class/edits.ts`)이 모든 참조 위치의 `TextEdit` 과 `renamedNode:{from,to}` 반환 → `applyEdit` 가 소스 갱신 후 `migrateNodeRename`(`document/keys.ts`)으로 **layout.nodes·textStyles·edgeStyles·edgeWaypoints 의 키를 from→to 로 이동** → Monaco 에 최소 편집 → `commitNow`. 이미 키가 옮겨져 있어 reconcile 은 그냥 "기존 노드"로 본다.
- *코드 창에서 이름 변경*: `commitNow` → `reconcileLayout()`(`document/reconcile.ts`)이 `removed=1, added=1` 이고 `edgeSignature(prevModel,from) === edgeSignature(model,to)` 이면 `nextNodes[to] = nextTrash[from]` 로 좌표 승계 + `renamed` 반환 → `derivedSlice.apply` 가 `migrateNodeRename` 으로 스타일 키도 이전. 시퀀스는 `sequence/reconcile.ts` 의 유사 로직(참여자 1개 교체).

**(c) 연결선 꺾임점·라벨 편집의 상태 관리**
- 꺾임점의 **영속 상태**는 store 의 `doc.layout.edgeWaypoints[edgeId]`(최대 20개). `UmlEdge` 는 `setEdgeWaypoints` 로만 쓴다.
- 드래그 중 임시 상태는 `UmlEdge` 내부 `useRef(dragging)` + `useState(hovered/isDragging/adding/focused)`. 드래그 시작에 `beginInteraction`(Undo 스냅샷), 이동마다 5px 스냅 후 `setEdgeWaypoints`, 끝에 `endInteraction`. 선분 중앙 손잡이를 끌면 `distanceAlong` 으로 경유점 순서를 정해 새 꺾임점 삽입. 더블클릭=삭제, ↺=`setEdgeWaypoints(id,null)` 로 자동 경로 복귀.
- 경로 자체(`points`)는 `toFlowElements` 의 `computeRoutes(…, {waypoints})` 가 계산해 `edge.data` 로 내려준다. `UmlEdge` 는 계산하지 않는다.
- **라벨 편집**: `EditableText` 가 초안을 로컬 state 로 들고 있다가 blur/Enter 때 `editEdgeLabel` → `class/edits.ts`(`editEdgeLabel`) 또는 usecase 버전 → `applyEdit`(`renamedEdge` 로 스타일 키 이전). 라벨 서식은 `FormatToolbar` → `updateTextStyle`/`updateEdgeStyle`. `«include»` 같은 고정 스테레오타입 라벨(`semantic`)은 편집 불가(`labelEditable`).

## 5. 세 다이어그램 타입의 분기

| | class | usecase | sequence |
|---|---|---|---|
| 공통 | 플러그인 인터페이스(`registry.ts`), `EditResult`, 그룹, 스타일 키, Undo, 내보내기 | 〃 | 〃 |
| 모델 | `nodes`+`edges`(관계) | `nodes`(actor/usecase)+`edges` | `participants`+`statements`(순서형) |
| 위치 결정 | **그래프형**: 레이아웃 엔진(dagre/elk) + `reconcileLayout`/`placeAddedNodes` | 〃 (공통 `toGraphElements`) | **순서형**: 참여자 가로만 `reconcileSequence`, 세로는 `layoutSequence` 가 문장 순서로 계산 |
| 간선 | `routing.ts` 직교 경로 + `labels.ts` | 〃 | 메시지는 `SeqBody` 안에서 직접 그림 (`UmlEdge` 미사용) |
| 그룹 | namespace | systemBoundary | box |
| 스타일 키 | `node:<id>/…`, `edge:<id>/label` | 〃 | 참여자는 `node:<id>/title`, 문장은 `msg:/note:/frag:/sec:` 내용 기반 키 |
| 코드 분기 위치 | `toFlowElements`, `measureShapes`, `renameShape`, `editEdgeLabel`, `commitNow`, `autoArrange`, `moveNodes`(sequence 는 y 잠금) 의 `switch/if (kind)` | | |

분기는 대부분 `model.kind` 판별 유니온으로 처리하고, 그래프형 여부는 `isGraphModel()` 로 가른다. 새 종류를 추가하면 위 함수들의 분기를 모두 확인해야 한다.

## 5-1. 다이어그램 소스 문법 예시

아래 3개는 실제 `parseDiagram()` 으로 오류·경고 0건임을 확인한 예시다(2026-10-14). 파서가 인식하는 문법만 적었고, 여기 없는 Mermaid 문법의 지원 여부는 확인하지 않았다(불명). 인식 못 한 줄은 오류가 아니라 `인식할 수 없는 구문` **경고**가 되고 나머지는 계속 파싱된다.

**class** — 헤더 `classDiagram`
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
(테스트에서 쓰이는 것: `A : +foo() int` 한 줄 멤버, `class A["표시 이름"]`, `class A~T~`, `<<interface>> A`, `..` 점선 관계. 멤버 끝 `$`/`*` 는 static/abstract.)

**usecase** — 헤더 `usecase-beta` (기본 방향 `LR`)
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
(`actor A, B` 쉼표 선언, `actor "Guest User"` 따옴표 이름, `Report[보고서]` 사각형, `A -- 라벨 --> B`, `Child --|> Parent` 일반화, `..>:extend`.)

**sequence** — 헤더 `sequenceDiagram`
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
(화살표 `->` `-->` `->>` `-->>` `-x` `--x` `-)` `--)` `<<->>`, `alt … else … end`, `opt/par/and/critical/break/rect`, `box [색] 라벨 … end`, `autonumber`, `title`, `activate/deactivate/destroy` — 모두 파서 정규식·테스트에 존재.)

**공통**: 첫 의미 있는 줄이 헤더다(앞의 `%%` 주석·빈 줄·`---` frontmatter 는 건너뜀). 헤더가 없거나 모르는 종류면 `registry.ts` 가 오류 진단을 낸다.

## 6. 현재 상태 (2026-10-14 확인)

- `npx tsc -b` : 오류 없음.
- `npx vitest run` : **10개 파일 / 113개 테스트 전부 통과.**
- `npx oxlint` : 경고/오류 없음.
- 테스트 범위: class edits·parser, sequence, usecase, document(직렬화·스키마), groups, layout·router, store, export/dpi. vitest 환경이 `node` 이고 `include` 가 `*.test.ts` 라서 **UI 컴포넌트(.tsx) 테스트는 없다.**
- `TODO`/`FIXME` 주석 없음. 코드상 중간에 끊긴 흔적(빈 함수, 미연결 export)은 발견하지 못했다.
- 실제 브라우저에서 앱을 띄워 동작을 눈으로 확인하지는 않았다 → 화면 동작 여부는 **불명**(코드와 테스트 기준으로만 "동작해 보임").
- `README.md` 는 이번에 실제 프로젝트 설명으로 교체했다.
- 직전에 어떤 작업을 하다 멈췄는지는 **불명**(git 이력이 오늘 처음 생겼고, 미완성 코드도 없음).

## 7. 미완성 / 미확인 구간

- **`.github/modernize/code-migration/`**: 안에 `.gitignore` 한 파일뿐이고 내용은 `*` 한 줄(폴더 내용 전체 무시). 생성 시각 9월 17일. 마이그레이션 계획·로그·결과물이 하나도 없다. → **완료된 마이그레이션도, 중단된 작업의 잔해도 아니고 코드 현대화 도구가 만든 빈 작업 폴더로 판단한다.** 소스 코드와 관계가 없다. (어떤 도구가 만들었는지는 추정이고 확정은 **불명**.) 필요 없으면 삭제해도 무방하다. 지금은 `*` 규칙 때문에 폴더 내용이 git 에 올라가지 않는다는 점만 알아 두면 된다.
- **저장소 밖 명세**(FR/NFR 번호): 이 저장소에 없음, 일부 요구사항이 구현됐는지 대조 불가.
- **UI 테스트 부재**와 **실제 화면 검증 미실시**. 특히 9절의 UmlEdge 드래그 수정은 브라우저에서 직접 확인하지 못했다(코드 분석 기반).
- **성능 위험(미수정)**: `FlowCanvas` 의 `toFlowElements` 는 layout 이 바뀔 때마다(노드 드래그 매 프레임) 전체 간선 경로(A\*)·라벨 배치를 다시 계산한다. 무작위로 겹친 40노드/80간선 퍼즈에서 최악 1.4초가 걸렸다. 일반적인 크기에서는 문제없을 것으로 보이나 큰 다이어그램에서는 드래그가 끊길 수 있다.
- **퍼즈 결과(버그 없음 확인)**: 파서 3종(4000개 변형 입력, 긴 입력 포함) throw·범위 오류·느린 정규식 없음, 스토어 연산(소스 편집·종류 전환·이동·이름 변경·Undo/Redo·그룹·자동정렬·동시 커밋) 60라운드×25연산에서 "모델 노드에 layout 누락/NaN" 없음, 라우팅/라벨 300케이스 throw·NaN 없음. (임시 테스트였고 저장소에는 남기지 않았다.)
- **알려진 사소한 사항(미수정)**: 시퀀스 메시지 텍스트를 빈 값으로 편집하면 `A->>B: ` 처럼 콜론이 남는다(Mermaid 가 거부할 수 있음, 불명). 그룹 해제/생성 시 들여쓰기가 깔끔하지 않다(기능 영향 없음). 종류 전환 시 `textStyles/edgeStyles/edgeWaypoints` 는 종류별로 분리 보관하지 않아 같은 키가 다른 종류에 남을 수 있다(의도 여부 불명).
- 고립 노드 리네임 오인 가능성(3절 경고) — 의도 여부 불명.

## 8. 다음 작업 후보 (시작하지 않음)

1. **UI 동작 검증 + 최소 UI 테스트**: `npm run dev` 로 3종 다이어그램을 직접 띄워 이름 변경·꺾임점·Undo 를 확인하고, 필요하면 `@testing-library/react` 또는 Playwright 로 "이름 변경 후 위치 유지" 시나리오 1개를 회귀 테스트로 추가.
2. **리네임 승계 휴리스틱 보강**: 고립 노드(간선 없음) 1:1 교체를 리네임으로 볼지 정책을 정하고 `reconcile.ts` 에 테스트로 고정. `edgeBaseId` 중복(edits.ts ↔ parser.ts)을 한 곳으로 합치는 것도 같이 검토.
3. **정리 작업**: `.github/modernize/code-migration/` 삭제 여부 결정, `oxlint` 실행해 경고 정리, `dist/` 가 이미 `.gitignore` 에 있는지 확인(현재 있음).

## 9. 변경 이력 (최신이 위)

### 2026-11-11 — README 전면 개편 + GitHub 저장소 생성
- `README.md` 를 팀원·외부 독자용 문서로 재작성: 빠른 시작, 사용 방법(캔버스 조작표·툴바 설명), 지원 문법 예시, 아키텍처, 기능별 구현 방법, 디자인 패턴 표, 핵심 알고리즘 표, 폴더 구조, 테스트, 기술 스택. 툴바 버튼 이름은 `Toolbar.tsx` 실제 문구와 대조함.
- GitHub 원격 저장소 생성 및 push (계정 `RaccoonPrince`, 비공개). 원격 이름 `origin`, 기본 브랜치 `master`.
- 코드 변경 없음.

### 2026-11-11 — 마우스 오버 시 테두리·간선 굵게 강조
- 목적: 도형이나 연결선 위에 마우스를 올리면 어느 것을 가리키는지 잘 보이게.
- 공통 값: `core/theme.ts` 에 `TYPO.hoverExtra = 1.5`(px)와 `hoverRing(color)` 추가. **화면 표시용일 뿐 `layout`(저장·Undo)에는 아무것도 기록하지 않는다.**
- 도형: 테두리(`border`)를 직접 굵게 하면 `box-sizing: border-box` 때문에 내용이 1~2px 밀리므로, 테두리 바깥에 `box-shadow` 링을 그려 굵어 보이게 했다. 크기 측정(`measure.ts`)과 무관.
  - `UmlClassNode.tsx`(클래스), `UsecaseNode.tsx`(유스케이스 타원/사각형 = 링, 액터 막대인형 = SVG 선 2→3.5px)
  - `ParticipantShape.tsx` 에 `hovered` prop 추가, `SeqParticipantNode.tsx`(시퀀스 머리)만 넘긴다. 꼬리(`SeqBody` 하단)는 강조하지 않음.
- 간선: `UmlEdge.tsx` 는 이미 있던 `hovered`(꺾임 손잡이 표시용) 상태를 그대로 써서 보이는 선의 굵기만 `strokeWidth + hoverExtra` 로 그린다(드래그 중에도 유지).
- 시퀀스 메시지: `SeqBody` 는 본문 전체가 `pointerEvents: none` 이라 마우스를 감지할 수 없었다. 메시지마다 투명한 12px 감지용 경로(`nodrag hy-no-export`, `pointerEvents: 'stroke'`)를 추가하고 `hoveredMessage` 로컬 state 로 굵기를 바꾼다. 화살촉도 같이 굵어진다. `nopan` 은 넣지 않았으므로 메시지 위에서 드래그해도 화면 이동은 된다.
- 내보내기 영향: 이미지 내보내기 버튼을 누를 때 마우스는 툴바 위에 있으므로 강조된 상태로 찍히지 않는다(감지 경로는 `hy-no-export` 로 제외).
- 강조하지 않은 것: 그룹 상자(본문이 클릭 통과 구조), 노트·프래그먼트, 활성화 상자.
- 검증: tsc·oxlint 통과, 테스트 113개 통과. 브라우저 확인은 미실시(불명).

### 2026-11-11 — Ctrl + 드래그로 범위 선택 (그룹 기능 사용 불가 문제)
- 증상: 캔버스를 드래그하면 화면만 이동하고 범위 선택이 안 돼서, 여러 도형을 골라 그룹으로 묶을 수 없었다.
- 원인: `FlowCanvas.tsx` 에 `selectionOnDrag` 가 있었지만 React Flow 12 는 `panOnDrag` 가 기본값(true)이면 이 옵션을 무시한다(`_selectionOnDrag = selectionOnDrag && panOnDrag !== true`). 범위 선택은 기본 키 Shift 를 누를 때만 가능했고, 화면 어디에도 안내가 없었다.
- 수정: 효과 없는 `selectionOnDrag` 를 제거하고 `selectionKeyCode={['Control', 'Meta', 'Shift']}` 를 지정했다. 키를 누르는 동안 React Flow 가 `panOnDrag` 를 끄므로 화면이 움직이지 않고 선택 상자가 그려진다. 그냥 드래그는 지금처럼 화면 이동이다. Meta 는 맥 Cmd 용(맥에서 Ctrl+클릭은 우클릭이라서), Shift 는 기존 동작 유지용이다.
- 안내 문구 수정: `Toolbar.tsx` 그룹 버튼 툴팁, `groupEdits.ts` 의 "도형을 먼저 선택하세요" 메시지에 "Ctrl + 드래그"를 명시.
- 선택 결과는 기존과 같은 경로로 store 에 들어간다: React Flow `select` 변경 → `FlowCanvas.onNodesChange` → `setSelection` → 툴바 "그룹 만들기" 가 `selection` 을 사용.
- 참고: Windows 에서는 Ctrl 이 React Flow 의 다중 선택 키(`multiSelectionKeyCode` 기본값)이기도 해서, Ctrl+클릭으로 도형을 하나씩 추가 선택하는 것도 된다. 선택 상자는 기본 `SelectionMode.Full`, 즉 도형이 상자 안에 **완전히** 들어와야 선택된다.
- 검증: tsc·oxlint 통과, 테스트 113개 통과. 브라우저에서 직접 드래그해 보지는 않았다(불명) — React Flow 소스(`FlowRendererComponent`)의 동작을 근거로 수정.

### 2026-10-14 — PROGRESS.md 보강(실행환경·타입·문법예시 추가)
- 0절 실행 환경·의존성, 2절 디렉토리 트리·핵심 타입 요약·스타일링, 5-1절 문법 예시 추가. 코드 변경 없음.

### 2026-10-14 — 전체 점검과 버그 수정 (코드 변경 2건 + 테스트 1건)
점검 방법: 전체 파일 정독(파서·편집·스토어·뷰·UI) + 임시 퍼즈/시나리오 테스트(위 6절). 대부분의 코드는 견고했고, 실제로 고친 것은 아래 둘이다.

1. **연결선 새 꺾임점 드래그가 중간에 끊기는 문제** — `src/ui/canvas/UmlEdge.tsx`
   - 원인: 선분 중앙 손잡이(circle)를 끌어 새 꺾임점을 만들면, 곧바로 그 자리에 꺾임점이 생겨 손잡이가 `segmentHandles` 필터로 사라진다(DOM 에서 제거). 포인터 캡처가 걸린 요소가 사라지면 캡처가 풀려 `pointermove/up` 이 더 이상 전달되지 않고, 결과적으로 `endDrag` 가 호출되지 않아 `endInteraction`(Undo 정리)과 `isDragging` 상태가 남을 수 있었다.
   - 수정: 요소의 `setPointerCapture`/`onPointerMove`/`onPointerUp` 대신 드래그 시작 시 `window` 에 `pointermove/pointerup/pointercancel` 을 등록하고 종료 시 해제한다. 기존 꺾임점(rect)·새 꺾임점 모두 같은 경로를 쓴다. 상태 관리 위치는 그대로(영속: store `edgeWaypoints`, 임시: `UmlEdge` 의 `dragging` ref 와 state).
   - 검증: tsc/oxlint 통과. 브라우저 수동 확인은 **미실시**(불명).
2. **공백/특수문자가 든 클래스 이름을 그룹(namespace)으로 묶으면 코드가 깨지는 문제** — `src/core/diagrams/groupEdits.ts`
   - 원인: `class ${id}` 를 그대로 출력해서, 백틱 식별자(`` `My Class` ``)를 쓰는 클래스는 `class My Class` 가 되어 다른 클래스/경고로 파싱됐다.
   - 수정: 파서 식별자 규칙(`[A-Za-z_]\w*(-\w+)*`)에 안 맞으면 백틱으로 감싸는 `classRef()` 추가. 이 규칙은 `class/parser.ts` 의 `ID` 와 같아야 한다(복제 — 3절 경고 참고).
   - 테스트: `src/core/diagrams/groups.test.ts` 에 "회귀: 백틱 식별자 클래스 그룹화" 추가.
3. **문서 작업**: `README.md` 를 실제 프로젝트 설명으로 교체, 이 `PROGRESS.md` 를 설계 문서 형태로 재작성(1~8절).

> 위 변경은 커밋 `22264f2` 로 반영됐다.

### 2026-10-14 — git 초기화
- `git init`, 최초 커밋 `5ffb136` "최초 커밋: 2026-09-27 기준 작업 상태". 이전 이력 없음.
