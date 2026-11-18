# 요구사항 충족 점검표

점검 기준일: 2026-11-11, 브랜치 `final-prototype`. 판정 기준: **충족** = 코드 근거가 있고 자동 검증(단위 테스트 또는 `npm run e2e`)을 통과함 / **부분 충족** = 구현은 있으나 검증이 일부이거나 제약이 있음 / **미충족** = 구현 없음.
저장소 밖의 원본 SRS 문서(FR/NFR 번호 체계)는 이 저장소에 없어서, 이 표의 항목은 작업 지시서에 적힌 요구 문장을 기준으로 삼았다.

| 요구 | 판정 | 근거 (파일:줄) | 비고 |
|---|---|---|---|
| 클래스 다이어그램 지원 | 충족 | `src/core/diagrams/class/parser.ts`, `class/edits.ts:16,52,72` | e2e 클래스 시나리오 전 항목 통과 |
| 시퀀스 다이어그램 지원 | 충족 | `src/core/diagrams/sequence/parser.ts`, `sequence/reconcile.ts:26`, `sequence/layout.ts:60` | 참여자는 가로로만 이동(세로 고정) |
| 유스케이스 지원(후순위) | 충족 | `src/core/diagrams/usecase/parser.ts`, `usecase/edits.ts:19,41` | 헤더는 `usecase-beta`. e2e 통과 |
| 코드 → 캔버스 | 충족 | `src/store/derivedSlice.ts:139` (`commitNow`) | e2e "코드 입력 → 렌더링" 3종 |
| 캔버스 → 코드 | 충족 | `src/store/documentSlice.ts` (`renameShape`, `editMember`, `editEdgeLabel`), `groupEdits.ts:41` | e2e "캔버스에서 이름 수정" 3종(코드 해당 부분만 변경 + 좌표 유지) |
| 코드 수정 시 기존 도형 좌표 0px 변동 없음, 신규 도형만 빈 곳에 배치 | 충족 | `src/core/document/reconcile.ts:58`(기존 노드 좌표 유지), `:109`(`placeAddedNodes` 겹침 회피) | 단위: `store.test.ts` "코드에 줄을 추가해도…", e2e "코드 추가 → 기존 좌표 불변". 겹침 회피는 최대 50회 우측 이동의 단순 방식 |
| 이름 1개 사라지고 1개 생기면 이름 변경으로 보고 좌표 승계 | 충족(정책 명시) | `src/core/document/reconcile.ts:75-84` | 간선 이웃 서명이 같을 때만 승계. 간선 없는 고립 노드끼리의 교체는 승계로 확정(`document.test.ts` "고립 노드 리네임 정책"). 이름을 바꾸며 관계도 함께 바꾸면 승계하지 않음 |
| 코드 창에 좌표·스타일이 나타나지 않음 | 충족 | `src/core/document/serializer.ts:7`(코드 구역과 layout 구역 분리) | 좌표·스타일은 `doc.layout`에만 존재. e2e가 소스에 좌표 문자열이 없음을 확인 |
| 입력 후 300ms 자동 동기화 | 충족 | `src/store/derivedSlice.ts:16`(`COMMIT_DEBOUNCE_MS = 300`) | 타이머 값은 확인. 실제 지연 시간 측정은 안 함(e2e는 0.9초 대기 후 상태 확인) |
| 문법 오류 시 직전 그림 유지 + 오류 표시 | 충족 | `src/store/derivedSlice.ts:143`, `src/ui/editor/CodeEditor.tsx` (진단 목록·마커) | 단위: `store.test.ts`, e2e "문법 오류 → 직전 그림 유지". 파서가 오류로 보는 입력만 해당(경고성 입력은 그림이 갱신됨) |
| 도형 드래그 | 충족 | `src/ui/canvas/FlowCanvas.tsx`(`onNodesChange`), `documentSlice.ts:194`(`moveNodes`) | e2e "도형 드래그" 3종. 드래그 중에는 영향 받는 간선만 재계산(`view/toFlowElements.ts`) |
| 크기 조절 | 충족 | `src/ui/canvas/UmlClassNode.tsx:86`(`NodeResizer`), `documentSlice.ts:205`(`resizeNode`) | 자동화 e2e 없음 — 코드와 스토어 수준만 확인 |
| 색 조절(도형 배경·글자·선) | 부분 충족 | `src/ui/canvas/FormatToolbar.tsx`, `documentSlice.ts:248`(`updateNodeFill`), `Toolbar.tsx`(전체 제목·간선 색) | e2e로 색 변경은 검증하지 않음 |
| 연결선 꺾임 조정 | 부분 충족 | `src/ui/canvas/UmlEdge.tsx:82-137,213`, `documentSlice.ts:243` | 꺾임점 저장·왕복은 단위 테스트(`document.test.ts`)로 확인. 손잡이 드래그 자체는 e2e 미검증 |
| 글꼴 8~24pt | 충족 | `src/core/document/schema.ts:47-48`(`LIMITS`), `documentSlice.ts:316`(`setFontSize`), `Toolbar.tsx:120` | 범위 밖 값은 clamp. 글꼴 변경 e2e는 없음 |
| 고립 도형 표시 | 충족 | `src/view/toFlowElements.ts`(간선 유무와 무관하게 좌표 있는 모든 노드를 그림) | e2e가 간선 없는 도형(Solo/Guest/Idle)이 화면에 나타나는지 확인 |
| 그룹 생성 + 코드 반영(클래스는 namespace) | 충족 | `src/core/diagrams/groupEdits.ts:41`(생성), `:90`(해제), `src/ui/Toolbar.tsx`(그룹 UI) | 클래스=`namespace`, 유스케이스=`systemBoundary`, 시퀀스=`box`. e2e에서 Ctrl+드래그 선택 → 그룹 만들기 3종. 생성·해제 들여쓰기는 `groups.test.ts`에서 고정 |
| 프로젝트 저장·불러오기(코드 구역 + layout 구역) | 충족 | `src/core/document/serializer.ts:7,16` | 단위: 왕복 동일성(`document.test.ts`, `store.test.ts`), e2e "저장 후 불러오기" 3종 |
| PNG/JPEG 내보내기 300dpi | 충족 | `src/export/exporter.ts:37`(`pixelRatio = 300/96`), `src/export/dpi.ts` | e2e가 PNG 파일의 pHYs(≈300dpi)를 읽어 확인. JPEG는 `dpi.test.ts`에서 헤더 기록만 단위 검증, 실제 브라우저 내보내기는 미실행 |
| 30개 객체 기준 1초 이내 갱신 | 충족 | `src/view/perf.test.ts` | 클래스 30개: 파싱+reconcile(배치 포함)+toFlowElements 약 100ms, 40개 약 50ms (개발 PC, Node 환경). 브라우저 렌더링(React Flow 그리기) 시간은 포함하지 않음 |
| 캔버스에서 이름·멤버·관계 라벨을 고치면 코드의 해당 부분만 갱신 | 충족 | `class/edits.ts:16,52,72`, `usecase/edits.ts:19,41`, `sequence/edits.ts`(`editStatementText`) | 최소 `TextEdit` 단위로 Monaco에 적용. 이름은 e2e로, 멤버·라벨은 `edits.test.ts` 단위로 확인 |
| Undo / Redo | 충족 | `src/store/documentSlice.ts:389-390` | e2e "Undo/Redo" 3종, `store.test.ts` |

## 알려진 한계 (미해결)

- 색 변경·크기 조절·꺾임 손잡이 드래그·JPEG 내보내기는 자동화된 브라우저 검증이 없다(코드 경로와 단위 테스트만).
- 300ms 동기화 시간과 브라우저에서의 실제 프레임 시간은 측정하지 않았다. 측정값은 Node에서의 계산 시간이다.
- 코드 창 편집기(Monaco)가 CDN에서 로드되므로 오프라인 환경에서는 코드 창이 뜨지 않는다.
- Mermaid 호환성 검증은 경고 용도이며, 우리 파서가 허용하는 모든 문법이 Mermaid에서 렌더링된다는 보장은 없다.
