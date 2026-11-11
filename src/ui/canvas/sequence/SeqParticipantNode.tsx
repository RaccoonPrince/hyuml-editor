import { memo, useState } from 'react';
import { NodeResizer } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { participantFontPt, participantFontPx } from '../../../core/diagrams/sequence/measure';
import { styleKeys } from '../../../core/document/keys';
import { contrastTextOn } from '../../../core/theme';
import { useDiagramStore } from '../../../store/useDiagramStore';
import type { SeqParticipantNode as SeqParticipantNodeType } from '../../../view/flowTypes';
import { FormatToolbar } from '../FormatToolbar';
import { ParticipantShape } from './ParticipantShape';
import { SeqLabel } from './SeqLabel';

/** 시퀀스 참여자 머리: 가로 드래그(세로는 Store 가 고정), 크기 조절, 이름·글자·배경 편집 */
function SeqParticipantNodeImpl({ id, data, selected }: NodeProps<SeqParticipantNodeType>) {
  const { participant, layout, canvas, textStyles, theme, minSize } = data;
  const renameShape = useDiagramStore((s) => s.renameShape);
  const updateNodeFill = useDiagramStore((s) => s.updateNodeFill);
  const beginInteraction = useDiagramStore((s) => s.beginInteraction);
  const endInteraction = useDiagramStore((s) => s.endInteraction);
  const resetNodeSize = useDiagramStore((s) => s.resetNodeSize);
  const [hovered, setHovered] = useState(false);

  const titleKey = styleKeys.title(id);
  const fontPx = participantFontPx(id, { fontSizePt: canvas.fontSizePt, textStyles });
  const color = textStyles[titleKey]?.color ?? contrastTextOn(layout.fill) ?? theme.participantText;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      <NodeResizer
        isVisible={selected || hovered}
        minWidth={minSize.w}
        minHeight={minSize.h}
        onResizeStart={beginInteraction}
        onResizeEnd={endInteraction}
        lineStyle={{ borderColor: 'transparent' }}
      />
      <ParticipantShape type={participant.type} fill={layout.fill} theme={theme} hovered={hovered}>
        <SeqLabel
          ariaLabel={`참여자 이름 ${participant.label}`}
          value={participant.label}
          fontPx={fontPx}
          color={color}
          bold
          onCommit={(next) => renameShape(id, next)}
          toolbar={(
            <FormatToolbar
              target={{ kind: 'text', styleKey: titleKey }}
              fontSize={participantFontPt(id, { fontSizePt: canvas.fontSizePt, textStyles })}
              color={color}
              fill={{ value: layout.fill, onChange: (fill) => updateNodeFill(id, fill) }}
            />
          )}
        />
      </ParticipantShape>
      {layout.autoSize === false && hovered && (
        <button
          type="button"
          className="nodrag hy-no-export"
          title="내용에 맞게 크기 자동 조절"
          aria-label="크기 자동 조절"
          onClick={() => resetNodeSize(id)}
          style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, padding: 0, border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 11, background: 'rgba(255,255,255,0.85)', color: '#004b87' }}
        >
          ↺
        </button>
      )}
    </div>
  );
}

export const SeqParticipantNode = memo(SeqParticipantNodeImpl);
