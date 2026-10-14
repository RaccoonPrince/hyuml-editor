import type { DiagramPlugin } from '../registry';
import type { SequenceModel } from './model';
import { parseSequenceDiagram } from './parser';

export const sequenceDiagramPlugin: DiagramPlugin<SequenceModel> = {
  kind: 'sequence',
  headers: /^sequenceDiagram\b/,
  parse: parseSequenceDiagram,
};
