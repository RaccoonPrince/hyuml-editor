import { memo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { SeqMessageLayout } from '../../../core/diagrams/sequence/layout';
import { participantFontPx } from '../../../core/diagrams/sequence/measure';
import type { ArrowHead } from '../../../core/diagrams/sequence/model';
import { styleKeys } from '../../../core/document/keys';
import { ptToPx } from '../../../core/layout/measure';
import { contrastTextOn, SEQ, TYPO } from '../../../core/theme';
import type { Point } from '../../../core/types';
import { useDiagramStore } from '../../../store/useDiagramStore';
import type { SeqBodyNode } from '../../../view/flowTypes';
import { FormatToolbar } from '../FormatToolbar';
import { ParticipantShape } from './ParticipantShape';
import { SeqLabel } from './SeqLabel';

/** 화살촉: tip 위치와 방향(+1 오른쪽, -1 왼쪽) */
function ArrowTip({ tip, dir, head, stroke, width }: { tip: Point; dir: number; head: ArrowHead; stroke: string; width: number }) {
  const s = SEQ.arrowSize;
  const back = tip.x - dir * s;
  switch (head) {
    case 'filled':
      return <path d={`M ${tip.x} ${tip.y} L ${back} ${tip.y - s / 2} L ${back} ${tip.y + s / 2} Z`} fill={stroke} stroke={stroke} strokeWidth={1} strokeLinejoin="round" />;
    case 'open':
      return <path d={`M ${back} ${tip.y - s / 2} L ${tip.x} ${tip.y} L ${back} ${tip.y + s / 2}`} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />;
    case 'cross': {
      const c = tip.x - dir * (s / 2);
      return (
        <g stroke={stroke} strokeWidth={width} strokeLinecap="round">
          <line x1={c - s / 2} y1={tip.y - s / 2} x2={c + s / 2} y2={tip.y + s / 2} />
          <line x1={c - s / 2} y1={tip.y + s / 2} x2={c + s / 2} y2={tip.y - s / 2} />
        </g>
      );
    }
    default:
      return null;
  }
}

function SeqBodyImpl({ data, width, height }: NodeProps<SeqBodyNode>) {
  const { seq, participants, nodes, canvas, textStyles, edgeStyles, theme, origin } = data;
  const editSequenceText = useDiagramStore((s) => s.editSequenceText);
  const updateTextStyle = useDiagramStore((s) => s.updateTextStyle);
  const renameGroup = useDiagramStore((s) => s.renameGroup);
  const removeGroup = useDiagramStore((s) => s.removeGroup);
  const ox = (x: number) => x - origin.x;
  const oy = (y: number) => y - origin.y;
  const box = (x: number, y: number, extra?: CSSProperties): CSSProperties => ({ position: 'absolute', left: ox(x), top: oy(y), ...extra });
  const baseFont = canvas.fontSizePt;
  const textStyle = (key: string) => textStyles[styleKeys.seqText(key)];
  const byId = new Map(participants.map((participant) => [participant.id, participant]));

  const messagePath = (message: SeqMessageLayout) => (message.self
    ? `M ${ox(message.x1)} ${oy(message.y)} H ${ox(message.x1 + SEQ.selfLoopW)} V ${oy(message.y + SEQ.selfLoopH)} H ${ox(message.x1)}`
    : `M ${ox(message.x1)} ${oy(message.y)} H ${ox(message.x2)}`);

  const labels: ReactNode[] = [];
  for (const { group, rect } of seq.boxes) {
    const key = styleKeys.group(group.id);
    const style = textStyles[key];
    const fontPt = style?.fontSize ?? baseFont;
    const fill = style?.fill ?? group.color;
    const color = style?.color ?? contrastTextOn(style?.fill) ?? theme.fragmentText;
    labels.push(
      <div key={group.id} style={box(rect.x + 8, rect.y + 5, { zIndex: 1 })}>
        <SeqLabel
          ariaLabel={`그룹 이름 ${group.label}`}
          value={group.label}
          placeholder="그룹"
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
      </div>,
    );
  }
  for (const message of seq.messages) {
    const key = message.key;
    const style = textStyle(key);
    const edge = edgeStyles[key];
    const color = style?.color ?? theme.edgeLabelText;
    labels.push(
      <div key={key} style={box(message.label.x, message.label.y, { width: message.label.w, zIndex: 1 })}>
        <SeqLabel
          ariaLabel={`메시지 ${message.message.from} → ${message.message.to}`}
          value={message.message.text}
          placeholder="메시지"
          fontPx={message.text.fontPx}
          color={color}
          align={message.self ? 'left' : 'center'}
          onCommit={(next) => editSequenceText(key, next)}
          toolbar={(
            <FormatToolbar
              target={{ kind: 'edge', styleKey: styleKeys.seqText(key), edgeId: key }}
              fontSize={message.text.fontPt}
              color={color}
              stroke={edge?.stroke ?? theme.edgeStroke}
              strokeWidth={edge?.strokeWidth ?? 1.5}
            />
          )}
        />
      </div>,
    );
  }
  for (const note of seq.notes) {
    const style = textStyle(note.key);
    const color = style?.color ?? contrastTextOn(style?.fill) ?? theme.noteText;
    labels.push(
      <div key={note.key} style={box(note.x + SEQ.notePad, note.y + SEQ.notePad, { width: note.w - SEQ.notePad * 2, zIndex: 1 })}>
        <SeqLabel
          ariaLabel="노트"
          value={note.note.text}
          placeholder="노트"
          fontPx={note.text.fontPx}
          color={color}
          onCommit={(next) => editSequenceText(note.key, next)}
          toolbar={(
            <FormatToolbar
              target={{ kind: 'text', styleKey: styleKeys.seqText(note.key) }}
              fontSize={note.text.fontPt}
              color={color}
              fill={{ value: style?.fill, onChange: (fill) => updateTextStyle(styleKeys.seqText(note.key), { fill }) }}
            />
          )}
        />
      </div>,
    );
  }
  for (const fragment of seq.fragments) {
    if (fragment.kind === 'rect') continue;
    const tagW = fragment.kind.length * 8 + 22;
    const style = textStyle(fragment.key);
    const color = style?.color ?? theme.fragmentText;
    const stroke = edgeStyles[fragment.key]?.stroke ?? theme.fragmentStroke;
    labels.push(
      <div key={fragment.key} style={box(fragment.x + tagW + 6, fragment.y + 2, { zIndex: 1 })}>
        <SeqLabel
          ariaLabel={`${fragment.kind} 조건`}
          value={fragment.label}
          display={`[${fragment.label}]`}
          placeholder="[조건]"
          fontPx={fragment.labelText.fontPx}
          color={color}
          align="left"
          onCommit={(next) => editSequenceText(fragment.key, next)}
          toolbar={(
            <FormatToolbar
              target={{ kind: 'edge', styleKey: styleKeys.seqText(fragment.key), edgeId: fragment.key }}
              fontSize={fragment.labelText.fontPt}
              color={color}
              stroke={stroke}
              strokeWidth={edgeStyles[fragment.key]?.strokeWidth ?? 1.2}
            />
          )}
        />
      </div>,
    );
    for (const section of fragment.sections) {
      const sectionStyle = textStyle(section.key);
      const sectionColor = sectionStyle?.color ?? theme.fragmentText;
      labels.push(
        <div key={section.key} style={box(fragment.x + 8, section.y + 3, { zIndex: 1 })}>
          <SeqLabel
            ariaLabel={`${section.kind} 조건`}
            value={section.label}
            display={`[${section.label}]`}
            placeholder={`[${section.kind}]`}
            fontPx={section.labelText.fontPx}
            color={sectionColor}
            align="left"
            onCommit={(next) => editSequenceText(section.key, next)}
            toolbar={<FormatToolbar target={{ kind: 'text', styleKey: styleKeys.seqText(section.key) }} fontSize={section.labelText.fontPt} color={sectionColor} />}
          />
        </div>,
      );
    }
  }
  for (const footer of seq.footers) {
    const participant = byId.get(footer.id);
    if (!participant) continue;
    const fontPx = participantFontPx(footer.id, { fontSizePt: baseFont, textStyles });
    labels.push(
      <div key={`footer:${footer.id}`} style={box(footer.rect.x, footer.rect.y, { width: footer.rect.w, height: footer.rect.h })}>
        <ParticipantShape type={participant.type} fill={nodes[footer.id]?.fill} theme={theme}>
          <div style={{ fontSize: fontPx, fontWeight: 700, color: textStyles[styleKeys.title(footer.id)]?.color ?? contrastTextOn(nodes[footer.id]?.fill) ?? theme.participantText, textAlign: 'center', lineHeight: TYPO.lineHeight, whiteSpace: 'pre' }}>
            {participant.label.split(/<br\s*\/?>/i).join('\n')}
          </div>
        </ParticipantShape>
      </div>,
    );
  }

  return (
    <div style={{ position: 'relative', width, height, pointerEvents: 'none', fontFamily: TYPO.fontFamily }}>
      <svg width={width} height={height} style={{ position: 'absolute', inset: 0, overflow: 'visible' }} aria-hidden="true">
        {/* box 그룹 */}
        {seq.boxes.map(({ group, rect }) => {
          const fill = textStyles[styleKeys.group(group.id)]?.fill ?? group.color;
          return (
            <rect key={group.id} x={ox(rect.x)} y={oy(rect.y)} width={rect.w} height={rect.h} rx={8}
              fill={fill ?? 'none'} fillOpacity={fill ? 0.35 : 0} stroke={theme.fragmentStroke} strokeWidth={1.2} />
          );
        })}
        {/* rect 블록 배경 */}
        {seq.fragments.filter((fragment) => fragment.kind === 'rect').map((fragment) => (
          <rect key={fragment.key} x={ox(fragment.x)} y={oy(fragment.y)} width={fragment.w} height={fragment.h} rx={4} fill={fragment.fill ?? theme.fragmentLabelBg} opacity={0.6} />
        ))}
        {seq.lifelines.map((lifeline) => (
          <g key={lifeline.id}>
            <line x1={ox(lifeline.x)} y1={oy(lifeline.y1)} x2={ox(lifeline.x)} y2={oy(lifeline.y2)} stroke={theme.lifeline} strokeWidth={1.2} strokeDasharray="5 4" />
            {lifeline.destroyed && (
              <g stroke={theme.edgeStroke} strokeWidth={2}>
                <line x1={ox(lifeline.x) - 8} y1={oy(lifeline.y2) - 8} x2={ox(lifeline.x) + 8} y2={oy(lifeline.y2) + 8} />
                <line x1={ox(lifeline.x) - 8} y1={oy(lifeline.y2) + 8} x2={ox(lifeline.x) + 8} y2={oy(lifeline.y2) - 8} />
              </g>
            )}
          </g>
        ))}
        {seq.activations.map((activation, index) => (
          <rect key={`${activation.id}:${index}`} x={ox(activation.x)} y={oy(activation.y)} width={activation.w} height={activation.h} fill={theme.activationBg} stroke={theme.nodeBorder} strokeWidth={1} />
        ))}
        {seq.fragments.filter((fragment) => fragment.kind !== 'rect').map((fragment) => {
          const stroke = edgeStyles[fragment.key]?.stroke ?? theme.fragmentStroke;
          const strokeWidth = edgeStyles[fragment.key]?.strokeWidth ?? 1.2;
          const tagW = fragment.kind.length * 8 + 22;
          const x = ox(fragment.x);
          const y = oy(fragment.y);
          return (
            <g key={fragment.key}>
              <rect x={x} y={y} width={fragment.w} height={fragment.h} fill="none" stroke={stroke} strokeWidth={strokeWidth} />
              <path d={`M ${x} ${y} H ${x + tagW} V ${y + 13} L ${x + tagW - 6} ${y + 19} H ${x} Z`} fill={theme.fragmentLabelBg} stroke={stroke} strokeWidth={strokeWidth} />
              <text x={x + 6} y={y + 13} fontSize={11} fontWeight={700} fill={theme.fragmentText}>{fragment.kind}</text>
              {fragment.sections.map((section) => (
                <line key={section.key} x1={x} y1={oy(section.y)} x2={x + fragment.w} y2={oy(section.y)} stroke={stroke} strokeWidth={strokeWidth} strokeDasharray="6 4" />
              ))}
            </g>
          );
        })}
        {seq.notes.map((note) => {
          const fill = textStyle(note.key)?.fill ?? theme.noteBg;
          const x = ox(note.x);
          const y = oy(note.y);
          const fold = 8;
          return (
            <g key={note.key}>
              <path d={`M ${x} ${y} H ${x + note.w - fold} L ${x + note.w} ${y + fold} V ${y + note.h} H ${x} Z`} fill={fill} stroke={theme.noteBorder} strokeWidth={1.2} />
              <path d={`M ${x + note.w - fold} ${y} V ${y + fold} H ${x + note.w}`} fill="none" stroke={theme.noteBorder} strokeWidth={1.2} />
            </g>
          );
        })}
        {seq.messages.map((message) => {
          const edge = edgeStyles[message.key];
          const stroke = edge?.stroke ?? theme.edgeStroke;
          const strokeWidth = edge?.strokeWidth ?? 1.5;
          const endY = message.self ? message.y + SEQ.selfLoopH : message.y;
          const dir = message.self ? -1 : Math.sign(message.x2 - message.x1) || 1;
          return (
            <g key={message.key}>
              <path d={messagePath(message)} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={message.message.line === 'dotted' ? '6 4' : undefined} />
              <ArrowTip tip={{ x: ox(message.x2), y: oy(endY) }} dir={dir} head={message.message.head} stroke={stroke} width={strokeWidth} />
              {message.message.bidirectional && (
                <ArrowTip tip={{ x: ox(message.x1), y: oy(message.y) }} dir={message.self ? -1 : -dir} head={message.message.head} stroke={stroke} width={strokeWidth} />
              )}
              {message.number !== undefined && (
                <g>
                  <circle cx={ox(message.x1)} cy={oy(message.y)} r={9} fill={stroke} />
                  <text x={ox(message.x1)} y={oy(message.y) + 4} fontSize={10} fontWeight={700} textAnchor="middle" fill={theme.canvasBg}>{message.number}</text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      {labels}
    </div>
  );
}

export const SeqBody = memo(SeqBodyImpl);
