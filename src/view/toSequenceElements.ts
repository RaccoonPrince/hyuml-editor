import { layoutSequence } from '../core/diagrams/sequence/layout';
import { measureParticipant } from '../core/diagrams/sequence/measure';
import type { Participant, SequenceModel } from '../core/diagrams/sequence/model';
import type { LayoutState, NodeLayout } from '../core/document/schema';
import type { ThemeColors } from '../core/theme';
import type { NodeId } from '../core/types';
import type { AppNode, SeqBodyNode, SeqParticipantNode } from './flowTypes';
import { SEQ_BODY_ID } from './flowTypes';

export interface SeqFlowInput {
  model: SequenceModel;
  layout: LayoutState;
  selection: readonly NodeId[];
  theme: ThemeColors;
}

const MARGIN = 40;
const participantCache = new WeakMap<Participant, { deps: unknown[]; node: SeqParticipantNode }>();

function buildParticipant(participant: Participant, nodeLayout: NodeLayout, input: SeqFlowInput): SeqParticipantNode {
  const selected = input.selection.includes(participant.id);
  const deps = [nodeLayout, selected, input.layout.canvas, input.layout.textStyles, input.theme];
  const cached = participantCache.get(participant);
  if (cached && cached.deps.every((dep, index) => dep === deps[index])) return cached.node;
  const node: SeqParticipantNode = {
    id: participant.id,
    type: 'seqParticipant',
    position: { x: nodeLayout.x, y: nodeLayout.y },
    width: nodeLayout.w,
    height: nodeLayout.h,
    selected,
    zIndex: 2,
    data: {
      participant,
      layout: nodeLayout,
      canvas: input.layout.canvas,
      textStyles: input.layout.textStyles,
      theme: input.theme,
      minSize: measureParticipant(participant, { fontSizePt: input.layout.canvas.fontSizePt, textStyles: input.layout.textStyles }),
    },
  };
  participantCache.set(participant, { deps, node });
  return node;
}

export function toSequenceElements(input: SeqFlowInput): { nodes: AppNode[]; edges: [] } {
  const { model, layout, theme } = input;
  const seq = layoutSequence({
    model,
    nodes: layout.nodes,
    fontSizePt: layout.canvas.fontSizePt,
    textStyles: layout.textStyles,
  });

  const participants: SeqParticipantNode[] = [];
  for (const participant of model.participants) {
    const nodeLayout = layout.nodes[participant.id];
    if (nodeLayout) participants.push(buildParticipant(participant, nodeLayout, input));
  }
  if (participants.length === 0) return { nodes: [], edges: [] };

  const origin = { x: seq.bounds.x - MARGIN, y: seq.bounds.y - MARGIN };
  const body: SeqBodyNode = {
    id: SEQ_BODY_ID,
    type: 'seqBody',
    position: origin,
    width: seq.bounds.w + MARGIN * 2,
    height: seq.bounds.h + MARGIN * 2,
    draggable: false,
    selectable: false,
    focusable: false,
    zIndex: 0,
    data: {
      seq,
      participants: model.participants,
      nodes: layout.nodes,
      canvas: layout.canvas,
      textStyles: layout.textStyles,
      edgeStyles: layout.edgeStyles,
      theme,
      origin,
    },
  };
  // 본문(생명선·메시지)을 먼저 → 참여자 머리가 위에 그려진다
  return { nodes: [body, ...participants], edges: [] };
}
