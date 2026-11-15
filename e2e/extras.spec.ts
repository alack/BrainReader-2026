import { expect, test, type Page } from '@playwright/test';

// v0.07 기능: 랭킹, 그림 저장과 컴퓨터 모드, 프로필 이미지, 방 설정 수정.

// 4×4 빨간 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGM4o6QERwzEcQDE4xEBYJBBnwAAAABJRU5ErkJggg==',
  'base64',
);

async function signUp(page: Page, username: string) {
  await page.goto('/');
  await page.getByRole('button', { name: '회원가입' }).click();
  await page.getByLabel('아이디').fill(username);
  await page.getByLabel('비밀번호').fill('password123');
  await page.getByRole('button', { name: '가입하고 시작' }).click();
  await expect(page.getByTestId('status')).toHaveText('서버 연결됨');
}

async function createRoom(page: Page, name: string, options: { rounds?: string; mode?: string } = {}) {
  await page.getByRole('button', { name: '방 만들기' }).click();
  await page.getByLabel('방 이름', { exact: true }).fill(name);
  await page.getByLabel('라운드 수').fill(options.rounds ?? '1');
  await page.getByLabel('제한 시간(초)').fill('30');
  if (options.mode) await page.getByLabel('모드').selectOption({ label: options.mode });
  await page.getByRole('button', { name: '만들기', exact: true }).click();
  await expect(page.getByTestId('room-name')).toContainText(name);
}

async function join(page: Page, roomName: string) {
  await page
    .getByTestId('room-list')
    .getByRole('listitem')
    .filter({ hasText: roomName })
    .getByRole('button', { name: '입장' })
    .click();
  await expect(page.getByTestId('room-name')).toContainText(roomName);
}

async function hasInk(page: Page) {
  return page.getByTestId('canvas').evaluate((c: HTMLCanvasElement) => {
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < data.length; i += 4) if (data[i]! < 200) return true;
    return false;
  });
}

async function say(page: Page, text: string) {
  await page.getByLabel('채팅 입력').fill(text);
  await page.getByLabel('채팅 입력').press('Enter');
}

test('게임 결과가 랭킹에 쌓이고, 맞힌 그림을 컴퓨터 모드에서 다시 맞힌다', async ({ browser }) => {
  test.setTimeout(120_000); // 컴퓨터 방에서 다른 테스트의 그림이 나오면 시간 초과(30초)까지 기다린다
  const id = crypto.randomUUID().slice(0, 6); // 동시에 도는 테스트끼리 아이디가 겹치지 않게 한다
  const [drawerName, guesserName] = [`c${id}`, `d${id}`];
  const drawer = await (await browser.newContext()).newPage();
  const guesser = await (await browser.newContext()).newPage();
  await signUp(drawer, drawerName);
  await signUp(guesser, guesserName);

  // 일반 게임 한 판. 출제자가 그리고 상대가 맞히면 그 그림이 저장된다.
  await createRoom(drawer, `랭${id}`);
  await join(guesser, `랭${id}`);
  await drawer.getByRole('button', { name: '준비', exact: true }).click();
  await guesser.getByRole('button', { name: '준비', exact: true }).click();
  await expect(drawer.getByTestId('word')).not.toHaveText('…');
  const word = (await drawer.getByTestId('word').textContent())!;
  const box = (await drawer.getByTestId('canvas').boundingBox())!;
  await drawer.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await drawer.mouse.down();
  await drawer.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 10 });
  await drawer.mouse.up();
  await expect.poll(() => hasInk(guesser)).toBe(true);
  await say(guesser, word);
  await expect(guesser.getByTestId('ranking')).toContainText(`${guesserName} 10점`);

  // 대기실 랭킹에 반영된다.
  await guesser.getByRole('button', { name: '나가기' }).click();
  await drawer.getByRole('button', { name: '나가기' }).click();
  const board = guesser.getByTestId('ranking-board');
  await expect(board).toContainText(`${guesserName} 10점 (1판 1승)`);
  await expect(board).toContainText(`${drawerName} 2점 (1판 0승)`);

  // 컴퓨터 방. 혼자 준비해도 시작하고, 컴퓨터가 저장된 그림을 다시 그린다.
  await createRoom(guesser, `컴${id}`, { mode: '컴퓨터 그림 맞히기' });
  await expect(guesser.getByTestId('room-kind')).toContainText('컴퓨터 모드');
  await guesser.getByRole('button', { name: '준비', exact: true }).click();
  await expect(guesser.getByTestId('game-status')).toContainText('컴퓨터님이 그리는 중');
  await expect.poll(() => hasInk(guesser)).toBe(true);
  // 이 테스트에서 저장한 그림이 나왔으면 바로 맞히고, 다른 테스트의 그림이면 시간 초과로 끝난다.
  await say(guesser, word);
  await expect(guesser.getByTestId('answer')).toBeVisible({ timeout: 40_000 });
  await expect(guesser.getByTestId('ranking')).toBeVisible({ timeout: 10_000 });

  // 컴퓨터 모드 결과는 랭킹에 넣지 않는다.
  await guesser.getByRole('button', { name: '나가기' }).click();
  await expect(guesser.getByTestId('ranking-board')).toContainText(`${guesserName} 10점 (1판 1승)`);
});

test('프로필 이미지를 올리고, 방장이 바꾼 방 설정이 다른 사람에게 보인다', async ({ browser }) => {
  const id = crypto.randomUUID().slice(0, 6); // 동시에 도는 테스트끼리 아이디가 겹치지 않게 한다
  const [hostName, guestName, roomName] = [`e${id}`, `f${id}`, `설${id}`];
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  await signUp(host, hostName);
  await signUp(guest, guestName);

  // 올린 이미지는 브라우저에서 96×96으로 줄어 저장된다.
  await host.getByLabel('프로필 사진 변경').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG });
  const myAvatar = host.locator('p img[data-testid^="avatar-"]');
  await expect(myAvatar).toBeVisible();
  await expect.poll(() => myAvatar.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(96);

  await createRoom(host, roomName);
  await join(guest, roomName);
  // 상대 화면의 참가자 목록에 방장의 프로필 이미지와 방장 표시가 보인다.
  const hostRow = guest.getByTestId('player-list').getByRole('listitem').filter({ hasText: hostName });
  await expect(hostRow.locator('img')).toBeVisible();
  await expect(hostRow).toContainText('👑');

  // 방장만 설정을 바꿀 수 있다.
  await expect(guest.getByRole('button', { name: '방 설정' })).toHaveCount(0);
  await host.getByRole('button', { name: '방 설정' }).click();
  await host.getByLabel('라운드 수').fill('2');
  await host.getByLabel('카테고리').selectOption('음식');
  await host.getByRole('button', { name: '저장' }).click();
  await expect(guest.getByText('2라운드 · 30초 · 최대 6명')).toBeVisible();
  await expect(guest.getByTestId('room-kind')).toContainText('카테고리 음식');
  await expect(guest.getByTestId('room-list')).toHaveCount(0); // 방 안이다

  // 게임이 시작되면 설정 버튼이 사라진다.
  await host.getByRole('button', { name: '준비', exact: true }).click();
  await guest.getByRole('button', { name: '준비', exact: true }).click();
  await expect(host.getByTestId('word')).not.toHaveText('…');
  await expect(host.getByRole('button', { name: '방 설정' })).toHaveCount(0);
});
