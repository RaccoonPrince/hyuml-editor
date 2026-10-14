import type { DiagramGroup } from '../groups';

/** Mermaid box 첫 단어가 색으로 해석되는 CSS 색 이름 (자주 쓰는 것) */
const COLOR_WORDS = new Set([
  'transparent', 'aqua', 'black', 'blue', 'fuchsia', 'gray', 'grey', 'green', 'lime', 'maroon', 'navy', 'olive', 'orange',
  'purple', 'red', 'silver', 'teal', 'white', 'yellow', 'pink', 'brown', 'cyan', 'magenta', 'gold', 'beige', 'ivory',
  'khaki', 'lavender', 'coral', 'salmon', 'tomato', 'violet', 'indigo', 'crimson', 'lightblue', 'lightgreen',
  'lightyellow', 'lightgray', 'lightgrey', 'lightpink', 'lightcyan', 'aliceblue', 'honeydew', 'mintcream', 'azure',
  'whitesmoke', 'gainsboro', 'darkblue', 'darkgreen', 'darkred', 'skyblue', 'steelblue', 'wheat', 'plum', 'orchid',
]);

export const isColorToken = (token: string) =>
  COLOR_WORDS.has(token.toLowerCase()) || /^#[0-9a-f]{3,8}$/i.test(token) || /^rgba?\(/i.test(token);

/** `box [색] [라벨]` 한 줄 → 그룹 (구성원·end 는 파서가 채운다) */
export function parseBoxHeader(text: string, lineStart: number, sourceLength: number, index: number): DiagramGroup {
  const keywordEnd = text.search(/box\b/) + 3;
  const rest = text.slice(keywordEnd);
  const lead = rest.length - rest.trimStart().length;
  let cursor = keywordEnd + lead;
  let body = rest.trim();
  let color: string | undefined;
  // rgb(…) 는 공백을 포함할 수 있어 괄호 끝까지 색으로 본다
  const rgb = /^rgba?\([^)]*\)/i.exec(body);
  const first = rgb ? rgb[0] : body.split(/\s+/)[0] ?? '';
  if (first && isColorToken(first)) {
    color = first;
    const after = body.slice(first.length);
    cursor += first.length + (after.length - after.trimStart().length);
    body = after.trim();
  }
  const labelStart = lineStart + cursor;
  return {
    id: `box:${body || index + 1}`,
    label: body,
    members: [],
    labelRange: { start: labelStart, end: labelStart + body.length },
    headerLineRange: { start: lineStart, end: Math.min(sourceLength, lineStart + text.length + 1) },
    ...(color && color.toLowerCase() !== 'transparent' ? { color } : {}),
  };
}
