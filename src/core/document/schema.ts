import type { EdgeId, NodeId, Point } from '../types';

/**
 * 저장·Undo 대상 문서 = { source, layout }. 그 외 상태(모델, 경로, UI)는 전부 파생값이다.
 * layout 은 코드 창에 절대 노출되지 않는 시각 메타데이터.
 */

export interface NodeLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  /** true(기본) = 내용에 맞춰 자동 크기. 사용자가 리사이즈하면 false */
  autoSize?: boolean;
  fill?: string;
}

/** fontSize 는 pt 단위(8~24). fill = 텍스트를 담는 도형(노트·그룹 등)의 배경색 */
export interface TextStyle { fontSize?: number; color?: string; fill?: string; isCustomized?: boolean }
export interface EdgeStyle { stroke?: string; strokeWidth?: number; isCustomized?: boolean }

export type LayoutEngineName = 'dagre' | 'elk';

export interface LayoutState {
  version: 3;
  nodes: Record<NodeId, NodeLayout>;
  canvas: {
    /** 다이어그램 기본 글꼴 크기 (pt, 8~24) — 명세 FR-08 */
    fontSizePt: number;
    hideEmptyCompartments: boolean;
    engine: LayoutEngineName;
  };
  /** 키 규칙은 keys.ts 참고 */
  textStyles: Record<string, TextStyle>;
  edgeStyles: Record<string, EdgeStyle>;
  /** 사용자가 꺾은 연결선의 경유점 (flow 좌표). 없으면 자동 경로 — 명세 FR-12 */
  edgeWaypoints: Record<EdgeId, Point[]>;
}

export interface DiagramDocument {
  source: string;
  layout: LayoutState;
}

export const LIMITS = {
  /** pt */
  fontSize: { min: 8, max: 24 },
  canvasFont: { min: 8, max: 24 },
  strokeWidth: { min: 1, max: 6 },
  nodeSize: { min: 40, max: 5000 },
  coordinate: 1_000_000,
} as const;

export function createEmptyLayout(): LayoutState {
  return {
    version: 3,
    nodes: {},
    canvas: { fontSizePt: 10, hideEmptyCompartments: true, engine: 'dagre' },
    textStyles: {},
    edgeStyles: {},
    edgeWaypoints: {},
  };
}

export const DEFAULT_SOURCE = `classDiagram
  direction TB
  class Order {
    +id: string
    +total: number
    +pay(amount: number) bool
  }
  class Payment {
    <<interface>>
    +process() void
  }
  class CardPayment
  Order "1" --> "0..*" Payment : uses
  Payment <|.. CardPayment
`;

/* ───────────── 런타임 검증 + 마이그레이션 ───────────── */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** pt 값, 0.5pt 단위 */
export function normalizeFontSize(value: unknown): number | undefined {
  return finite(value) ? clamp(Math.round(value * 2) / 2, LIMITS.fontSize.min, LIMITS.fontSize.max) : undefined;
}

/** v1·v2 는 글꼴 크기를 px 로 저장했다 → pt 로 변환 (1pt = 4/3px) */
const pxToPt = (px: number) => Math.round(px * 0.75 * 2) / 2;

function sanitizeWaypoints(value: unknown): Point[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const points = value
    .filter((point): point is { x: number; y: number } => isRecord(point) && finite(point.x) && finite(point.y))
    .map((point) => ({ x: clamp(point.x, -LIMITS.coordinate, LIMITS.coordinate), y: clamp(point.y, -LIMITS.coordinate, LIMITS.coordinate) }));
  return points.length > 0 ? points.slice(0, 20) : undefined;
}

export function normalizeStrokeWidth(value: unknown): number | undefined {
  return finite(value) ? clamp(value, LIMITS.strokeWidth.min, LIMITS.strokeWidth.max) : undefined;
}

export function normalizeColor(value: unknown): string | undefined {
  return typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]{3,20}$|^rgba?\([\d\s.,%]+\)$/.test(value.trim())
    ? value.trim()
    : undefined;
}

function sanitizeNode(value: unknown): NodeLayout | undefined {
  if (!isRecord(value)) return undefined;
  const { x, y, w, h } = value;
  if (!finite(x) || !finite(y) || !finite(w) || !finite(h)) return undefined;
  const fill = normalizeColor(value.fill);
  return {
    x: clamp(x, -LIMITS.coordinate, LIMITS.coordinate),
    y: clamp(y, -LIMITS.coordinate, LIMITS.coordinate),
    w: clamp(w, LIMITS.nodeSize.min, LIMITS.nodeSize.max),
    h: clamp(h, LIMITS.nodeSize.min, LIMITS.nodeSize.max),
    // v1 파일에는 autoSize 가 없다 → 사용자가 맞춘 크기일 수 있으니 수동으로 간주
    autoSize: value.autoSize === true,
    ...(fill ? { fill } : {}),
  };
}

function sanitizeTextStyle(value: unknown): TextStyle | undefined {
  if (!isRecord(value)) return undefined;
  const fontSize = normalizeFontSize(value.fontSize);
  const color = normalizeColor(value.color);
  const fill = normalizeColor(value.fill);
  if (fontSize === undefined && color === undefined && fill === undefined) return undefined;
  return {
    ...(fontSize !== undefined ? { fontSize } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(fill !== undefined ? { fill } : {}),
    ...(value.isCustomized === true ? { isCustomized: true } : {}),
  };
}

function sanitizeEdgeStyle(value: unknown): EdgeStyle | undefined {
  if (!isRecord(value)) return undefined;
  const strokeWidth = normalizeStrokeWidth(value.strokeWidth);
  const stroke = normalizeColor(value.stroke);
  if (strokeWidth === undefined && stroke === undefined) return undefined;
  return {
    ...(strokeWidth !== undefined ? { strokeWidth } : {}),
    ...(stroke !== undefined ? { stroke } : {}),
    ...(value.isCustomized === true ? { isCustomized: true } : {}),
  };
}

function sanitizeMap<T>(value: unknown, sanitize: (entry: unknown) => T | undefined, warnings: string[], label: string) {
  const result: Record<string, T> = {};
  if (!isRecord(value)) return result;
  for (const [key, entry] of Object.entries(value)) {
    const clean = sanitize(entry);
    if (clean) result[key] = clean;
    else warnings.push(`${label} '${key}' 항목이 올바르지 않아 무시했습니다.`);
  }
  return result;
}

/** v1 textStyles 키 → v2 키. 인덱스 기반 멤버 키(`X:attribute:0`)는 내용 기반 키로 옮길 수 없어 버린다. */
function migrateTextStyleKey(key: string): string | undefined {
  if (key.startsWith('edge:')) return `${key}/label`;
  if (key.endsWith(':label')) return `node:${key.slice(0, -':label'.length)}/title`;
  if (/:(?:attribute|method):\d+$/.test(key)) return undefined;
  return `node:${key}/title`;
}

export interface LayoutParseResult { layout: LayoutState; warnings: string[] }

/** 신뢰할 수 없는 입력(파일 등) → 안전한 LayoutState. 절대 throw 하지 않는다. */
export function parseLayout(value: unknown): LayoutParseResult {
  const warnings: string[] = [];
  const empty = createEmptyLayout();
  if (!isRecord(value)) {
    warnings.push('레이아웃 정보가 없어 기본값을 사용합니다.');
    return { layout: empty, warnings };
  }
  const version = value.version;
  if (version !== 1 && version !== 2 && version !== 3) {
    warnings.push(`알 수 없는 레이아웃 버전(${String(version)})입니다. 좌표만 복구를 시도합니다.`);
  }
  const canvas = isRecord(value.canvas) ? value.canvas : {};
  const legacyPx = version === 1 || version === 2;
  // px → pt 변환은 범위 검사 전에 해야 20px(=15pt) 같은 값이 잘리지 않는다
  const rawStyles = isRecord(value.textStyles) && legacyPx
    ? Object.fromEntries(Object.entries(value.textStyles).map(([key, style]) => [key,
      isRecord(style) && finite(style.fontSize) ? { ...style, fontSize: pxToPt(style.fontSize) } : style]))
    : value.textStyles;
  let textStyles = sanitizeMap(rawStyles, sanitizeTextStyle, warnings, '텍스트 스타일');
  if (version === 1) {
    const migrated: Record<string, TextStyle> = {};
    for (const [key, style] of Object.entries(textStyles)) {
      const next = migrateTextStyleKey(key);
      if (next) migrated[next] = { ...migrated[next], ...style };
    }
    textStyles = migrated;
  }
  return {
    layout: {
      version: 3,
      nodes: sanitizeMap(value.nodes, sanitizeNode, warnings, '노드 좌표'),
      canvas: {
        fontSizePt: finite(canvas.fontSizePt)
          ? clamp(legacyPx ? pxToPt(canvas.fontSizePt) : canvas.fontSizePt, LIMITS.canvasFont.min, LIMITS.canvasFont.max)
          : empty.canvas.fontSizePt,
        hideEmptyCompartments: typeof canvas.hideEmptyCompartments === 'boolean'
          ? canvas.hideEmptyCompartments
          : empty.canvas.hideEmptyCompartments,
        engine: canvas.engine === 'elk' ? 'elk' : 'dagre',
      },
      textStyles,
      edgeStyles: sanitizeMap(value.edgeStyles, sanitizeEdgeStyle, warnings, '간선 스타일'),
      edgeWaypoints: sanitizeMap(value.edgeWaypoints, sanitizeWaypoints, warnings, '연결선 꺾임점'),
    },
    warnings,
  };
}
