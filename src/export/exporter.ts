import type { Rect as FlowRect } from '@xyflow/react';
import { toJpeg, toPng, toSvg } from 'html-to-image';
import { dataUrlToBytes, withJpegDpi, withPngDpi } from './dpi';
import { serialize } from '../core/document/serializer';
import type { DiagramDocument } from '../core/document/schema';

export type ExportFormat = 'png' | 'jpeg' | 'svg' | 'mermaid' | 'project';

export interface ExportContext {
  doc: DiagramDocument;
  /** 내보낼 전체 영역 — React Flow 훅의 getNodesBounds 로 계산 (그룹 안 노드도 정확) */
  bounds: FlowRect | null;
  /** `.react-flow__viewport` 요소 */
  viewport: HTMLElement | null;
  background: string;
  dpi?: number;
}

interface Exporter {
  extension: string;
  export: (ctx: ExportContext) => Promise<string | Blob>;
}

/** 간선의 셀프 루프·라벨이 노드 경계를 넘어가므로 넉넉히 여백을 둔다 */
const PADDING = 60;

async function renderImage(ctx: ExportContext, render: typeof toPng, quality?: number): Promise<string> {
  if (!ctx.viewport) throw new Error('캔버스를 찾을 수 없습니다.');
  const bounds = ctx.bounds;
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) throw new Error('내보낼 도형이 없습니다.');
  const width = Math.ceil(bounds.width + PADDING * 2);
  const height = Math.ceil(bounds.height + PADDING * 2);
  return render(ctx.viewport, {
    backgroundColor: ctx.background,
    width,
    height,
    pixelRatio: (ctx.dpi ?? 300) / 96,
    // 현재 팬/줌과 무관하게 다이어그램 전체를 1:1 로 캡처
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${PADDING - bounds.x}px, ${PADDING - bounds.y}px) scale(1)`,
    },
    // 편집용 손잡이·툴바는 제외 (SVG 요소도 포함)
    filter: (node) => !(node instanceof Element && node.classList.contains('hy-no-export')),
    // 도형 글꼴은 시스템 글꼴이라 웹폰트 삽입이 필요 없다 (코드 창 CDN 스타일시트 읽기 오류 방지)
    skipFonts: true,
    ...(quality !== undefined ? { quality } : {}),
  });
}

const exporters: Record<ExportFormat, Exporter> = {
  png: {
    extension: 'png',
    export: async (ctx) => new Blob([withPngDpi(await dataUrlToBytes(await renderImage(ctx, toPng)), ctx.dpi ?? 300) as BlobPart], { type: 'image/png' }),
  },
  jpeg: {
    extension: 'jpg',
    export: async (ctx) => new Blob([withJpegDpi(await dataUrlToBytes(await renderImage(ctx, toJpeg, 0.95)), ctx.dpi ?? 300) as BlobPart], { type: 'image/jpeg' }),
  },
  svg: { extension: 'svg', export: (ctx) => renderImage(ctx, toSvg) },
  mermaid: { extension: 'mmd', export: async (ctx) => new Blob([ctx.doc.source], { type: 'text/plain;charset=utf-8' }) },
  project: { extension: 'json', export: async (ctx) => new Blob([serialize(ctx.doc)], { type: 'application/json' }) },
};

function download(data: string | Blob, filename: string) {
  const url = typeof data === 'string' ? data : URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 일부 브라우저(Firefox)는 click 직후 revoke 하면 다운로드가 취소된다
  if (typeof data !== 'string') setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportDiagram(format: ExportFormat, ctx: ExportContext, baseName = 'diagram'): Promise<void> {
  const exporter = exporters[format];
  const data = await exporter.export(ctx);
  const suffix = format === 'png' || format === 'jpeg' ? `@${ctx.dpi ?? 300}dpi` : '';
  download(data, `${baseName}${suffix}.${exporter.extension}`);
}
