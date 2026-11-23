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
    base: 'classDiagram\n  class Alpha\n  class Beta\n  class Gamma\n  class Solo\n  Alpha --> Beta\n  Beta --> Gamma\n',
    isolated: 'Solo',
    add: (s) => `${s}  class Delta\n  Gamma --> Delta\n`,
    renameFrom: 'Delta', renameTo: 'Epsilon',
    bad: ['class Foo', 'classDiagram\n  class Alpha {\n    +x: int\n'],
    group: /namespace\s+\S+/, members: ['Beta', 'Gamma'], dragNode: 'Beta',
    canvas: { aria: '클래스 이름 Alpha', to: 'Alpine', oldId: 'Alpha', newId: 'Alpine', expected: (s) => s.replace(/\bAlpha\b/g, 'Alpine') },
  },
  usecase: {
    base: 'usecase-beta\n  actor User\n  actor Guest\n  Login\n  Pay\n  User --> Login\n  Login --> Pay\n',
    isolated: 'Guest',
    add: (s) => `${s}  Refund\n  Pay --> Refund\n`,
    renameFrom: 'Refund', renameTo: 'Cancel',
    bad: ['hello world', 'usecase-beta\n  systemBoundary Shop\n    Login\n'],
    group: /systemBoundary\s+\S+/, members: ['Login', 'Pay'], dragNode: 'Login',
    canvas: { aria: '액터 이름 User', to: 'Member', oldId: 'User', newId: 'Member', expected: (s) => s.replace(/\bUser\b/g, 'Member') },
  },
  sequence: {
    base: 'sequenceDiagram\n  participant A as Alice\n  participant B as Bob\n  participant C as Carol\n  participant Idle\n  A->>B: hi\n  B->>C: yo\n',
    isolated: 'Idle',
    add: (s) => `${s}  participant D\n  C->>D: ping\n`,
    renameFrom: 'D', renameTo: 'E',
    bad: ['hello world', 'sequenceDiagram\n  loop retry\n    A->>B: x\n'],
    group: /box\s/, members: ['A', 'B'], dragNode: 'B',
    canvas: { aria: '참여자 이름 Alice', to: 'Alicia', oldId: 'A', newId: 'A', expected: (s) => s.replace('as Alice', 'as Alicia') },
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
    assert(count >= 4, `노드 ${count}개`);
    assert((await page.locator(`.react-flow__node[data-id="${sc.isolated}"]`).count()) === 1, `고립 도형 ${sc.isolated} 이(가) 화면에 없음`);
    assert(!/"x"|layout/.test(st.source), '코드 창에 좌표/레이아웃 노출');
    await shot(page, kind, '1-render');
    return `노드 ${count}개`;
  });

  await check(kind, '캔버스에서 이름 수정 → 코드의 해당 부분만 변경', async () => {
    const before = await state(page);
    const c = sc.canvas;
    // 유스케이스·시퀀스 라벨은 평소 버튼이고, 클릭하면 입력창으로 바뀐다
    const toggle = page.getByLabel(`${c.aria} 편집`, { exact: true });
    if ((await toggle.count()) > 0) await toggle.click();
    const input = page.getByLabel(c.aria, { exact: true });
    await input.fill(c.to);
    await input.press('Enter');
    await settle(page);
    const after = await state(page);
    assert(after.source === c.expected(before.source), `소스 불일치:\n${after.source}`);
    const a = before.nodes[c.oldId], b = after.nodes[c.newId];
    assert(b && a.x === b.x && (kind === 'sequence' || a.y === b.y), '이름 수정 후 좌표가 달라짐');
    await shot(page, kind, '1b-canvas-rename');
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

/** 도형 바깥으로 꺾인 연결선도 내보내기 이미지에 포함되는지 (이미지가 꺾이지 않은 경우보다 커야 한다) */
async function runExportClip(browser) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => window.__hyuml, null, { timeout: 30000 });
  await page.locator('.monaco-editor').first().waitFor({ timeout: 30000 });
  await setCode(page, 'classDiagram\n  class Alpha\n  class Beta\n  Alpha --> Beta\n');
  const exportSize = async (name) => {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.getByRole('button', { name: 'PNG', exact: true }).click(),
    ]);
    const file = path.join(shots, name);
    await download.saveAs(file);
    const buf = readFileSync(file);
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), dpi: pngDpi(buf) };
  };
  await check('class', '바깥으로 꺾인 연결선이 내보내기에서 잘리지 않음', async () => {
    const plain = await exportSize('class-10-export-plain.png');
    await page.evaluate(() => {
      const s = window.__hyuml.getState();
      const edge = s.model.edges[0];
      const n = Object.values(s.doc.layout.nodes);
      const maxX = Math.max(...n.map((r) => r.x + r.w)), maxY = Math.max(...n.map((r) => r.y + r.h));
      s.setEdgeWaypoints(edge.id, [{ x: maxX + 400, y: maxY + 300 }]);
    });
    await page.waitForTimeout(500);
    const bent = await exportSize('class-11-export-bent.png');
    assert(bent.w > plain.w + 300 && bent.h > plain.h + 200, `이미지가 커지지 않음 ${plain.w}x${plain.h} → ${bent.w}x${bent.h}`);
    assert(bent.dpi >= 299 && bent.dpi <= 301, `dpi=${bent.dpi}`);
    return `${plain.w}x${plain.h} → ${bent.w}x${bent.h}`;
  });
  await context.close();
}

/** 글꼴 24pt 로 올려도 도형 상자가 겹치지 않는지 (글꼴 변경 직후, 자동 정렬 후) */
async function runFontOverlap(browser) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const page = await context.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => window.__hyuml, null, { timeout: 30000 });
  await page.locator('.monaco-editor').first().waitFor({ timeout: 30000 });
  await setCode(page, 'classDiagram\n  class Order {\n    +int id\n    +String customerName\n    +calculateTotal()\n  }\n  class Item {\n    +String name\n    +int price\n  }\n  class Lonely\n  Order --> Item\n');
  const overlaps = () => page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.react-flow__node')].map((e) => ({ id: e.dataset.id, r: e.getBoundingClientRect() }));
    const out = [];
    for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i].r, b = boxes[j].r;
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) out.push(`${boxes[i].id}~${boxes[j].id}`);
    }
    return out;
  });
  await check('class', '글꼴 24pt 변경 직후 상자가 겹치지 않음', async () => {
    await page.getByLabel('다이어그램 글꼴 크기').selectOption('24');
    await settle(page);
    const o = await overlaps();
    await shot(page, 'class', '12-font24');
    assert(o.length === 0, `겹침: ${o.join(', ')}`);
  });
  await check('class', '글꼴 24pt 자동 정렬 후 상자가 겹치지 않음', async () => {
    await page.getByRole('button', { name: /자동 정렬/ }).click();
    await page.waitForTimeout(1500);
    const o = await overlaps();
    assert(o.length === 0, `겹침: ${o.join(', ')}`);
  });
  await context.close();
}

/** D4(그룹 2개 이상)·D5(제목 색 팔레트)·D7(제목 위 드래그) */
async function runInteractions(browser) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const page = await context.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => window.__hyuml, null, { timeout: 30000 });
  await page.locator('.monaco-editor').first().waitFor({ timeout: 30000 });
  await setCode(page, 'classDiagram\n  class Alpha\n  class Beta\n  Alpha --> Beta\n');
  const nodeOf = (id) => page.evaluate((n) => JSON.stringify(window.__hyuml.getState().doc.layout.nodes[n]), id);

  await check('class', '제목 위에서 드래그하면 상자가 이동하고 편집 상태가 되지 않음', async () => {
    const before = JSON.parse(await nodeOf('Alpha'));
    const input = page.getByLabel('클래스 이름 Alpha', { exact: true });
    const box = await input.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + 70, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = JSON.parse(await nodeOf('Alpha'));
    assert(after.x !== before.x || after.y !== before.y, '상자가 움직이지 않음');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    assert(focused !== '클래스 이름 Alpha', '드래그 후 제목이 편집 상태');
    const src = await page.evaluate(() => window.__hyuml.getState().doc.source);
    assert(src.includes('class Alpha'), '소스가 바뀜');
  });

  await check('class', '제목 클릭은 편집, 제목 색 팔레트에서 DKU 블루 제외 + 기본색 버튼', async () => {
    const input = page.getByLabel('클래스 이름 Alpha', { exact: true });
    await input.click();
    assert((await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === '클래스 이름 Alpha', '클릭해도 편집이 시작되지 않음');
    assert((await page.getByLabel('글자 색 DKU 블루').count()) === 0, '제목 팔레트에 DKU 블루가 있음');
    assert((await page.getByLabel('글자 색 노랑').count()) === 1, '노랑이 없음');
    await page.getByLabel('글자 색 노랑').dispatchEvent('mousedown');
    await page.waitForTimeout(200);
    const key = 'node:Alpha/title';
    const red = await page.evaluate((k) => window.__hyuml.getState().doc.layout.textStyles[k]?.color, key);
    assert(red === '#ffd54f', `색 미적용 ${red}`);
    await page.getByLabel('글자색 기본값으로').dispatchEvent('mousedown');
    await page.waitForTimeout(200);
    const reset = await page.evaluate((k) => window.__hyuml.getState().doc.layout.textStyles[k]?.color, key);
    assert(reset === undefined, `기본색 복원 실패 ${reset}`);
    await shot(page, 'class', '13-title-palette');
    await page.keyboard.press('Escape');
  });

  await check('class', '그룹 버튼은 도형 1개 선택에서 비활성, 2개부터 활성', async () => {
    const button = page.getByRole('button', { name: /^그룹/ });
    await page.evaluate(() => window.__hyuml.getState().setSelection([]));
    await page.evaluate(() => window.__hyuml.getState().setSelection(['Alpha']));
    await page.waitForTimeout(200);
    assert(await button.isDisabled(), '1개 선택인데 활성');
    await page.evaluate(() => window.__hyuml.getState().setSelection(['Alpha', 'Beta']));
    await page.waitForTimeout(200);
    assert(await button.isEnabled(), '2개 선택인데 비활성');
  });
  await context.close();
}

/** N-01: 글꼴 8~24pt 전 구간에서 클래스 상자의 가장 긴 줄이 잘리지 않는지 */
async function runFontWidth(browser) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const page = await context.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => window.__hyuml, null, { timeout: 30000 });
  await page.locator('.monaco-editor').first().waitFor({ timeout: 30000 });
  await setCode(page, 'classDiagram\n  class Order {\n    +id: string\n    +total: number\n    +pay(amount: number) bool\n  }\n  class Item\n  class Lonely\n  Order --> Item\n');
  await check('class', '글꼴 8~24pt 에서 멤버 줄이 잘리지 않음', async () => {
    const widths = [];
    for (const pt of [8, 10, 12, 16, 20, 24]) {
      await page.getByLabel('다이어그램 글꼴 크기').selectOption(String(pt));
      await page.waitForTimeout(600);
      const clipped = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node[data-id="Order"] input')]
        .filter((i) => i.scrollWidth > i.clientWidth).map((i) => i.value));
      assert(clipped.length === 0, `${pt}pt 잘림: ${clipped.join(' | ')}`);
      widths.push(`${pt}pt=${Math.round((await page.evaluate(() => window.__hyuml.getState().doc.layout.nodes.Order.w)))}`);
    }
    await shot(page, 'class', '14-font-width-24');
    return widths.join(' ');
  });
  await check('class', '24pt 에서 최소 폭까지 줄여도 잘리지 않음', async () => {
    await page.evaluate(() => window.__hyuml.getState().resizeNode('Order', { w: 50 }));
    await page.waitForTimeout(500);
    const w = await page.evaluate(() => window.__hyuml.getState().doc.layout.nodes.Order.w);
    const clipped = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node[data-id="Order"] input')].filter((i) => i.scrollWidth > i.clientWidth).map((i) => i.value));
    assert(w > 360, `최소 폭이 글자보다 좁음 ${w}`);
    assert(clipped.length === 0, `잘림: ${clipped.join(' | ')}`);
    return `최소 폭 ${w}`;
  });
  await context.close();
}

/** 서식 툴바: 전체 글꼴 통일, 관계선 툴바 유지(+/-), 선택된 클래스 위에 표시 */
async function runFormatToolbar(browser) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const page = await context.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => window.__hyuml, null, { timeout: 30000 });
  await page.locator('.monaco-editor').first().waitFor({ timeout: 30000 });
  await setCode(page, 'classDiagram\n  class Order\n  class Item\n  Order --> Item : uses\n');
  const label = page.getByLabel('관계 라벨 Order → Item', { exact: true });
  const toolbar = page.locator('[role=toolbar][aria-label=서식]');
  const edgeKey = 'edge:Order|association|Item|uses/label';
  const fontOf = (key) => page.evaluate((k) => window.__hyuml.getState().doc.layout.textStyles[k]?.fontSize, key);

  await check('class', '관계선 서식 툴바: 글꼴 +/- 를 눌러도 툴바가 유지되고 크기가 바뀜', async () => {
    await label.click();
    await page.waitForTimeout(300);
    assert((await toolbar.count()) === 1, '클릭해도 툴바가 안 뜸');
    const plus = page.getByLabel('글자 크게');
    for (let i = 0; i < 2; i += 1) {
      const box = await plus.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(250);
      assert((await toolbar.count()) === 1, `${i + 1}번째 + 후 툴바가 사라짐`);
    }
    const size = await fontOf(edgeKey);
    assert(size === 12, `글자 크기 ${size} (기대 12)`);
    const minus = page.getByLabel('글자 작게');
    const mb = await minus.boundingBox();
    await page.mouse.click(mb.x + mb.width / 2, mb.y + mb.height / 2);
    await page.waitForTimeout(250);
    assert((await toolbar.count()) === 1 && (await fontOf(edgeKey)) === 11, '- 후 툴바/크기 이상');
    await shot(page, 'class', '15-edge-toolbar');
  });

  await check('class', '클래스 선택 상태에서 관계선을 클릭해도 서식 툴바가 도형 위에 표시됨', async () => {
    await page.evaluate(() => document.activeElement?.blur());
    await page.evaluate(() => window.__hyuml.getState().setSelection([]));
    // 선택된 Order 상자를 크게 키워 툴바가 뜰 자리를 덮게 한다 (옮기면 경로·라벨이 바뀌므로 측정→배치를 몇 번 반복)
    const scaleOf = () => page.evaluate(() => {
      const el = document.querySelector('.react-flow__node[data-id="Order"]').getBoundingClientRect();
      const n = window.__hyuml.getState().doc.layout.nodes.Order;
      return { scale: el.width / n.w, ox: el.x - n.x * (el.width / n.w), oy: el.y - n.y * (el.width / n.w) };
    });
    let target = await (async () => { await label.click(); await page.waitForTimeout(300); return toolbar.boundingBox(); })();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.evaluate(() => { document.activeElement?.blur(); window.__hyuml.getState().setSelection([]); });
      const g = await scaleOf();
      const cx = (target.x + target.width / 2 - g.ox) / g.scale;
      // 상자 아래 가장자리를 툴바 아래쪽 4분의 3 지점에 둔다 — 툴바 중심은 덮지만 라벨(툴바 아래)은 덮지 않아 클릭할 수 있다
      const bottom = (target.y + target.height * 0.75 - g.oy) / g.scale;
      await page.evaluate(({ cx, bottom }) => {
        const s = window.__hyuml.getState();
        s.resizeNode('Order', { x: cx - 600, y: bottom - 1200, w: 1200, h: 1200 });
        s.setSelection(['Order']);
      }, { cx, bottom });
      await page.waitForTimeout(500);
      await label.click();
      await page.waitForTimeout(400);
      target = await toolbar.boundingBox();
    }
    assert((await toolbar.count()) === 1, '툴바가 안 뜸');
    const tb = await toolbar.boundingBox();
    const order = await page.locator('.react-flow__node[data-id="Order"]').boundingBox();
    const cx = tb.x + tb.width / 2, cy = tb.y + tb.height / 2;
    assert(cx > order.x && cx < order.x + order.width && cy > order.y && cy < order.y + order.height, '툴바가 도형과 겹치지 않아 검증 불가');
    const onTop = await page.evaluate(({ cx, cy }) => !!document.elementFromPoint(cx, cy)?.closest('[role=toolbar][aria-label=서식]'), { cx, cy });
    await shot(page, 'class', '16-toolbar-over-node');
    assert(onTop, '서식 툴바가 선택된 도형 뒤에 가려짐');
  });

  await check('class', '전체 글꼴을 바꾸면 개별 글꼴이 통일되고 이후 개별 변경도 가능', async () => {
    await page.evaluate(() => { document.activeElement?.blur(); window.__hyuml.getState().setSelection([]); });
    await page.evaluate(() => { const s = window.__hyuml.getState(); s.updateTextStyle('node:Order/title', { fontSize: 20 }); });
    await page.getByLabel('다이어그램 글꼴 크기').selectOption('14');
    await page.waitForTimeout(500);
    const left = await page.evaluate(() => Object.entries(window.__hyuml.getState().doc.layout.textStyles).filter(([, v]) => v.fontSize !== undefined).map(([k]) => k));
    assert(left.length === 0, `개별 글꼴이 남음: ${left.join(', ')}`);
    await page.evaluate(() => window.__hyuml.getState().updateTextStyle('node:Order/title', { fontSize: 18 }));
    assert((await fontOf('node:Order/title')) === 18, '이후 개별 변경 실패');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
  });
  await context.close();
}

const browser = await chromium.launch();
for (const [kind, sc] of Object.entries(SCENARIOS)) await runKind(browser, kind, sc);
await runExportClip(browser);
await runFontOverlap(browser);
await runInteractions(browser);
await runFontWidth(browser);
await runFormatToolbar(browser);
await browser.close();

const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.kind.padEnd(9)} ${r.name}${r.note ? `  — ${r.note}` : ''}`);
console.log(lines.join('\n'));
writeFileSync(path.join(tmp, 'result.txt'), lines.join('\n'));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
