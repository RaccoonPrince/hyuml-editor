import { relationWeight } from '../class/notation';
import type { DiagramPlugin, LayoutGraph } from '../registry';
import type { UsecaseModel } from './model';
import { parseUsecaseDiagram } from './parser';

export const usecaseDiagramPlugin: DiagramPlugin<UsecaseModel> = {
  kind: 'usecase',
  headers: /^usecase(?:-beta)?\s*$/,
  parse: parseUsecaseDiagram,
  toLayoutGraph(model): LayoutGraph {
    return {
      direction: model.direction,
      nodes: model.nodes.map((node) => ({ id: node.id })),
      groups: model.groups.map((group) => ({ id: group.id, members: group.members })),
      edges: model.edges
        .filter((edge) => edge.source !== edge.target)
        .map((edge) => {
          const parentIsTarget = edge.parentEnd === 'target';
          return {
            id: edge.id,
            ...(edge.label ?? edge.stereotype ? { label: edge.label ?? edge.stereotype } : {}),
            from: parentIsTarget ? edge.target : edge.source,
            to: parentIsTarget ? edge.source : edge.target,
            // 액터–유스케이스 연관이 가장 강하게 붙도록
            weight: edge.relationType === 'association' ? 3 : relationWeight(edge.relationType),
          };
        }),
    };
  },
};
