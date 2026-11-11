// 실제 브라우저(Chromium) 기반 UI 시나리오 검증. 사용법은 README 의 "E2E" 절 참고.
//   npm run dev            (다른 터미널에서)
//   npm run e2e            (기본 주소 http://localhost:5173, E2E_URL 로 변경 가능)
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const URL = process.env.E2E_URL ?? 'http://localhost:5173';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, 'docs', 'screenshots');
const tmp = path.join(root, 'e2e', '.tmp');
mkdirSync(shots, { recursive: true });
mkdirSync(tmp, { recursive: true });

const SCENARIOS = {
  class: {
    base: 'classDiagram\n  class Alpha\n  class Beta\n  class Gamma\n  Alpha --> Beta\n  Beta --> Gamma\n',
    add: (s) => `${s}  class Delta\n  Gamma --> Delta\n`,
    renameFrom: 'Delta', renameTo: 'Epsilon',
    bad: ['class Foo', 'classDiagram\n  class Alpha {\n    +x: int\n'],
    group: /namespace\s+\S+/, members: ['Alpha', 'Beta'], dragNode: 'Beta',
  },
  usecase: {
    base: 'usecase-beta\n  actor User\n  Login\n  Pay\n  User --> Login\n  Login --> Pay\n',
    add: (s) => `${s}  Refund\n  Pay --> Refund\n`,
    renameFrom: 'Refund', renameTo: 'Cancel',
    bad: ['hello world', 'usecase-beta\n  systemBoundary Shop\n    Login\n'],
    group: /systemBoundary\s+\S+/, members: ['User', 'Login'], dragNode: 'Login',
  },
  sequence: {
    base: 'sequenceDiagram\n  participant A as Alice\n  participant B as Bob\n  participant C as Carol\n  A->>B: hi\n  B->>C: yo\n',
    add: (s) => `${s}  participant D\n  C->>D: ping\n`,
    renameFrom: 'D', renameTo: 'E',
    bad: ['hello world', 'sequenceDiagram\n  loop retry\n    A->>B: x\n'],
    group: /box\s/, members: ['A', 'B'], dragNode: 'B',
  },
};

const results = [];
const check = async (kind, name, fn) => {
  try {
    const note = await fn();
    results.push({ kind, name, ok: true, note: note ?? '' });
  } catch (error) {
    results.push({ kind, name, ok: false, note: String(error.message ?? error).split('\n')[0] });
  }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const state = (page) => page.evaluate(() => {
  const s = window.__hyuml.getState();
  const m = s.model;
  return {
    source: s.doc.source,
    nodes: JSON.parse(JSON.stringify(s.doc.layout.nodes)),
    kind: m?.kind ?? null,
    modelIds: m ? (m.nodes ? m.nodes.map((n) => n.id) : m.participants.map((p) => p.id)) : [],
    errors: s.diagnostics.filter((d) => d.severity === 'error').length,
  };
});
const settle = (page, ms = 900) => page.waitForTimeout(ms); // 300ms 디바운스 + 비동기 배치 대기
const pos = (n) => n && { x: n.x, y: n.y };

async function setCode(page, text) {
  // 키 입력(insertText)은 Monaco 자동 들여쓰기가 줄마다 누적되므로, 붙여넣기와 같은 효과의 setValue 를 쓴다
  await page.evaluate((value) => window.monaco.editor.getModels()[0].setValue(value), text);
  await settle(page);
}
const shot = (page, kind, step) => page.screenshot({ path: path.join(shots, `${kind}-${step}.png`) });
const nodeBox = async (page, id) => {
  const box = await page.locator(`.react-flow__node[data-id="${id}"]`).first().boundingBox();
  assert(box, `노드 ${id} 를 찾을 수 없음`);
  return box;
};

async function dragNode(page, id, dx, dy) {
  const b = await nodeBox(page, id);
  await page.mouse.move(b.x + 3, b.y + 3);
  await page.mouse.down();
  await page.mouse.move(b.x + 3 + dx / 2, b.y + 3 + dy / 2, { steps: 5 });
  await page.mouse.move(b.x + 3 + dx, b.y + 3 + dy, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

function pngDpi(buf) {
  // pHYs 청크: 픽셀/미터. 300dpi = 11811
  let i = 8;
  while (i < buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    if (type === 'pHYs') return Math.round(buf.readUInt32BE(i + 8) * 0.0254);
    i += 12 + len;
  }
  return null;
}

async function runKind(browser, kind, sc) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(URL);
  await page.waitForFunction(() => window.__hyuml, null, { timeout: 30000 });
  await page.locator('.monaco-editor').first().waitFor({ timeout: 30000 });

  await check(kind, '코드 입력 → 렌더링', async () => {
    await setCode(page, sc.base);
    const st = await state(page);
    assert(st.kind === kind, `kind=${st.kind}`);
    assert(st.errors === 0, '오류 진단 존재');
    const count = await page.locator('.react-flow__node').count();
    assert(count >= 3, `노드 ${count}개`);
    assert(!/"x"|layout/.test(st.source), '코드 창에 좌표/레이아웃 노출');
    await shot(page, kind, '1-render');
    return `노드 ${count}개`;
  });

  await check(kind, '도형 드래그 → 좌표 유지', async () => {
    const before = await state(page);
    await dragNode(page, sc.dragNode, 90, 60);
    await settle(page, 400);
    const afterDrag = await state(page);
    const a = before.nodes[sc.dragNode], b = afterDrag.nodes[sc.dragNode];
    assert(a.x !== b.x || a.y !== b.y, '좌표가 변하지 않음(드래그 실패)');
    assert(afterDrag.source === before.source, '드래그가 소스를 바꿈');
    await page.waitForTimeout(800); // 재동기화 이후에도 유지되는지
    const later = await state(page);
    assert(later.nodes[sc.dragNode].x === b.x && later.nodes[sc.dragNode].y === b.y, '시간 경과 후 좌표 변동');
    await shot(page, kind, '2-drag');
    return `${a.x.toFixed(0)},${a.y.toFixed(0)} → ${b.x.toFixed(0)},${b.y.toFixed(0)}`;
  });

  await check(kind, 'Undo/Redo', async () => {
    const cur = await state(page);
    const moved = pos(cur.nodes[sc.dragNode]);
    await page.getByRole('button', { name: '실행 취소' }).click();
    await settle(page, 400);
    const undone = pos((await state(page)).nodes[sc.dragNode]);
    assert(undone.x !== moved.x || undone.y !== moved.y, 'Undo 후 좌표가 그대로');
    await shot(page, kind, '9-undo');
    await page.getByRole('button', { name: '다시 실행' }).click();
    await settle(page, 400);
    const redone = pos((await state(page)).nodes[sc.dragNode]);
    assert(redone.x === moved.x && redone.y === moved.y, 'Redo 후 좌표 불일치');
  });

  await check(kind, '코드 추가 → 기존 좌표 불변', async () => {
    const beforeAdd = await state(page);
    await setCode(page, sc.add(beforeAdd.source));
    const after = await state(page);
    assert(after.modelIds.length === beforeAdd.modelIds.length + 1, '신규 도형이 생기지 않음');
    for (const id of beforeAdd.modelIds) {
      const a = beforeAdd.nodes[id], b = after.nodes[id];
      if (kind === 'sequence') assert(b && a.x === b.x, `${id} x 변동`);
      else assert(b && a.x === b.x && a.y === b.y, `${id} 좌표 변동 ${a.x},${a.y} → ${b?.x},${b?.y}`);
    }
    await shot(page, kind, '3-add');
  });

  await check(kind, '이름 변경 → 좌표 승계', async () => {
    const before = await state(page);
    const old = pos(before.nodes[sc.renameFrom]);
    assert(old, `${sc.renameFrom} 좌표 없음`);
    const renamed = before.source.replace(new RegExp(`\\b${sc.renameFrom}\\b`, 'g'), sc.renameTo);
    await setCode(page, renamed);
    const after = await state(page);
    const now = pos(after.nodes[sc.renameTo]);
    assert(now, '새 이름 좌표 없음');
    assert(now.x === old.x && (kind === 'sequence' || now.y === old.y), `좌표 승계 실패 ${old.x},${old.y} → ${now.x},${now.y}`);
    await shot(page, kind, '4-rename');
  });

  await check(kind, '문법 오류 → 직전 그림 유지 + 오류 표시', async () => {
    const before = await state(page);
    const countBefore = await page.locator('.react-flow__node').count();
    let sawError = 0;
    for (const [i, bad] of sc.bad.entries()) {
      await setCode(page, bad);
      const s = await state(page);
      if (s.errors > 0) {
        sawError += 1;
        assert(JSON.stringify(s.nodes) === JSON.stringify(before.nodes), '오류 중 좌표가 바뀜');
        assert((await page.locator('.react-flow__node').count()) === countBefore, '오류 중 그림이 바뀜');
        assert((await page.getByRole('list', { name: '진단' }).count()) > 0, '진단 목록이 화면에 없음');
        if (i === 0) await shot(page, kind, '5-error');
      }
    }
    assert(sawError >= 1, '오류 진단이 한 번도 나오지 않음');
    await setCode(page, before.source); // 복구
    return `오류 입력 ${sawError}/${sc.bad.length}`;
  });

  await check(kind, '그룹 만들기', async () => {
    const before = await state(page);
    const [a, b] = await Promise.all(sc.members.map((m) => nodeBox(page, m)));
    const x0 = Math.min(a.x, b.x) - 25, y0 = Math.min(a.y, b.y) - 25;
    const x1 = Math.max(a.x + a.width, b.x + b.width) + 25, y1 = Math.max(a.y + a.height, b.y + b.height) + 25;
    await page.keyboard.down('Control');
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 5 });
    await page.mouse.move(x1, y1, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    await page.waitForTimeout(300);
    const sel = await page.evaluate(() => window.__hyuml.getState().selection);
    assert(sel.length >= 2, `Ctrl+드래그 선택 실패(선택 ${sel.length}개)`);
    await page.getByRole('button', { name: /^그룹/ }).click();
    await page.getByLabel('그룹 이름').fill('Team');
    await page.getByRole('button', { name: '묶기' }).click();
    await settle(page);
    const after = await state(page);
    assert(sc.group.test(after.source), `소스에 그룹 구문 없음:\n${after.source}`);
    for (const id of before.modelIds) assert(after.nodes[id].x === before.nodes[id].x, `${id} x 변동`);
    await shot(page, kind, '6-group');
  });

  await check(kind, 'PNG 내보내기(300dpi)', async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.getByRole('button', { name: 'PNG', exact: true }).click(),
    ]);
    const file = path.join(shots, `${kind}-7-export.png`);
    await download.saveAs(file);
    const buf = readFileSync(file);
    assert(buf.subarray(1, 4).toString() === 'PNG', 'PNG 아님');
    const dpi = pngDpi(buf);
    assert(dpi >= 299 && dpi <= 301, `dpi=${dpi}`);
    return `${buf.length} bytes, ${dpi}dpi, ${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}px`;
  });

  await check(kind, '저장 후 불러오기', async () => {
    const saved = await state(page);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.getByRole('button', { name: '프로젝트 저장' }).click(),
    ]);
    const file = path.join(tmp, `${kind}-project.json`);
    await download.saveAs(file);
    const text = readFileSync(file, 'utf8');
    assert(text.includes('%%% graph') && text.includes('%%% layout'), '저장 파일에 코드 구역이 없음');
    await setCode(page, 'classDiagram\n  class Zed\n');
    await page.locator('input[type=file]').setInputFiles(file);
    await settle(page);
    const loaded = await state(page);
    assert(loaded.source === saved.source, '불러온 소스가 다름');
    for (const id of saved.modelIds) {
      assert(loaded.nodes[id] && loaded.nodes[id].x === saved.nodes[id].x && loaded.nodes[id].y === saved.nodes[id].y, `${id} 좌표 불일치`);
    }
    await shot(page, kind, '8-load');
  });

  await check(kind, '페이지 오류 없음', async () => {
    assert(pageErrors.length === 0, pageErrors.join(' | '));
  });
  await context.close();
}

const browser = await chromium.launch();
for (const [kind, sc] of Object.entries(SCENARIOS)) await runKind(browser, kind, sc);
await browser.close();

const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.kind.padEnd(9)} ${r.name}${r.note ? `  — ${r.note}` : ''}`);
console.log(lines.join('\n'));
writeFileSync(path.join(tmp, 'result.txt'), lines.join('\n'));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
