import type { SeqStatement } from './model';

/**
 * 시퀀스 문장 키 규칙 — 순서가 아닌 내용 기반.
 *   msg:<from>-><to>:<text>
 *   note:<placement>:<actors>:<text>
 *   frag:<kind>:<label>
 *   sec:<fragmentKey>|<kind>:<label>
 * 같은 내용이 반복되면 `#2`, `#3` … 접미사.
 */

/** 키를 다시 계산한 새 문장 배열 (원본 불변) */
export function assignKeys(statements: readonly SeqStatement[]): SeqStatement[] {
  const counts = new Map<string, number>();
  const unique = (base: string) => {
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return count === 1 ? base : `${base}#${count}`;
  };
  const fragmentStack: string[] = [];

  return statements.map((statement) => {
    switch (statement.type) {
      case 'message': {
        const { from, to, text } = statement.message;
        return { ...statement, message: { ...statement.message, key: unique(`msg:${from}->${to}:${text}`) } };
      }
      case 'note': {
        const { placement, actors, text } = statement.note;
        return { ...statement, note: { ...statement.note, key: unique(`note:${placement}:${actors.join(',')}:${text}`) } };
      }
      case 'fragmentStart': {
        const key = unique(`frag:${statement.fragment.kind}:${statement.fragment.label}`);
        fragmentStack.push(key);
        return { ...statement, fragment: { ...statement.fragment, key } };
      }
      case 'fragmentSection': {
        const parent = fragmentStack[fragmentStack.length - 1] ?? '';
        const { kind, label } = statement.section;
        return { ...statement, section: { ...statement.section, key: unique(`sec:${parent}|${kind}:${label}`) } };
      }
      case 'fragmentEnd':
        fragmentStack.pop();
        return statement;
      default:
        return statement;
    }
  });
}

function keyOf(statement: SeqStatement): string | undefined {
  switch (statement.type) {
    case 'message': return statement.message.key;
    case 'note': return statement.note.key;
    case 'fragmentStart': return statement.fragment.key;
    case 'fragmentSection': return statement.section.key;
    default: return undefined;
  }
}

/** 같은 위치 문장끼리 old → new 키 대응 (바뀐 것만) */
export function keyMapping(before: readonly SeqStatement[], after: readonly SeqStatement[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  before.forEach((statement, index) => {
    const from = keyOf(statement);
    const to = after[index] ? keyOf(after[index]) : undefined;
    if (from && to && from !== to) mapping[from] = to;
  });
  return mapping;
}
