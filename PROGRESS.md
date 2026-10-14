# PROGRESS

> git 저장소가 아니라서(`.git` 없음) 커밋 이력/diff 대신 소스 코드와 파일 수정 시각(마지막 수정 2026-09-27)을 근거로 정리했다.

## 2026-10-14 (현황 파악 시점)

### 구현/수정된 것
- Mermaid 기반 다이어그램 편집기 (React 19 + Vite + zustand/immer + @xyflow/react + Monaco)
  - 다이어그램 3종: class, usecase, sequence (`src/core/diagrams/*`: parser / model / edits / measure)
  - 코드 ↔ 캔버스 양방향: 코드 변경 시 `reconcileLayout`(`src/core/document/reconcile.ts`)이 기존 좌표 유지, 리네임 승계, 휴지통 복원, 신규 노드 배치(`placeAddedNodes`)
  - 레이아웃 엔진: dagre / elk, 직교 라우팅(`orthoRouter`), 간선 라벨 배치
  - 간선 UI(`UmlEdge.tsx`): 꺾임점 드래그/추가/삭제, 자동 경로 복원, 라벨 인라인 편집, 서식 툴바
  - 스토어 3분할(document / derived / ui), 문서 직렬화·스키마, PNG 내보내기(dpi)
- 상태 검증: `tsc -b` 오류 없음, `vitest` 10개 파일 112개 테스트 전부 통과, TODO/FIXME 없음

### 아직 안 끝난 것
- 눈에 띄는 미완성 코드는 없음. 다만 아래는 확인 필요
  - `README.md`가 Vite 템플릿 그대로 (프로젝트 설명 없음)
  - 테스트가 없는 영역: UI 컴포넌트, `export/exporter.ts`, sequence 외 일부 edits
  - `.github/modernize/code-migration/` 폴더가 열려 있었음 (마이그레이션 작업 흔적, 내용 미확인)

### 다음에 이어서 할 일
1. `git init` 후 현재 상태를 첫 커밋으로 남기기 (이력이 없어 작업 추적 불가)
2. 직전에 하던 작업이 무엇이었는지 사용자 기억으로 보강하고 이 문서에 반영
3. README를 실제 프로젝트 설명으로 교체
4. 필요하면 UI/내보내기 테스트 추가
