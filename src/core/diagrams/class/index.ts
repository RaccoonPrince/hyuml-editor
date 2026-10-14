import type { DiagramPlugin, LayoutGraph } from '../registry';
import type { ClassModel } from './model';
import { relationWeight } from './notation';
import { parseClassDiagram } from './parser';

export const classDiagramPlugin: DiagramPlugin<ClassModel> = {
  kind: 'class',
  headers: /^classDiagram(?:-v2)?\b/,
  parse: parseClassDiagram,
  toLayoutGraph(model): LayoutGraph {
    return {
      direction: model.direction,
      nodes: model.nodes.map((node) => ({ id: node.id })),
      groups: model.groups.map((group) => ({ id: group.id, members: group.members })),
      edges: model.edges
        .filter((edge) => edge.source !== edge.target)
        .map((edge) => {
          // parentEnd 쪽이 위로 오도록 정규화 → `Animal <|-- Dog` 와 `Dog --|> Animal` 이 같은 배치가 된다.
          const parentIsTarget = edge.parentEnd === 'target';
          return {
            id: edge.id,
            ...(edge.label ?? edge.stereotype ? { label: edge.label ?? edge.stereotype } : {}),
            from: parentIsTarget ? edge.target : edge.source,
            to: parentIsTarget ? edge.source : edge.target,
            weight: relationWeight(edge.relationType),
          };
        }),
    };
  },
};
