# hyuml-editor

Mermaid 문법으로 UML 다이어그램을 그리는 **코드 ↔ 캔버스 양방향 편집기**입니다. 왼쪽 코드 창에서 Mermaid 코드를 고치면 캔버스가 바뀌고, 캔버스에서 이름·라벨·멤버를 고치면 코드가 최소 범위만 수정됩니다. 도형 위치·크기·색 같은 시각 정보는 코드에 넣지 않고 별도 레이아웃 데이터로 저장하므로, 코드를 고쳐도 이미 배치한 도형은 움직이지 않습니다.

지원 다이어그램: `classDiagram`, `sequenceDiagram`, 유스케이스(usecase)

주요 기능
- 코드 창(Monaco) + 캔버스(React Flow) 동시 편집, 오류 진단 표시
- 도형 드래그·리사이즈, 연결선 꺾임점 드래그, 라벨 인라인 편집, 글꼴·색·선 굵기 지정
- 도형 그룹화 (class `namespace`, sequence `box`, usecase `systemBoundary`)
- 자동 정렬 (dagre / ELK 선택), 실행 취소·다시 실행
- 내보내기: PNG·JPEG(300dpi), SVG, Mermaid 코드(.mmd), 프로젝트 파일(코드 + 레이아웃)

## 실행

```bash
npm install
npm run dev        # 개발 서버 (Vite)
npm run build      # 타입 검사 + 프로덕션 빌드 (dist/)
npm run preview    # 빌드 결과 미리보기
npm run test       # 단위 테스트 (vitest, 1회 실행)
npm run test:watch # 테스트 감시 모드
npm run typecheck  # tsc -b
npm run lint       # oxlint
```

## 문서

설계와 진행 상황은 [PROGRESS.md](PROGRESS.md)에 정리되어 있습니다. 코드를 수정하기 전에 먼저 읽어 주세요.

## 기술 스택

React 19 · TypeScript · Vite · zustand + immer · @xyflow/react · Monaco · dagre / elkjs · html-to-image · mermaid(호환성 검증 전용)
