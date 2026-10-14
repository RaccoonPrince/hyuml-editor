import { memo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Handle, NodeResizer, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { ClassMember } from '../../core/diagrams/class/model';
import { styleKeys } from '../../core/document/keys';
import { lineHeightPx, memberFontPt, memberFontPx, titleFontPt, titleFontPx } from '../../core/layout/measure';
import { contrastTextOn, TYPO } from '../../core/theme';
import { useDiagramStore } from '../../store/useDiagramStore';
import type { UmlNode } from '../../view/flowTypes';
import { EditableText } from './EditableText';
import { FormatToolbar } from './FormatToolbar';

/** 라우팅은 routing.ts 가 좌표로 직접 계산하므로 핸들은 React Flow 연결용 1쌍만 둔다 */
const hiddenHandle: CSSProperties = { opacity: 0, width: 1, height: 1, border: 0, minWidth: 0, minHeight: 0, left: '50%', top: '50%', pointerEvents: 'none' };

function UmlClassNodeImpl({ id, data, selected }: NodeProps<UmlNode>) {
  const { model, layout, canvas, textStyles, theme, minSize } = data;
  const renameShape = useDiagramStore((s) => s.renameShape);
  const editMember = useDiagramStore((s) => s.editMember);
  const beginInteraction = useDiagramStore((s) => s.beginInteraction);
  const endInteraction = useDiagramStore((s) => s.endInteraction);
  const resetNodeSize = useDiagramStore((s) => s.resetNodeSize);
  const updateNodeFill = useDiagramStore((s) => s.updateNodeFill);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);

  const ctx = { fontSizePt: canvas.fontSizePt, hideEmpty: canvas.hideEmptyCompartments, textStyles };
  const titleKey = styleKeys.title(id);
  const titlePx = titleFontPx(id, ctx);
  const titleColor = textStyles[titleKey]?.color ?? theme.headerText;

  const focusHandler = (key: string) => (focused: boolean) => setFocusedKey((current) => (focused ? key : current === key ? null : current));

  const renderCompartment = (members: ClassMember[], label: string) => {
    if (members.length === 0 && canvas.hideEmptyCompartments) return null;
    return (
      <div style={{
        borderTop: `${TYPO.divider}px solid ${theme.divider}`,
        padding: `${TYPO.compartmentPadY}px ${TYPO.compartmentPadX}px`,
        display: 'flex', flexDirection: 'column', gap: TYPO.memberGap,
        minHeight: members.length === 0 ? TYPO.emptyCompartment + TYPO.compartmentPadY * 2 + TYPO.divider : undefined,
        boxSizing: 'border-box',
      }}>
        {members.map((member) => {
          const key = styleKeys.member(id, member.key);
          const px = memberFontPx(id, member.key, ctx);
          const color = textStyles[key]?.color ?? contrastTextOn(layout.fill) ?? theme.memberText;
          return (
            <div key={member.key} style={{ position: 'relative', height: lineHeightPx(px) }}>
              <EditableText
                ariaLabel={`${model.label} ${label} ${member.display}`}
                value={member.display}
                onCommit={(next) => editMember(id, member.key, next)}
                onFocusChange={focusHandler(key)}
                style={{
                  fontSize: px,
                  lineHeight: `${lineHeightPx(px)}px`,
                  height: lineHeightPx(px),
                  color,
                  textAlign: 'left',
                  fontStyle: member.classifier === 'abstract' ? 'italic' : 'normal',
                  textDecoration: member.classifier === 'static' ? 'underline' : 'none',
                }}
              />
              {focusedKey === key && <FormatToolbar target={{ kind: 'text', styleKey: key }} fontSize={memberFontPt(id, member.key, ctx)} color={color} />}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%', height: '100%', boxSizing: 'border-box', position: 'relative',
        background: layout.fill ?? theme.nodeBg,
        border: `${TYPO.border}px solid ${theme.nodeBorder}`, borderRadius: 5,
        fontFamily: TYPO.fontFamily, display: 'flex', flexDirection: 'column',
      }}
    >
      <NodeResizer
        isVisible={selected || hovered}
        minWidth={minSize.w}
        minHeight={minSize.h}
        onResizeStart={beginInteraction}
        onResizeEnd={endInteraction}
        lineStyle={{ borderColor: 'transparent' }}
      />
      <Handle type="target" position={Position.Top} style={hiddenHandle} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={hiddenHandle} isConnectable={false} />

      <div style={{
        position: 'relative', background: theme.headerBg, color: theme.headerText,
        padding: `${TYPO.titlePadY}px ${TYPO.titlePadX}px`, textAlign: 'center', borderRadius: '3px 3px 0 0',
      }}>
        {model.stereotype && (
          <div style={{ fontSize: Math.max(8, titlePx - 3), lineHeight: `${lineHeightPx(Math.max(8, titlePx - 3))}px`, opacity: 0.9 }}>
            «{model.stereotype}»
          </div>
        )}
        <div style={{ position: 'relative', height: lineHeightPx(titlePx) }}>
          <EditableText
            ariaLabel={`클래스 이름 ${model.label}`}
            value={model.label}
            onCommit={(next) => renameShape(id, next)}
            onFocusChange={focusHandler(titleKey)}
            style={{
              fontSize: titlePx, lineHeight: `${lineHeightPx(titlePx)}px`, height: lineHeightPx(titlePx),
              fontWeight: 700, textAlign: 'center', color: titleColor,
              fontStyle: model.stereotype?.toLowerCase() === 'abstract' ? 'italic' : 'normal',
            }}
          />
          {focusedKey === titleKey && (
            <FormatToolbar
              target={{ kind: 'text', styleKey: titleKey }}
              fontSize={titleFontPt(id, ctx)}
              color={titleColor}
              fill={{ value: layout.fill, onChange: (color) => updateNodeFill(id, color) }}
            />
          )}
        </div>
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
      {renderCompartment(model.attributes, '속성')}
      {renderCompartment(model.methods, '메서드')}
    </div>
  );
}

export const UmlClassNode = memo(UmlClassNodeImpl);
