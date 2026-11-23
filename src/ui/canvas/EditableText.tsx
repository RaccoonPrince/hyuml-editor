import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { textWidth } from '../../core/layout/measure';

interface EditableTextProps {
  value: string;
  onCommit: (next: string) => void;
  onFocusChange?: (focused: boolean) => void;
  style?: CSSProperties;
  ariaLabel: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** 내용 길이에 맞춰 폭을 늘린다 (간선 라벨용). 값 = 글꼴 px — 실제 글자 폭으로 재므로 한글도 잘리지 않는다 */
  autoWidth?: number;
  /** true 면 이 입력 위에서 드래그해도 도형이 움직인다 (클릭하면 편집). 제목처럼 도형 면적 대부분을 차지하는 글자에 쓴다 */
  draggable?: boolean;
}

/**
 * 캔버스 인라인 편집 입력. Enter/blur = 확정, Esc = 취소.
 * 외부 값이 바뀌면(코드 편집, Undo) 편집 중이 아닐 때만 동기화한다.
 */
export function EditableText({ value, onCommit, onFocusChange, style, ariaLabel, placeholder, autoFocus, autoWidth, draggable }: EditableTextProps) {
  // 편집 중일 때만 초안을 갖는다. 편집 중이 아니면 항상 외부 값을 그대로 보여준다.
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const shown = draft ?? value;

  return (
    <input
      className={draggable ? 'nopan' : 'nodrag nopan'}
      aria-label={ariaLabel}
      placeholder={placeholder}
      autoFocus={autoFocus}
      value={shown}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onPointerDown={draggable ? (event) => {
        // 드래그로 끝나면 편집 상태(포커스)를 풀어 "이동"으로만 동작하게 하고, 제자리 클릭이면 그대로 편집한다
        const input = event.currentTarget;
        const start = { x: event.clientX, y: event.clientY };
        const onUp = (up: PointerEvent) => {
          window.removeEventListener('pointerup', onUp);
          if (Math.hypot(up.clientX - start.x, up.clientY - start.y) > 3) {
            input.blur();
            window.getSelection()?.removeAllRanges();
          }
        };
        window.addEventListener('pointerup', onUp);
      } : undefined}
      onFocus={() => {
        cancelled.current = false;
        setDraft(value);
        onFocusChange?.(true);
      }}
      onBlur={() => {
        const next = draft;
        setDraft(null);
        onFocusChange?.(false);
        if (!cancelled.current && next !== null && next !== value) onCommit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          cancelled.current = true;
          event.currentTarget.blur();
        }
      }}
      style={{
        display: 'block',
        width: autoWidth ? `${Math.ceil(Math.max(24, textWidth(shown || placeholder || '', autoWidth) + 10))}px` : '100%',
        minWidth: 0,
        margin: 0,
        padding: 0,
        border: 'none',
        outline: 'none',
        background: 'transparent',
        font: 'inherit',
        color: 'inherit',
        ...style,
      }}
    />
  );
}
