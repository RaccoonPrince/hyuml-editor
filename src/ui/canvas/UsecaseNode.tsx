import { memo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Handle, NodeResizer, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { UC, usecaseFontPt } from '../../core/diagrams/usecase/measure';
import { styleKeys } from '../../core/document/keys';
import { ptToPx } from '../../core/layout/measure';
import { contrastTextOn, hoverRing, TYPO } from '../../core/theme';
import { useDiagramStore } from '../../store/useDiagramStore';
import type { UsecaseFlowNode } from '../../view/flowTypes';
import { FormatToolbar } from './FormatToolbar';
import { SeqLabel } from './sequence/SeqLabel';

const hiddenHandle: CSSProperties = { opacity: 0, width: 1, height: 1, border: 0, minWidth: 0, minHeight: 0, left: '50%', top: '50%', pointerEvents: 'none' };

/** 유스케이스(타원/사각형)와 액터(막대 인형) */
function UsecaseNodeImpl({ id, data, selected }: NodeProps<UsecaseFlowNode>) {
  const { node, layout, canvas, textStyles, theme, minSize } = data;
  const renameShape = useDiagramStore((s) => s.renameShape);
  const updateNodeFill = useDiagramStore((s) => s.updateNodeFill);
  const beginInteraction = useDiagramStore((s) => s.beginInteraction);
  const endInteraction = useDiagramStore((s) => s.endInteraction);
  const resetNodeSize = useDiagramStore((s) => s.resetNodeSize);
  const [hovered, setHovered] = useState(false);

  const titleKey = styleKeys.title(id);
  const fontPt = usecaseFontPt(id, { fontSizePt: canvas.fontSizePt, textStyles });
  const fontPx = ptToPx(fontPt);
  const isActor = node.type === 'actor';
  const figureStroke = hovered ? 2 + TYPO.hoverExtra : 2;
  const color = textStyles[titleKey]?.color ?? contrastTextOn(layout.fill) ?? (isActor ? theme.memberText : theme.participantText);

  const label = (
    <div style={{ textAlign: 'center' }}>
      {node.stereotype && <div style={{ fontSize: fontPx * 0.85, color, opacity: 0.85 }}>«{node.stereotype}»</div>}
      <SeqLabel
        ariaLabel={`${isActor ? '액터' : '유스케이스'} 이름 ${node.label}`}
        value={node.label}
        fontPx={fontPx}
        color={color}
        bold={isActor}
        onCommit={(next) => renameShape(id, next)}
        toolbar={(
          <FormatToolbar
            target={{ kind: 'text', styleKey: titleKey }}
            fontSize={fontPt}
            color={color}
            fill={{ value: layout.fill, onChange: (fill) => updateNodeFill(id, fill) }}
          />
        )}
      />
    </div>
  );

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ width: '100%', height: '100%', position: 'relative', fontFamily: TYPO.fontFamily }}
    >
      <NodeResizer isVisible={selected || hovered} minWidth={minSize.w} minHeight={minSize.h} onResizeStart={beginInteraction} onResizeEnd={endInteraction} lineStyle={{ borderColor: 'transparent' }} />
      <Handle type="target" position={Position.Top} style={hiddenHandle} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={hiddenHandle} isConnectable={false} />
      {isActor ? (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', background: layout.fill ?? 'transparent', borderRadius: 6 }}>
          <svg width={34} height={UC.actorFigureH} viewBox="0 0 34 46" aria-hidden="true" style={{ flexShrink: 0 }}>
            <circle cx="17" cy="8" r="7" fill="none" stroke={theme.nodeBorder} strokeWidth={figureStroke} />
            <line x1="17" y1="15" x2="17" y2="31" stroke={theme.nodeBorder} strokeWidth={figureStroke} />
            <line x1="4" y1="21" x2="30" y2="21" stroke={theme.nodeBorder} strokeWidth={figureStroke} />
            <line x1="17" y1="31" x2="7" y2="45" stroke={theme.nodeBorder} strokeWidth={figureStroke} />
            <line x1="17" y1="31" x2="27" y2="45" stroke={theme.nodeBorder} strokeWidth={figureStroke} />
          </svg>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>{label}</div>
        </div>
      ) : (
        <div style={{
          width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: node.shape === 'rect' ? `${UC.rectPadY}px ${UC.rectPadX}px` : `${UC.ellipsePadY}px ${UC.ellipsePadX}px`,
          border: `${TYPO.border}px solid ${theme.nodeBorder}`,
          borderRadius: node.shape === 'rect' ? 6 : '50%',
          boxShadow: hovered ? hoverRing(theme.nodeBorder) : undefined,
          background: layout.fill ?? theme.participantBg,
        }}>
          {label}
        </div>
      )}
      {layout.autoSize === false && hovered && (
        <button
          type="button"
          className="nodrag hy-no-export"
          title="내용에 맞게 크기 자동 조절"
          aria-label="크기 자동 조절"
          onClick={() => resetNodeSize(id)}
          style={{ position: 'absolute', top: 0, right: 0, width: 18, height: 18, padding: 0, border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 11, background: 'rgba(255,255,255,0.85)', color: '#004b87' }}
        >
          ↺
        </button>
      )}
    </div>
  );
}

export const UsecaseNode = memo(UsecaseNodeImpl);
