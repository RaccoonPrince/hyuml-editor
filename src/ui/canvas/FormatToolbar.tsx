import type { CSSProperties, MouseEvent } from 'react';
import { LIMITS } from '../../core/document/schema';
import { useDiagramStore } from '../../store/useDiagramStore';

const COLORS = [
  { name: '검정', value: '#000000' },
  { name: 'DKU 블루', value: '#005eb8' },
  { name: '빨강', value: '#d32f2f' },
  { name: '초록', value: '#2e7d32' },
  { name: '주황', value: '#ef6c00' },
];

/** 도형 배경색 팔레트 (null = 테마 기본색) */
const FILLS = [
  { name: '흰색', value: '#ffffff' },
  { name: '연노랑', value: '#fff8c4' },
  { name: '연파랑', value: '#dbeafe' },
  { name: '연초록', value: '#dcfce7' },
  { name: '연분홍', value: '#fce7f3' },
  { name: '연회색', value: '#e5e7eb' },
];

export type FormatTarget =
  | { kind: 'text'; styleKey: string }
  | { kind: 'edge'; styleKey: string; edgeId: string };

interface FormatToolbarProps {
  target: FormatTarget;
  /** 현재 실제로 렌더되고 있는 글꼴 크기(pt) — 기본값을 추측하지 않으므로 첫 클릭에 크기가 튀지 않는다 */
  fontSize: number;
  color?: string;
  strokeWidth?: number;
  stroke?: string;
  /** 도형 배경색을 바꿀 수 있는 대상이면 지정 */
  fill?: { value?: string; onChange: (color: string | null) => void };
  /** 그룹 라벨에서만: 그룹 해제 */
  onUngroup?: () => void;
}

const keep = (event: MouseEvent) => event.preventDefault(); // 입력 포커스 유지

export function FormatToolbar({ target, fontSize, color, strokeWidth, stroke, fill, onUngroup }: FormatToolbarProps) {
  const updateTextStyle = useDiagramStore((s) => s.updateTextStyle);
  const updateEdgeStyle = useDiagramStore((s) => s.updateEdgeStyle);
  const isEdge = target.kind === 'edge';

  return (
    <div className="nodrag nopan hy-no-export" onMouseDown={keep} style={toolbarStyle} role="toolbar" aria-label="서식">
      <button type="button" title="글자 작게" aria-label="글자 작게" style={buttonStyle}
        onMouseDown={(event) => { keep(event); updateTextStyle(target.styleKey, { fontSize: Math.max(LIMITS.fontSize.min, fontSize - 1) }); }}>
        -
      </button>
      <span style={{ minWidth: 30, color: '#fff', textAlign: 'center', fontSize: 11 }} title="글꼴 크기 (pt)">{fontSize}pt</span>
      <button type="button" title="글자 크게" aria-label="글자 크게" style={buttonStyle}
        onMouseDown={(event) => { keep(event); updateTextStyle(target.styleKey, { fontSize: Math.min(LIMITS.fontSize.max, fontSize + 1) }); }}>
        +
      </button>
      {isEdge && [1, 2, 3].map((width) => (
        <button key={width} type="button" title={`선 굵기 ${width}px`} aria-label={`선 굵기 ${width}px`}
          style={{ ...buttonStyle, width: 30, outline: width === strokeWidth ? '2px solid #66b3e8' : 'none' }}
          onMouseDown={(event) => { keep(event); updateEdgeStyle(target.edgeId, { strokeWidth: width }); }}>
          {width}px
        </button>
      ))}
      {COLORS.map((swatch) => {
        const active = (isEdge ? stroke : color) === swatch.value;
        return (
          <button key={swatch.value} type="button" title={swatch.name} aria-label={`${isEdge ? '선' : '글자'} 색 ${swatch.name}`}
            style={{ ...swatchStyle, backgroundColor: swatch.value, border: active ? '2px solid #fff' : '1px solid rgba(255,255,255,0.6)' }}
            onMouseDown={(event) => {
              keep(event);
              if (target.kind === 'edge') {
                updateEdgeStyle(target.edgeId, { stroke: swatch.value });
                updateTextStyle(target.styleKey, { color: swatch.value });
              } else {
                updateTextStyle(target.styleKey, { color: swatch.value });
              }
            }}
          />
        );
      })}
      {fill && (
        <>
          <span style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.35)', margin: '0 2px' }} />
          <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>배경</span>
          {FILLS.map((swatch) => (
            <button key={swatch.value} type="button" title={`배경 ${swatch.name}`} aria-label={`배경색 ${swatch.name}`}
              style={{ ...swatchStyle, borderRadius: 3, backgroundColor: swatch.value, border: fill.value === swatch.value ? '2px solid #66b3e8' : '1px solid rgba(255,255,255,0.6)' }}
              onMouseDown={(event) => { keep(event); fill.onChange(swatch.value); }}
            />
          ))}
          <button type="button" title="배경 기본색" aria-label="배경색 기본값으로" style={{ ...buttonStyle, width: 24, fontSize: 10 }}
            onMouseDown={(event) => { keep(event); fill.onChange(null); }}>
            ↺
          </button>
        </>
      )}
      {onUngroup && (
        <button type="button" title="그룹 해제 (구성원은 그대로 남음)" aria-label="그룹 해제" style={{ ...buttonStyle, width: 'auto', padding: '0 6px' }}
          onMouseDown={(event) => { keep(event); onUngroup(); }}>
          그룹 해제
        </button>
      )}
    </div>
  );
}

const buttonStyle: CSSProperties = {
  width: 20, height: 20, padding: 0, cursor: 'pointer', border: 'none', borderRadius: 3,
  background: '#fff', color: '#004b87', fontWeight: 700, fontSize: 11,
};

const swatchStyle: CSSProperties = { width: 14, height: 14, padding: 0, cursor: 'pointer', borderRadius: '50%' };

const toolbarStyle: CSSProperties = {
  position: 'absolute', left: '50%', bottom: 'calc(100% + 6px)', zIndex: 20,
  display: 'flex', alignItems: 'center', gap: 4, padding: 4, transform: 'translateX(-50%)',
  background: '#004b87', borderRadius: 6, boxShadow: '0 3px 10px rgba(0, 48, 87, 0.24)', whiteSpace: 'nowrap',
};
