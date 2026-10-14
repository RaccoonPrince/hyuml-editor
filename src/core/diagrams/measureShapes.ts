import type { LayoutState } from '../document/schema';
import { measureClassNode } from '../layout/measure';
import type { NodeId } from '../types';
import type { DiagramModel } from './registry';
import { measureParticipant } from './sequence/measure';
import { measureUsecaseNode } from './usecase/measure';

/** 모델의 모든 도형에 대해 "내용이 잘리지 않는 최소 크기" */
export function measureShapes(model: DiagramModel, layout: LayoutState): Record<NodeId, { w: number; h: number }> {
  const fontSizePt = layout.canvas.fontSizePt;
  const textStyles = layout.textStyles;
  const sizes: Record<NodeId, { w: number; h: number }> = {};
  switch (model.kind) {
    case 'class':
      for (const node of model.nodes) sizes[node.id] = measureClassNode(node, { fontSizePt, textStyles, hideEmpty: layout.canvas.hideEmptyCompartments });
      break;
    case 'usecase':
      for (const node of model.nodes) sizes[node.id] = measureUsecaseNode(node, { fontSizePt, textStyles });
      break;
    case 'sequence':
      for (const participant of model.participants) sizes[participant.id] = measureParticipant(participant, { fontSizePt, textStyles });
      break;
  }
  return sizes;
}
