import type { StateCreator } from 'zustand';
import type { EditResult } from '../core/diagrams/editResult';
import type { DiagramModel } from '../core/diagrams/registry';
import type { DiagramDocument, EdgeStyle, LayoutEngineName, LayoutState, NodeLayout, TextStyle } from '../core/document/schema';
import type { Diagnostic, EdgeId, NodeId, Point } from '../core/types';

/** 저장·Undo 대상. 이 슬라이스의 doc 만 파일로 저장된다. */
export interface DocumentSlice {
  doc: DiagramDocument;
  past: DiagramDocument[];
  future: DiagramDocument[];
  historyKey: string | null;
  historyAt: number;

  /** 코드 창 타이핑 (연속 입력은 하나의 Undo 단위로 묶임) */
  setSource: (source: string) => void;
  loadDocument: (doc: DiagramDocument, warnings?: string[]) => void;

  // 캔버스 → 코드 (TextEdit 기반)
  editMember: (nodeId: NodeId, memberKey: string, text: string) => void;
  editEdgeLabel: (edgeId: EdgeId, label: string) => void;
  // 시퀀스 다이어그램
  /** 메시지·노트·프래그먼트·섹션 라벨 (문장 키로 지정) */
  editSequenceText: (statementKey: string, text: string) => void;
  /** 도형 이름 변경 — 다이어그램 종류별 규칙으로 코드에 반영 (클래스/참여자/액터·유스케이스) */
  renameShape: (id: NodeId, name: string) => void;
  // 그룹 (명세 FR-14·15)
  createGroup: (memberIds: NodeId[], name: string) => boolean;
  removeGroup: (groupId: string) => void;
  renameGroup: (groupId: string, name: string) => void;
  applyEdit: (result: EditResult, historyLabel: string) => boolean;

  // 캔버스 → layout (code 는 절대 건드리지 않음)
  beginInteraction: () => void;
  endInteraction: () => void;
  moveNodes: (moves: { id: NodeId; x: number; y: number }[]) => void;
  resizeNode: (id: NodeId, rect: Partial<Pick<NodeLayout, 'x' | 'y' | 'w' | 'h'>>) => void;
  resetNodeSize: (id: NodeId) => void;
  /** fill: null 이면 기본색으로 되돌림 */
  updateTextStyle: (key: string, style: Pick<TextStyle, 'fontSize' | 'color'> & { fill?: string | null }) => void;
  /** 도형(클래스 노드·참여자) 배경색. null 이면 기본색 */
  updateNodeFill: (id: NodeId, fill: string | null) => void;
  /** 연결선 꺾임점 (명세 FR-12). null 이면 자동 경로로 되돌림 */
  setEdgeWaypoints: (edgeId: EdgeId, points: Point[] | null) => void;
  updateEdgeStyle: (edgeId: EdgeId, style: Pick<EdgeStyle, 'stroke' | 'strokeWidth'>) => void;
  updateAllEdgeStyles: (style: Pick<EdgeStyle, 'stroke' | 'strokeWidth'>) => void;
  updateAllClassTitleStyles: (style: Pick<TextStyle, 'fontSize' | 'color'>) => void;
  setFontSize: (pt: number) => void;
  toggleHideEmptyCompartments: () => void;
  setEngine: (engine: LayoutEngineName) => void;
  autoArrange: () => Promise<void>;

  undo: () => void;
  redo: () => void;
}

/** 종류별로 따로 보관하는 layout 조각 — 좌표뿐 아니라 스타일·꺾임점도 (같은 키가 다른 종류에 남지 않도록) */
export type KindStash = Pick<LayoutState, 'nodes' | 'textStyles' | 'edgeStyles' | 'edgeWaypoints'>;

/** 파생 상태 — 저장하지 않으며 언제든 doc 로부터 다시 계산 가능 */
export interface DerivedSlice {
  model: DiagramModel | null;
  /** model 이 파싱된 원본 소스. doc.source 와 다르면 model 은 최신이 아니다 */
  modelSource: string | null;
  diagnostics: Diagnostic[];
  trash: Record<NodeId, NodeLayout>;
  /** 다이어그램 종류를 바꿨다 돌아올 때 복원할 종류별 좌표 (같은 이름이 다른 종류의 좌표를 물려받지 않게) */
  kindStash: Partial<Record<DiagramModel['kind'], KindStash>>;
  /** doc.layout.nodes 가 어느 종류의 좌표인지. null = 방금 통째로 들어온 문서(Undo·열기)라 그대로 믿는다 */
  layoutKind: DiagramModel['kind'] | null;
  parseSeq: number;
  layoutSeq: number;
  /** 자동 정렬이 완료될 때마다 증가 — 캔버스가 화면 맞춤에 사용 */
  arrangedSeq: number;
  isLayouting: boolean;

  scheduleCommit: () => void;
  commitNow: () => Promise<void>;
  /** 폰트/빈칸 설정 등이 바뀐 뒤 autoSize 노드 크기를 다시 맞춘다 */
  refitNodes: () => void;
}

export type ToastKind = 'info' | 'warning' | 'error';

/** Undo 대상이 아닌 화면 상태 */
export interface UiSlice {
  isDarkMode: boolean;
  editorWidth: number;
  isEditorVisible: boolean;
  selection: NodeId[];
  toast: { id: number; message: string; kind: ToastKind } | null;

  toggleDarkMode: () => void;
  setEditorWidth: (width: number) => void;
  toggleEditor: () => void;
  setSelection: (ids: NodeId[]) => void;
  notify: (message: string, kind?: ToastKind) => void;
  dismissToast: () => void;
}

export type Store = DocumentSlice & DerivedSlice & UiSlice;

export type SliceCreator<T> = StateCreator<Store, [['zustand/immer', never]], [], T>;
