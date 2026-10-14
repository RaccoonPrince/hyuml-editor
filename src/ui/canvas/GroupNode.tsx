import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { styleKeys } from '../../core/document/keys';
import { ptToPx } from '../../core/layout/measure';
import { contrastTextOn, TYPO } from '../../core/theme';
import { useDiagramStore } from '../../store/useDiagramStore';
import type { GroupFlowNode } from '../../view/flowTypes';
import { FormatToolbar } from './FormatToolbar';
import { SeqLabel } from './sequence/SeqLabel';

/**
 * 그룹 상자 (class namespace · usecase systemBoundary).
 * 크기·위치는 구성원 도형에서 계산되며, 상자를 끌면 구성원 전체가 함께 움직인다 (FlowCanvas 참고).
 */
function GroupNodeImpl({ data, selected }: NodeProps<GroupFlowNode>) {
  const { group, kind, canvas, textStyles, theme } = data;
  const renameGroup = useDiagramStore((s) => s.renameGroup);
  const removeGroup = useDiagramStore((s) => s.removeGroup);
  const updateTextStyle = useDiagramStore((s) => s.updateTextStyle);
  const key = styleKeys.group(group.id);
  const style = textStyles[key];
  const fontPt = style?.fontSize ?? canvas.fontSizePt + 1;
  const fill = style?.fill;
  const color = style?.color ?? contrastTextOn(fill) ?? theme.fragmentText;

  return (
    <div style={{
      width: '100%', height: '100%', boxSizing: 'border-box', position: 'relative', pointerEvents: 'none',
      border: `${selected ? 2 : 1.5}px ${kind === 'class' ? 'dashed' : 'solid'} ${selected ? '#005eb8' : theme.fragmentStroke}`,
      borderRadius: kind === 'usecase' ? 10 : 6,
      fontFamily: TYPO.fontFamily,
    }}>
      {/* 사용자가 고른 배경은 반투명 레이어로 → 그룹 안을 지나는 간선이 가려지지 않는다 */}
      {fill && <div style={{ position: 'absolute', inset: 0, background: fill, opacity: 0.55, borderRadius: 'inherit', pointerEvents: 'none' }} />}
      <div style={{ position: 'absolute', left: 8, top: 5, maxWidth: 'calc(100% - 16px)', pointerEvents: 'all', cursor: 'move', background: theme.labelBg, borderRadius: 4, padding: '0 4px' }}>
        <SeqLabel
          ariaLabel={`그룹 이름 ${group.label}`}
          value={group.label}
          display={kind === 'class' ? `«namespace» ${group.label}` : group.label}
          fontPx={ptToPx(fontPt)}
          color={color}
          align="left"
          bold
          onCommit={(next) => renameGroup(group.id, next)}
          toolbar={(
            <FormatToolbar
              target={{ kind: 'text', styleKey: key }}
              fontSize={fontPt}
              color={color}
              fill={{ value: fill, onChange: (next) => updateTextStyle(key, { fill: next }) }}
              onUngroup={() => removeGroup(group.id)}
            />
          )}
        />
      </div>
    </div>
  );
}

export const GroupNode = memo(GroupNodeImpl);
