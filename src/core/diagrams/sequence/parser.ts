import type { Diagnostic, SourceRange } from '../../types';
import type { DiagramGroup } from '../groups';
import { parseBoxHeader } from './boxes';
import type { ParseResult } from '../registry';
import { assignKeys } from './keys';
import type { ArrowHead, FragmentKind, NotePlacement, Participant, SectionKind, SeqStatement, SequenceModel } from './model';

/**
 * Mermaid sequenceDiagram 문법의 자체 파서.
 * 동기·순수 함수이며 throw 하지 않는다. 모든 이름/텍스트의 소스 범위를 기록한다.
 */

/** 참여자 이름: 공백 허용, 화살표를 이루는 '-' 조합과 구분 문자(: , ; + < >)는 제외 */
const ACTOR = String.raw`[^<>:,;+\n-]+(?:-(?![-x)>])[^<>:,;+\n-]*)*`;

const HEADER_RE = /^\s*sequenceDiagram\s*$/;
const PARTICIPANT_RE = /^\s*(?:(create)\s+)?(participant|actor)\s+(.+?)(?:\s+as\s+(.+?))?\s*$/d;
const MESSAGE_RE = new RegExp(String.raw`^\s*(${ACTOR})(<<)?(--?)(>>|>|x|\))\s*([+-])?\s*(${ACTOR})\s*(?::(.*))?$`, 'd');
const NOTE_RE = /^\s*note\s+(left of|right of|over)\s+([^:]+?)\s*:(.*)$/di;
const ACTIVATION_RE = /^\s*(activate|deactivate|destroy)\s+(.+?)\s*$/d;
const FRAGMENT_RE = /^\s*(loop|alt|opt|par|critical|break|rect)(?:\s+(.*?))?\s*$/d;
const SECTION_RE = /^\s*(else|and|option)(?:\s+(.*?))?\s*$/d;
const END_RE = /^\s*end\s*$/;
const BOX_RE = /^\s*box\b/;
const AUTONUMBER_RE = /^\s*autonumber\b/;
const TITLE_RE = /^\s*title\s*:?\s*(.*?)\s*$/;
const IGNORED_RE = /^\s*(?:links?|properties|details|accTitle|accDescr)\b/;

interface Line { text: string; start: number }

function splitLines(source: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const raw of source.split('\n')) {
    lines.push({ text: raw.endsWith('\r') ? raw.slice(0, -1) : raw, start });
    start += raw.length + 1;
  }
  return lines;
}

/** 그룹 범위(앞뒤 공백 제거) */
function trimmedRange(match: RegExpExecArray, group: number, lineStart: number): { text: string; range: SourceRange } | undefined {
  const indices = match.indices?.[group];
  const raw = match[group];
  if (!indices || raw === undefined) return undefined;
  const lead = raw.length - raw.trimStart().length;
  const text = raw.trim();
  const start = lineStart + indices[0] + lead;
  return { text, range: { start, end: start + text.length } };
}

const HEAD: Record<string, ArrowHead> = { '>': 'none', '>>': 'filled', x: 'cross', ')': 'open' };

export function parseSequenceDiagram(source: string): ParseResult<SequenceModel> {
  const diagnostics: Diagnostic[] = [];
  const participants = new Map<string, Participant>();
  const statements: SeqStatement[] = [];
  const blocks: (DiagramGroup | 'fragment')[] = [];
  const groups: DiagramGroup[] = [];
  let autonumber = false;
  let title: string | undefined;

  const ensure = (id: string, ref?: SourceRange, type: Participant['type'] = 'participant'): Participant => {
    let participant = participants.get(id);
    if (!participant) {
      participant = { id, label: id, type, refs: [] };
      participants.set(id, participant);
    }
    if (ref) participant.refs.push(ref);
    return participant;
  };

  const lines = splitLines(source);
  let index = 0;
  if (lines[0]?.text.trim() === '---') {
    const close = lines.findIndex((line, lineIndex) => lineIndex > 0 && line.text.trim() === '---');
    index = close < 0 ? lines.length : close + 1;
  }

  let headerFound = false;
  for (; index < lines.length; index += 1) {
    const line = lines[index]!;
    const trimmed = line.text.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    if (HEADER_RE.test(line.text)) {
      headerFound = true;
      index += 1;
    } else {
      diagnostics.push({ message: `'sequenceDiagram' 헤더가 필요합니다. (현재: '${trimmed.slice(0, 40)}')`, range: { start: line.start, end: line.start + line.text.length }, severity: 'error', source: 'parser' });
    }
    break;
  }
  if (!headerFound) {
    if (diagnostics.length === 0) diagnostics.push({ message: 'sequenceDiagram 헤더가 없습니다.', range: { start: 0, end: 0 }, severity: 'error', source: 'parser' });
    return { model: null, diagnostics };
  }

  for (; index < lines.length; index += 1) {
    const line = lines[index]!;
    const trimmed = line.text.trim();
    const lineRange = { start: line.start, end: line.start + line.text.length };
    if (!trimmed || trimmed.startsWith('%%')) continue;

    const participantMatch = PARTICIPANT_RE.exec(line.text);
    if (participantMatch) {
      const id = trimmedRange(participantMatch, 3, line.start)!;
      const participant = ensure(id.text, id.range, participantMatch[2] === 'actor' ? 'actor' : 'participant');
      participant.type = participantMatch[2] === 'actor' ? 'actor' : participant.type;
      if (participant.declIdEnd === undefined) {
        participant.declIdEnd = id.range.end;
        participant.declLine = { range: { start: line.start, end: Math.min(source.length, line.start + line.text.length + 1) }, text: trimmed };
      }
      const box = blocks[blocks.length - 1];
      if (box && box !== 'fragment' && !box.members.includes(participant.id)) box.members.push(participant.id);
      const alias = trimmedRange(participantMatch, 4, line.start);
      if (alias && !participant.aliasRange) {
        participant.label = alias.text;
        participant.aliasRange = alias.range;
      }
      continue;
    }

    const noteMatch = NOTE_RE.exec(line.text);
    if (noteMatch) {
      const placementText = noteMatch[1]!.toLowerCase();
      const placement: NotePlacement = placementText.startsWith('left') ? 'left' : placementText.startsWith('right') ? 'right' : 'over';
      const actorsGroup = trimmedRange(noteMatch, 2, line.start)!;
      const actors: string[] = [];
      let offset = actorsGroup.range.start;
      for (const part of actorsGroup.text.split(',')) {
        const lead = part.length - part.trimStart().length;
        const name = part.trim();
        if (name) {
          ensure(name, { start: offset + lead, end: offset + lead + name.length });
          actors.push(name);
        }
        offset += part.length + 1;
      }
      const text = trimmedRange(noteMatch, 3, line.start)!;
      statements.push({ type: 'note', note: { key: '', placement, actors: actors.slice(0, 2), text: text.text, textRange: text.range, range: lineRange } });
      continue;
    }

    const activationMatch = ACTIVATION_RE.exec(line.text);
    if (activationMatch) {
      const actor = trimmedRange(activationMatch, 2, line.start)!;
      ensure(actor.text, actor.range);
      statements.push({ type: activationMatch[1] as 'activate' | 'deactivate' | 'destroy', actor: actor.text });
      continue;
    }

    const fragmentMatch = FRAGMENT_RE.exec(line.text);
    if (fragmentMatch) {
      const label = trimmedRange(fragmentMatch, 2, line.start);
      const keywordEnd = line.start + (fragmentMatch.indices?.[1]?.[1] ?? 0);
      blocks.push('fragment');
      statements.push({
        type: 'fragmentStart',
        fragment: { key: '', kind: fragmentMatch[1] as FragmentKind, label: label?.text ?? '', labelRange: label?.range ?? { start: keywordEnd, end: keywordEnd } },
      });
      continue;
    }

    const sectionMatch = SECTION_RE.exec(line.text);
    if (sectionMatch) {
      if (blocks[blocks.length - 1] !== 'fragment') {
        diagnostics.push({ message: `'${sectionMatch[1]}' 는 alt/par/critical 블록 안에서만 쓸 수 있습니다.`, range: lineRange, severity: 'warning', source: 'parser' });
        continue;
      }
      const label = trimmedRange(sectionMatch, 2, line.start);
      const keywordEnd = line.start + (sectionMatch.indices?.[1]?.[1] ?? 0);
      statements.push({
        type: 'fragmentSection',
        section: { key: '', kind: sectionMatch[1] as SectionKind, label: label?.text ?? '', labelRange: label?.range ?? { start: keywordEnd, end: keywordEnd } },
      });
      continue;
    }

    if (END_RE.test(line.text)) {
      const block = blocks.pop();
      if (!block) diagnostics.push({ message: "짝이 맞지 않는 'end' 입니다.", range: lineRange, severity: 'error', source: 'parser' });
      else if (block === 'fragment') statements.push({ type: 'fragmentEnd' });
      else block.endLineRange = { start: line.start, end: Math.min(source.length, line.start + line.text.length + 1) };
      continue;
    }

    const messageMatch = MESSAGE_RE.exec(line.text);
    if (messageMatch) {
      const from = trimmedRange(messageMatch, 1, line.start)!;
      const to = trimmedRange(messageMatch, 6, line.start)!;
      ensure(from.text, from.range);
      ensure(to.text, to.range);
      const text = trimmedRange(messageMatch, 7, line.start);
      statements.push({
        type: 'message',
        message: {
          key: '',
          from: from.text,
          to: to.text,
          line: messageMatch[3] === '--' ? 'dotted' : 'solid',
          head: HEAD[messageMatch[4]!] ?? 'filled',
          bidirectional: messageMatch[2] === '<<',
          text: text?.text ?? '',
          ...(text ? { textRange: text.range } : { textInsertAt: line.start + line.text.trimEnd().length }),
          activateTarget: messageMatch[5] === '+',
          deactivateSource: messageMatch[5] === '-',
          range: lineRange,
        },
      });
      continue;
    }

    if (BOX_RE.test(line.text)) {
      const box = parseBoxHeader(line.text, line.start, source.length, groups.length);
      groups.push(box);
      blocks.push(box);
      continue;
    }
    if (AUTONUMBER_RE.test(line.text)) { autonumber = true; continue; }
    const titleMatch = TITLE_RE.exec(line.text);
    if (titleMatch) { title = titleMatch[1]; continue; }
    if (IGNORED_RE.test(line.text)) continue;

    diagnostics.push({
      message: `인식할 수 없는 구문입니다: '${trimmed.slice(0, 60)}'`,
      range: { start: line.start + (line.text.length - line.text.trimStart().length), end: line.start + line.text.trimEnd().length },
      severity: 'warning',
      source: 'parser',
    });
  }

  if (blocks.length > 0) {
    diagnostics.push({ message: `닫히지 않은 블록이 ${blocks.length}개 있습니다. 'end' 가 필요합니다.`, range: { start: source.length, end: source.length }, severity: 'error', source: 'parser' });
  }

  return {
    model: { kind: 'sequence', participants: [...participants.values()], statements: assignKeys(statements), autonumber, groups, ...(title ? { title } : {}) },
    diagnostics,
  };
}
