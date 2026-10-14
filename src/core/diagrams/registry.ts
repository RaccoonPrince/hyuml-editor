import type { Diagnostic, Direction, EdgeId, NodeId } from '../types';
import { classDiagramPlugin } from './class';
import type { ClassModel } from './class/model';
import { sequenceDiagramPlugin } from './sequence';
import type { SequenceModel } from './sequence/model';
import { statementKeys } from './sequence/model';
import { usecaseDiagramPlugin } from './usecase';
import type { UsecaseModel } from './usecase/model';

/** 현재 지원하는 모든 다이어그램 모델의 합집합. 새 다이어그램 = 여기에 모델 추가 + 플러그인 등록 */
export type DiagramModel = ClassModel | SequenceModel | UsecaseModel;
/** 레이아웃 엔진으로 배치하는 그래프형 다이어그램 */
export type GraphDiagramModel = ClassModel | UsecaseModel;
export const isGraphModel = (model: DiagramModel | null | undefined): model is GraphDiagramModel =>
  model?.kind === 'class' || model?.kind === 'usecase';

/** 레이아웃 엔진에 넘기는 다이어그램 종류 무관 그래프 */
export interface LayoutGraph {
  direction: Direction;
  nodes: { id: NodeId }[];
  /** from 이 계층상 위(먼저) 오도록 정규화된 간선 */
  edges: { id: EdgeId; from: NodeId; to: NodeId; weight: number; label?: string }[];
  /** 그룹 구성원은 엔진이 한데 모아 배치한다 */
  groups: { id: string; members: NodeId[] }[];
}

export interface ParseResult<M> {
  model: M | null;
  diagnostics: Diagnostic[];
}

export interface DiagramPlugin<M extends DiagramModel = DiagramModel> {
  kind: M['kind'];
  /** 헤더 키워드 (예: 'classDiagram') */
  headers: RegExp;
  parse(source: string): ParseResult<M>;
  /** 그래프형 다이어그램만 제공 (레이아웃 엔진 사용). 시퀀스처럼 순서형은 없음 */
  toLayoutGraph?(model: M): LayoutGraph;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 모델 타입이 다른 플러그인들의 이종 목록
const plugins: DiagramPlugin<any>[] = [classDiagramPlugin, sequenceDiagramPlugin, usecaseDiagramPlugin];

/** frontmatter/주석을 건너뛴 첫 의미 있는 줄 */
export function headerLine(source: string): { text: string; start: number } | undefined {
  const lines = source.split('\n');
  let offset = 0;
  let inFrontmatter = lines[0]?.trim() === '---';
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]!;
    const trimmed = raw.trim();
    const start = offset;
    offset += raw.length + 1;
    if (inFrontmatter) {
      if (index > 0 && trimmed === '---') inFrontmatter = false;
      continue;
    }
    if (!trimmed || trimmed.startsWith('%%')) continue;
    return { text: trimmed, start };
  }
  return undefined;
}

export function resolvePlugin(source: string): { plugin: DiagramPlugin } | { diagnostic: Diagnostic } {
  const header = headerLine(source);
  if (!header) {
    return { diagnostic: { message: '다이어그램 헤더(예: classDiagram)가 없습니다.', range: { start: 0, end: 0 }, severity: 'error', source: 'app' } };
  }
  const plugin = plugins.find((candidate) => candidate.headers.test(header.text));
  if (plugin) return { plugin };
  const keyword = header.text.split(/\s/)[0] ?? header.text;
  return {
    diagnostic: {
      message: `'${keyword}' 다이어그램은 아직 지원하지 않습니다. 지원: ${plugins.map((candidate) => candidate.kind).join(', ')}`,
      range: { start: header.start, end: header.start + keyword.length },
      severity: 'error',
      source: 'app',
    },
  };
}

export function parseDiagram(source: string): ParseResult<DiagramModel> & { plugin?: DiagramPlugin } {
  const resolved = resolvePlugin(source);
  if ('diagnostic' in resolved) return { model: null, diagnostics: [resolved.diagnostic] };
  try {
    return { ...resolved.plugin.parse(source), plugin: resolved.plugin };
  } catch (error) {
    // 파서는 throw 하지 않도록 설계됐지만, 버그가 있어도 앱이 죽지 않게 한 번 더 막는다.
    return {
      model: null,
      diagnostics: [{ message: `파서 내부 오류: ${error instanceof Error ? error.message : String(error)}`, range: { start: 0, end: 0 }, severity: 'error', source: 'app' }],
    };
  }
}

export function toLayoutGraph(model: DiagramModel): LayoutGraph {
  const plugin = plugins.find((candidate) => candidate.kind === model.kind);
  if (!plugin?.toLayoutGraph) throw new Error(`'${model.kind}' 다이어그램은 그래프 레이아웃을 지원하지 않습니다.`);
  return plugin.toLayoutGraph(model);
}

/** 도형(노드/참여자) id 목록 — 전체 제목 스타일 등 일괄 명령에 사용 */
export function shapeIds(model: DiagramModel): string[] {
  return model.kind === 'sequence' ? model.participants.map((participant) => participant.id) : model.nodes.map((node) => node.id);
}

/** 연결선(간선/메시지) 스타일 키 목록 — 전체 간선 스타일 일괄 명령에 사용 */
export function connectorIds(model: DiagramModel): string[] {
  return model.kind === 'sequence'
    ? statementKeys(model).filter((key) => key.startsWith('msg:'))
    : model.edges.map((edge) => edge.id);
}
