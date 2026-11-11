import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { deserialize } from '../core/document/serializer';
import type { LayoutEngineName } from '../core/document/schema';
import { LIMITS } from '../core/document/schema';
import { GROUP_NODE_PREFIX } from '../view/flowTypes';
import { themeOf } from '../core/theme';
import { exportDiagram } from '../export/exporter';
import type { ExportFormat } from '../export/exporter';
import { useDiagramStore } from '../store/useDiagramStore';

export function Toolbar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { getNodes, getNodesBounds } = useReactFlow();
  const s = useDiagramStore(useShallow((state) => ({
    isDarkMode: state.isDarkMode,
    hideEmpty: state.doc.layout.canvas.hideEmptyCompartments,
    engine: state.doc.layout.canvas.engine,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    isLayouting: state.isLayouting,
    kind: state.model?.kind,
    fontSizePt: state.doc.layout.canvas.fontSizePt,
    selectedShapes: state.selection.filter((id) => !id.startsWith(GROUP_NODE_PREFIX)).length,
  })));
  const isGraph = s.kind === 'class' || s.kind === 'usecase';
  const actions = useDiagramStore.getState;
  /** 논문용: 다크 모드여도 흰 배경·밝은 테마로 내보내기 (명세 NFR-06) */
  const [exportLight, setExportLight] = useState(true);
  const [groupName, setGroupName] = useState<string | null>(null);

  const runExport = async (format: ExportFormat) => {
    const image = format === 'png' || format === 'jpeg' || format === 'svg';
    const switchTheme = image && exportLight && actions().isDarkMode;
    try {
      if (switchTheme) {
        actions().toggleDarkMode();
        // 테마가 바뀐 화면이 그려질 때까지 두 프레임 대기
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
      const state = actions();
      await exportDiagram(format, {
        doc: state.doc,
        bounds: getNodes().length > 0 ? getNodesBounds(getNodes()) : null,
        viewport: document.querySelector<HTMLElement>('#canvas-root .react-flow__viewport'),
        background: themeOf(state.isDarkMode).canvasBg,
        dpi: 300,
      }, format === 'project' ? 'diagram-project' : 'diagram');
    } catch (error) {
      actions().notify(`내보내기 실패: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      if (switchTheme) actions().toggleDarkMode();
    }
  };

  const submitGroup = () => {
    const members = actions().selection.filter((id) => !id.startsWith(GROUP_NODE_PREFIX));
    if (groupName !== null && actions().createGroup(members, groupName)) setGroupName(null);
  };

  const openProject = async (file: File) => {
    const result = deserialize(await file.text());
    if (!result.ok) {
      actions().notify(result.error, 'error');
      return;
    }
    actions().loadDocument(result.doc, result.warnings);
  };

  return (
    <div className="hy-no-export" style={barStyle} role="toolbar" aria-label="다이어그램 도구">
      <button type="button" style={primary} onClick={() => void actions().commitNow()} title="코드를 즉시 적용">▶ 적용</button>
      <button type="button" style={secondary} disabled={!s.canUndo} onClick={() => actions().undo()} title="실행 취소 (Ctrl+Z)" aria-label="실행 취소">↶</button>
      <button type="button" style={secondary} disabled={!s.canRedo} onClick={() => actions().redo()} title="다시 실행 (Ctrl+Shift+Z)" aria-label="다시 실행">↷</button>
      <span style={divider} />
      <button type="button" style={secondary} disabled={s.isLayouting} onClick={() => void actions().autoArrange()}
        title={isGraph ? '선택한 엔진으로 전체 다시 배치 (간선이 도형을 피해 가도록 경로도 다시 계산)' : '참여자를 선언 순서대로 같은 간격으로 다시 배치'}>
        {s.isLayouting ? '배치 중…' : '자동 정렬'}
      </button>
      {isGraph && (
        <select aria-label="레이아웃 엔진" style={selectStyle} value={s.engine}
          onChange={(event) => actions().setEngine(event.target.value as LayoutEngineName)}>
          <option value="dagre">Dagre</option>
          <option value="elk">ELK</option>
        </select>
      )}
      {s.kind === 'class' && (
        <button type="button" style={secondary} onClick={() => actions().toggleHideEmptyCompartments()}>
          {s.hideEmpty ? '빈 칸 숨김' : '빈 칸 표시'}
        </button>
      )}
      {groupName === null ? (
        <button type="button" style={secondary} disabled={s.selectedShapes === 0}
          title={s.selectedShapes === 0 ? '캔버스에서 Ctrl + 드래그로 도형을 여러 개 선택한 뒤 누르세요' : `선택한 도형 ${s.selectedShapes}개를 그룹으로 묶기`}
          onClick={() => setGroupName(s.kind === 'class' ? 'Group' : '그룹')}>
          그룹{s.selectedShapes > 0 ? ` (${s.selectedShapes})` : ''}
        </button>
      ) : (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            autoFocus
            aria-label="그룹 이름"
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitGroup();
              if (event.key === 'Escape') setGroupName(null);
            }}
            style={{ ...selectStyle, width: 110 }}
          />
          <button type="button" style={primary} onClick={submitGroup}>묶기</button>
          <button type="button" style={secondary} onClick={() => setGroupName(null)} aria-label="그룹 만들기 취소">✕</button>
        </span>
      )}
      <span style={divider} />
      <label style={labelStyle} title="다이어그램 기본 글꼴 크기 (명세 FR-08: 8~24pt)">
        글꼴
        <select aria-label="다이어그램 글꼴 크기" style={selectStyle} value={s.fontSizePt}
          onChange={(event) => actions().setFontSize(Number(event.target.value))}>
          {[...new Set([8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, s.fontSizePt])]
            .filter((pt) => pt >= LIMITS.canvasFont.min && pt <= LIMITS.canvasFont.max)
            .sort((a, b) => a - b)
            .map((pt) => <option key={pt} value={pt}>{pt}pt</option>)}
        </select>
      </label>
      <span style={divider} />
      <button type="button" style={secondary} onClick={() => void runExport('png')} title="300dpi PNG">PNG</button>
      <button type="button" style={secondary} onClick={() => void runExport('jpeg')} title="300dpi JPEG">JPEG</button>
      <button type="button" style={secondary} onClick={() => void runExport('svg')}>SVG</button>
      <button type="button" style={secondary} onClick={() => void runExport('mermaid')} title="Mermaid 코드(.mmd) 저장">.mmd</button>
      <label style={{ ...labelStyle, fontWeight: 400 }} title="다크 모드여도 논문용 흰 배경으로 내보내기">
        <input type="checkbox" checked={exportLight} onChange={(event) => setExportLight(event.target.checked)} />
        흰 배경
      </label>
      <button type="button" style={primary} onClick={() => void runExport('project')}>프로젝트 저장</button>
      <button type="button" style={secondary} onClick={() => fileInputRef.current?.click()}>프로젝트 열기</button>
      <span style={divider} />
      <label style={labelStyle}>
        제목
        <select aria-label="전체 제목 글자 크기" style={selectStyle} defaultValue=""
          onChange={(event) => { if (event.target.value) actions().updateAllClassTitleStyles({ fontSize: Number(event.target.value) }); }}>
          <option value="" disabled>크기</option>
          {[10, 11, 12, 14, 16, 18, 20, 24].map((size) => <option key={size} value={size}>{size}pt</option>)}
        </select>
        <select aria-label="전체 제목 색상" style={selectStyle} defaultValue=""
          onChange={(event) => { if (event.target.value) actions().updateAllClassTitleStyles({ color: event.target.value }); }}>
          <option value="" disabled>색</option>
          <option value="#ffffff">흰색</option>
          <option value="#000000">검정</option>
          <option value="#ffd54f">노랑</option>
          <option value="#d32f2f">빨강</option>
        </select>
      </label>
      <label style={labelStyle}>
        {s.kind === 'sequence' ? '메시지' : '간선'}
        <select aria-label="전체 간선 굵기" style={selectStyle} defaultValue=""
          onChange={(event) => { if (event.target.value) actions().updateAllEdgeStyles({ strokeWidth: Number(event.target.value) }); }}>
          <option value="" disabled>굵기</option>
          {[1, 1.5, 2, 3, 4].map((width) => <option key={width} value={width}>{width}px</option>)}
        </select>
        <select aria-label="전체 간선 색상" style={selectStyle} defaultValue=""
          onChange={(event) => { if (event.target.value) actions().updateAllEdgeStyles({ stroke: event.target.value }); }}>
          <option value="" disabled>색</option>
          <option value="#374151">회색</option>
          <option value="#005eb8">DKU 블루</option>
          <option value="#d32f2f">빨강</option>
          <option value="#2e7d32">초록</option>
        </select>
      </label>
      <span style={divider} />
      <button type="button" style={secondary} onClick={() => actions().toggleDarkMode()} aria-label={s.isDarkMode ? '라이트 모드' : '다크 모드'} title={s.isDarkMode ? '라이트 모드' : '다크 모드'}>
        {s.isDarkMode ? '☀️' : '🌙'}
      </button>
      <button type="button" style={secondary} onClick={() => actions().toggleEditor()}>💻 코드 창</button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = '';
          if (file) void openProject(file);
        }}
      />
    </div>
  );
}

const barStyle: CSSProperties = {
  position: 'absolute', top: 10, right: 10, maxWidth: 'calc(100% - 20px)', zIndex: 10, display: 'flex', flexWrap: 'wrap',
  alignItems: 'center', justifyContent: 'flex-end', gap: 6, padding: 6, backgroundColor: '#004b87', borderRadius: 6,
  boxShadow: '0 2px 8px rgba(0, 48, 87, 0.2)',
};
const base: CSSProperties = { padding: '6px 10px', cursor: 'pointer', borderRadius: 4, fontWeight: 700, fontSize: 12 };
const primary: CSSProperties = { ...base, backgroundColor: '#005eb8', color: '#fff', border: '1px solid #66b3e8' };
const secondary: CSSProperties = { ...base, backgroundColor: '#fff', color: '#004b87', border: '1px solid #b8d8ee' };
const selectStyle: CSSProperties = { padding: '5px 4px', color: '#004b87', borderRadius: 4, border: '1px solid #b8d8ee', fontSize: 12 };
const labelStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, color: '#fff', fontSize: 12, fontWeight: 700 };
const divider: CSSProperties = { width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.3)' };
