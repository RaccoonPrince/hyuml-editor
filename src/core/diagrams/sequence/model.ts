import type { NodeId, SourceRange } from '../../types';
import type { DiagramGroup } from '../groups';

export type ParticipantType = 'participant' | 'actor';

export interface Participant {
  id: NodeId;
  /** 표시 이름: `participant A as Alice` 의 Alice, 없으면 id */
  label: string;
  type: ParticipantType;
  /** 이 참여자를 가리키는 모든 이름 위치 (선언, 메시지 양끝, 노트, activate …) */
  refs: SourceRange[];
  /** `as` 뒤 별칭 텍스트 범위 */
  aliasRange?: SourceRange;
  /** 첫 선언의 id 끝 위치 — 별칭 삽입 지점 */
  declIdEnd?: number;
  /** 첫 선언 줄(개행 포함)과 그 내용 — box 로 묶을 때 선언을 옮기는 데 사용 */
  declLine?: { range: SourceRange; text: string };
}

/** `->` 없음, `->>` 채운 화살표, `-x` 엑스, `-)` 열린(비동기) 화살표 */
export type ArrowHead = 'none' | 'filled' | 'cross' | 'open';
export type SeqLineStyle = 'solid' | 'dotted';

export interface Message {
  /** 내용 기반 안정 키: `msg:<from>-><to>:<text>` (+ 중복 시 `#n`) */
  key: string;
  from: NodeId;
  to: NodeId;
  line: SeqLineStyle;
  head: ArrowHead;
  /** `<<->>` 양방향 */
  bidirectional: boolean;
  text: string;
  /** ':' 뒤 텍스트 범위 (텍스트가 비어 있으면 길이 0) */
  textRange?: SourceRange;
  /** ':' 가 아예 없을 때 `: text` 를 삽입할 위치 */
  textInsertAt?: number;
  /** `->>+B` : 수신자 활성화 시작 */
  activateTarget: boolean;
  /** `-->>-A` : 송신자 활성화 종료 */
  deactivateSource: boolean;
  range: SourceRange;
}

export type NotePlacement = 'left' | 'right' | 'over';

export interface Note {
  key: string;
  placement: NotePlacement;
  actors: NodeId[];
  text: string;
  textRange: SourceRange;
  range: SourceRange;
}

export type FragmentKind = 'loop' | 'alt' | 'opt' | 'par' | 'critical' | 'break' | 'rect';
export type SectionKind = 'else' | 'and' | 'option';

export interface Fragment {
  key: string;
  kind: FragmentKind;
  /** rect 의 경우 색상 문자열 */
  label: string;
  labelRange: SourceRange;
}

export interface FragmentSection {
  key: string;
  kind: SectionKind;
  label: string;
  labelRange: SourceRange;
}

export type SeqStatement =
  | { type: 'message'; message: Message }
  | { type: 'note'; note: Note }
  | { type: 'activate' | 'deactivate' | 'destroy'; actor: NodeId }
  | { type: 'fragmentStart'; fragment: Fragment }
  | { type: 'fragmentSection'; section: FragmentSection }
  | { type: 'fragmentEnd' };

export interface SequenceModel {
  kind: 'sequence';
  participants: Participant[];
  statements: SeqStatement[];
  autonumber: boolean;
  title?: string;
  /** box 블록 */
  groups: DiagramGroup[];
}

/** 텍스트 안의 `<br>` 줄바꿈 */
export const splitLines = (text: string) => text.split(/<br\s*\/?>/i);

/** 스타일 키 대상이 되는 문장들(메시지/노트/프래그먼트/섹션)의 키 목록 */
export function statementKeys(model: SequenceModel): string[] {
  const keys: string[] = [];
  for (const statement of model.statements) {
    if (statement.type === 'message') keys.push(statement.message.key);
    else if (statement.type === 'note') keys.push(statement.note.key);
    else if (statement.type === 'fragmentStart') keys.push(statement.fragment.key);
    else if (statement.type === 'fragmentSection') keys.push(statement.section.key);
  }
  return keys;
}

export const messages = (model: SequenceModel): Message[] =>
  model.statements.flatMap((statement) => (statement.type === 'message' ? [statement.message] : []));
