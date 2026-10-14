import type { Diagnostic } from '../types';

/**
 * Mermaid 는 렌더링/파싱 기준이 아니라 "호환성 검증" 용도로만 쓴다.
 * 무거운 라이브러리이므로 필요할 때 동적 import 한다.
 */
let mermaidPromise: Promise<typeof import('mermaid')['default']> | null = null;

function loadMermaid() {
  mermaidPromise ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, suppressErrorRendering: true });
    return mermaid;
  });
  return mermaidPromise;
}

interface MermaidParseError {
  message?: string;
  hash?: { loc?: { first_line?: number; last_line?: number; first_column?: number; last_column?: number } };
}

export async function validateWithMermaid(source: string): Promise<Diagnostic[]> {
  try {
    const mermaid = await loadMermaid();
    await mermaid.parse(source);
    return [];
  } catch (raw) {
    const error = (raw ?? {}) as MermaidParseError;
    const message = typeof error.message === 'string' ? error.message : String(raw);
    const lineNumber = error.hash?.loc?.first_line ?? Number(/line (\d+)/.exec(message)?.[1] ?? NaN);
    const lines = source.split('\n');
    let start = 0;
    if (Number.isFinite(lineNumber) && lineNumber >= 1) {
      for (let index = 0; index < Math.min(lineNumber - 1, lines.length); index += 1) start += lines[index]!.length + 1;
    }
    const lineLength = Number.isFinite(lineNumber) ? (lines[lineNumber - 1]?.length ?? 0) : 0;
    return [{
      message: `Mermaid 호환성 경고: ${message.split('\n')[0]}`,
      range: { start, end: start + lineLength },
      severity: 'warning',
      source: 'mermaid',
    }];
  }
}
