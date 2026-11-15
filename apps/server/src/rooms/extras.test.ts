import { describe, expect, it } from 'vitest';
import { COMPUTER_ID, WORD_CATEGORIES, type CreateRoomInput, type Stroke } from '@brainreader/shared';
import { hasDrawings } from '../content/words.ts';
import { collect, next, nextWhere, startServer, type Client } from '../testing.ts';

const FAST = { timing: { msPerSecond: 10, roundEndPauseMs: 50 } };
const ROOM: CreateRoomInput = { name: '한판', maxPlayers: 4, rounds: 1, roundTimeSec: 30 };
const STROKE: Stroke = { strokeId: 's1', color: '#111111', width: 0.01, points: [[0.1, 0.1], [0.5, 0.5]] };

async function readyAll(clients: Client[]) {
  for (const c of clients) expect(await c.emitWithAck('room:ready', true)).toEqual({ ok: true });
}

// alice가 그리고 bob이 맞히는 1라운드 게임을 끝까지 한다.
async function playOneGame(alice: Client, bob: Client, room: Partial<CreateRoomInput> = {}) {
  const created = await alice.emitWithAck('room:create', { ...ROOM, ...room });
  if (!created.ok) throw new Error(created.error);
  await bob.emitWithAck('room:join', { roomId: created.data.id });
  const word = next(alice, 'round:word');
  const ended = nextWhere(alice, 'game:event', (e) => e.type === 'gameEnded');
  await readyAll([alice, bob]);
  alice.emit('draw:stroke', STROKE);
  await next(bob, 'draw:stroke');
  expect(await bob.emitWithAck('room:chat', (await word).word)).toEqual({ ok: true });
  await ended;
  return created.data.id;
}

describe('단어 카테고리', () => {
  it('방 카테고리에 맞는 DB 단어가 나온다', async () => {
    const { db, login } = await startServer({ ...FAST, pickWord: undefined }); // 고정 단어 대신 DB를 쓴다
    const [alice, bob] = [await login('alice'), await login('bob')];
    const created = await alice.emitWithAck('room:create', { ...ROOM, category: '탈것' });
    if (!created.ok) throw new Error(created.error);
    await bob.emitWithAck('room:join', { roomId: created.data.id });
    const word = next(alice, 'round:word');
    await readyAll([alice, bob]);

    const vehicles = (db.prepare("SELECT word FROM words WHERE category = '탈것'").all() as { word: string }[]).map(
      (r) => r.word,
    );
    expect(vehicles).toContain((await word).word);
  });

  it('기본 단어가 카테고리마다 들어 있고 같은 단어는 다시 넣을 수 없다 (REVIEW S16, S17)', async () => {
    const { db } = await startServer();
    for (const category of WORD_CATEGORIES) {
      const { n } = db.prepare('SELECT count(*) AS n FROM words WHERE category = ?').get(category) as { n: number };
      expect(n).toBeGreaterThan(0);
    }
    expect(() => db.prepare("INSERT INTO words (category, word) VALUES ('동물', '고양이')").run()).toThrow();
  });
});

describe('랭킹', () => {
  it('끝까지 끝난 게임의 점수와 승리가 쌓이고, 응답에 비밀번호 해시가 없다 (REVIEW C13, X1)', async () => {
    const { app, login } = await startServer(FAST);
    const [alice, bob] = [await login('alice'), await login('bob')];
    await playOneGame(alice, bob);
    // 같은 방에서 한 판 더 한다. 이번에도 alice가 그리고 bob이 맞힌다(1라운드라 첫 출제자).
    const word = next(alice, 'round:word');
    const ended = nextWhere(alice, 'game:event', (e) => e.type === 'gameEnded');
    await readyAll([alice, bob]);
    await bob.emitWithAck('room:chat', (await word).word);
    await ended;

    const res = await app.fastify.inject({ method: 'GET', url: '/api/ranking' });
    expect(res.json().ranking).toEqual([
      { id: expect.any(String), username: 'bob', gamesPlayed: 2, wins: 2, totalScore: 20 },
      { id: expect.any(String), username: 'alice', gamesPlayed: 2, wins: 0, totalScore: 4 },
    ]);
    expect(res.body).not.toContain('password');
  });

  it('인원 부족으로 끝난 게임은 기록하지 않는다', async () => {
    const { app, login } = await startServer(FAST);
    const [alice, bob] = [await login('alice'), await login('bob')];
    const created = await alice.emitWithAck('room:create', ROOM);
    if (!created.ok) throw new Error(created.error);
    await bob.emitWithAck('room:join', { roomId: created.data.id });
    await readyAll([alice, bob]);
    const ended = nextWhere(alice, 'game:event', (e) => e.type === 'gameEnded');
    await bob.emitWithAck('room:leave');
    expect(await ended).toMatchObject({ reason: 'notEnoughPlayers' });

    const res = await app.fastify.inject({ method: 'GET', url: '/api/ranking' });
    expect(res.json().ranking).toEqual([]);
  });
});

describe('방 설정 수정', () => {
  async function room() {
    const { login } = await startServer(FAST);
    const [alice, bob] = [await login('alice'), await login('bob')];
    const created = await alice.emitWithAck('room:create', ROOM);
    if (!created.ok) throw new Error(created.error);
    await bob.emitWithAck('room:join', { roomId: created.data.id });
    return { alice, bob };
  }
  const SETTINGS = { name: '바꾼 방', maxPlayers: 3, rounds: 2, roundTimeSec: 40, category: '음식' as const };

  it('방장이 바꾸면 방 안의 모두에게 반영된다', async () => {
    const { alice, bob } = await room();
    const seen = nextWhere(bob, 'room:state', (r) => r.name === '바꾼 방');
    const res = await alice.emitWithAck('room:update', SETTINGS);
    expect(res).toMatchObject({ ok: true, data: { name: '바꾼 방', maxPlayers: 3, rounds: 2, roundTimeSec: 40, category: '음식' } });
    expect(await seen).toMatchObject({ rounds: 2, game: { rounds: 2 } });
  });

  it('방장이 아니면 바꿀 수 없다', async () => {
    const { bob } = await room();
    expect(await bob.emitWithAck('room:update', SETTINGS)).toEqual({ ok: false, error: 'notHost' });
  });

  it('방장이 나가면 다음 사람이 방장이 된다', async () => {
    const { alice, bob } = await room();
    const state = nextWhere(bob, 'room:state', (r) => r.game.players.length === 1);
    await alice.emitWithAck('room:leave');
    const view = await state;
    expect(view.hostId).toBe(view.game.players[0]!.id);
    expect(await bob.emitWithAck('room:update', SETTINGS)).toMatchObject({ ok: true });
  });

  it('지금 인원보다 정원을 줄이거나 게임 중에 바꿀 수 없다', async () => {
    const { alice, bob } = await room();
    expect(await alice.emitWithAck('room:update', { ...SETTINGS, maxPlayers: 1 })).toEqual({
      ok: false,
      error: 'invalidInput',
    });
    await readyAll([alice, bob]);
    expect(await alice.emitWithAck('room:update', SETTINGS)).toEqual({ ok: false, error: 'notInLobby' });
  });
});

describe('그림 저장과 컴퓨터 모드', () => {
  it('저장된 그림이 없으면 컴퓨터 방을 만들 수 없다', async () => {
    const { login } = await startServer(FAST);
    const alice = await login('alice');
    expect(await alice.emitWithAck('room:create', { ...ROOM, mode: 'computer' })).toEqual({
      ok: false,
      error: 'noDrawings',
    });
  });

  it('아무도 못 맞힌 그림은 저장하지 않는다', async () => {
    const { db, login } = await startServer(FAST);
    const [alice, bob] = [await login('alice'), await login('bob')];
    const created = await alice.emitWithAck('room:create', ROOM);
    if (!created.ok) throw new Error(created.error);
    await bob.emitWithAck('room:join', { roomId: created.data.id });
    const ended = nextWhere(alice, 'game:event', (e) => e.type === 'gameEnded');
    await readyAll([alice, bob]);
    alice.emit('draw:stroke', STROKE);
    await ended; // 시간 초과
    expect(hasDrawings(db, null)).toBe(false);
  });

  it('맞힌 그림을 컴퓨터가 다시 그리고, 혼자서 맞힐 수 있다 (REVIEW S9, S19)', async () => {
    const { login } = await startServer(FAST);
    const [alice, bob, carol] = [await login('alice'), await login('bob'), await login('carol')];
    await playOneGame(alice, bob);

    const created = await carol.emitWithAck('room:create', { ...ROOM, mode: 'computer' });
    expect(created).toMatchObject({ ok: true, data: { mode: 'computer' } });
    const started = nextWhere(carol, 'game:event', (e) => e.type === 'roundStarted');
    const replayed = next(carol, 'draw:stroke');
    const words = collect(carol, 'round:word', 100); // 컴퓨터 방에서는 아무에게도 정답이 가지 않는다
    await readyAll([carol]);

    expect(await started).toMatchObject({ drawerId: COMPUTER_ID });
    expect(await replayed).toEqual(STROKE);
    expect(await words).toEqual([]);

    const correct = nextWhere(carol, 'game:event', (e) => e.type === 'correctGuess');
    expect(await carol.emitWithAck('room:chat', '사과')).toEqual({ ok: true });
    expect(await correct).toMatchObject({ points: 10, drawerPoints: 0 });
  });
});
