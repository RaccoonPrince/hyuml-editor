import type { DiagramDocument } from './schema';
import { parseLayout } from './schema';

const GRAPH_MARK = '%%% graph';
const LAYOUT_MARK = '%%% layout';

export function serialize(doc: DiagramDocument): string {
  return `${GRAPH_MARK}\n${doc.source}\n${LAYOUT_MARK}\n${JSON.stringify(doc.layout, null, 2)}\n`;
}

export type DeserializeResult =
  | { ok: true; doc: DiagramDocument; warnings: string[] }
  | { ok: false; error: string };

/** 신뢰할 수 없는 파일 내용 → 문서. 절대 throw 하지 않는다. */
export function deserialize(file: string): DeserializeResult {
  try {
    if (!file.includes(GRAPH_MARK)) {
      // 레거시: { code, layout } JSON
      const legacy: unknown = JSON.parse(file);
      if (typeof legacy === 'object' && legacy !== null && typeof (legacy as { code?: unknown }).code === 'string') {
        const { layout, warnings } = parseLayout((legacy as { layout?: unknown }).layout);
        return { ok: true, doc: { source: (legacy as { code: string }).code, layout }, warnings };
      }
      return { ok: false, error: '다이어그램 프로젝트 형식이 아닙니다.' };
    }
    const graphStart = file.indexOf(GRAPH_MARK) + GRAPH_MARK.length;
    const layoutAt = file.indexOf(LAYOUT_MARK, graphStart);
    const source = file.slice(graphStart, layoutAt < 0 ? undefined : layoutAt).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
    if (!source.trim()) return { ok: false, error: '프로젝트에 다이어그램 코드가 없습니다.' };
    const rawLayout: unknown = layoutAt < 0 ? undefined : JSON.parse(file.slice(layoutAt + LAYOUT_MARK.length));
    const { layout, warnings } = parseLayout(rawLayout);
    return { ok: true, doc: { source, layout }, warnings };
  } catch (error) {
    return { ok: false, error: `파일을 읽을 수 없습니다: ${error instanceof Error ? error.message : String(error)}` };
  }
}
