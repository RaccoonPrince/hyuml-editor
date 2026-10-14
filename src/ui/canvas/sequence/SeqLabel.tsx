import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { splitLines } from '../../../core/diagrams/sequence/model';
import { lineHeightPx } from '../../../core/layout/measure';
import { EditableText } from '../EditableText';

interface SeqLabelProps {
  /** 소스 원문 (`<br>` 포함) */
  value: string;
  /** 표시용 (예: `[label]`). 없으면 value */
  display?: string;
  placeholder?: string;
  ariaLabel: string;
  fontPx: number;
  color: string;
  align?: 'left' | 'center';
  bold?: boolean;
  style?: CSSProperties;
  onCommit: (next: string) => void;
  /** 편집 중에 띄울 서식 툴바 */
  toolbar?: ReactNode;
}

/**
 * 시퀀스 라벨: 평소에는 `<br>` 줄바꿈을 반영해 여러 줄로 보여주고, 클릭하면 한 줄 입력으로 편집한다.
 */
export function SeqLabel({ value, display, placeholder = '', ariaLabel, fontPx, color, align = 'center', bold, style, onCommit, toolbar }: SeqLabelProps) {
  const [editing, setEditing] = useState(false);
  const lineHeight = lineHeightPx(fontPx);
  const lines = splitLines(display ?? value);
  const empty = !value.trim();

  return (
    <div
      className="nodrag nopan"
      style={{ position: 'relative', pointerEvents: 'all', fontSize: fontPx, lineHeight: `${lineHeight}px`, color, textAlign: align, fontWeight: bold ? 700 : 400, ...style }}
    >
      {editing ? (
        <EditableText
          ariaLabel={ariaLabel}
          value={value}
          placeholder={placeholder}
          autoFocus
          onCommit={onCommit}
          onFocusChange={(focused) => { if (!focused) setEditing(false); }}
          style={{ fontSize: fontPx, lineHeight: `${lineHeight}px`, height: lineHeight, textAlign: align, color, fontWeight: bold ? 700 : 400, minWidth: 60, background: 'rgba(255,255,255,0.08)' }}
        />
      ) : (
        <div
          role="button"
          tabIndex={0}
          aria-label={`${ariaLabel} 편집`}
          onClick={() => setEditing(true)}
          onKeyDown={(event) => { if (event.key === 'Enter') setEditing(true); }}
          style={{ cursor: 'text', whiteSpace: 'pre', minHeight: lineHeight, opacity: empty ? 0.35 : 1 }}
        >
          {empty ? placeholder : lines.map((line, index) => <div key={index}>{line || ' '}</div>)}
        </div>
      )}
      {editing && toolbar}
    </div>
  );
}
