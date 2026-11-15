import { randomUUID } from 'node:crypto';
import type { RoomMode, RoomSummary, RoomView, Stroke, WordCategory } from '@brainreader/shared';
import { Game } from '../game/game.ts';
import type { SavedDrawing } from '../content/words.ts';

export interface RoomSettings {
  name: string;
  maxPlayers: number;
  rounds: number;
  roundTimeSec: number;
  category: WordCategory | null;
}

export interface NewRoom extends RoomSettings {
  passwordHash: string | null;
  mode: RoomMode;
}

export interface Room extends NewRoom {
  id: string;
  game: Game; // 방에 누가 있는지는 game의 플레이어 목록 하나로만 관리한다.
  strokes: Stroke[]; // 이번 라운드에 그린 획. 늦게 들어온 사람에게 다시 보낸다.
  timer?: ReturnType<typeof setTimeout>; // 다음 시간 전이(시간 초과, 다음 라운드)를 깨우는 타이머
  // 컴퓨터 모드: 이번 라운드에 다시 그릴 그림과, 그 획을 조금씩 내보내는 타이머.
  replay?: Stroke[];
  replayTimer?: ReturnType<typeof setInterval>;
  replayMs: number; // 그림 전체를 다시 그리는 데 쓰는 시간
}

export interface RoomTiming {
  roundEndPauseMs: number;
  msPerSecond: number; // 테스트에서 시간을 줄이려고만 바꾼다. 실제 서버는 1000.
}

// 방이 제시어와 그림을 얻는 곳. 실제 서버는 DB, 테스트는 고정 값을 넘긴다.
export interface RoomContent {
  pickWord(category: WordCategory | null): string;
  pickDrawing(category: WordCategory | null): SavedDrawing | null;
}

const DEFAULT_TIMING: RoomTiming = { roundEndPauseMs: 3_000, msPerSecond: 1_000 };

// 컴퓨터는 제한 시간의 절반, 길어도 10초 안에 그림을 다 그린다.
const MAX_REPLAY_SEC = 10;

// 방은 서버 메모리에만 있다. 서버가 재시작하면 방은 사라지고 유저와 단어(DB)만 남는다.
export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly content: RoomContent,
    private readonly timing: RoomTiming = DEFAULT_TIMING,
  ) {}

  create(settings: NewRoom): Room {
    const room = { ...settings, id: randomUUID(), strokes: [], replayMs: this.replayMs(settings) } as Omit<Room, 'game'> as Room;
    // 단어 뽑기는 방의 현재 카테고리를 본다. 방장이 시작 전에 카테고리를 바꾸면 다음 게임부터 반영된다.
    const pickWord =
      room.mode === 'computer'
        ? () => {
            const drawing = this.content.pickDrawing(room.category);
            if (!drawing) throw new Error('noDrawings'); // 방을 만들 때 확인했고 그림은 지워지지 않는다
            room.replay = drawing.strokes;
            return drawing.word;
          }
        : () => this.content.pickWord(room.category);
    room.game = new Game(
      {
        maxPlayers: settings.maxPlayers,
        rounds: settings.rounds,
        roundTimeMs: settings.roundTimeSec * this.timing.msPerSecond,
        roundEndPauseMs: this.timing.roundEndPauseMs,
        computerDraws: settings.mode === 'computer',
      },
      pickWord,
    );
    this.rooms.set(room.id, room);
    return room;
  }

  // 게임 시작 전에만 된다. 규칙 위반이면 Game이 GameError를 던지고 방은 그대로다.
  update(room: Room, settings: RoomSettings) {
    room.game.configure({
      maxPlayers: settings.maxPlayers,
      rounds: settings.rounds,
      roundTimeMs: settings.roundTimeSec * this.timing.msPerSecond,
    });
    Object.assign(room, settings, { replayMs: this.replayMs(settings) });
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  // 방을 지울 때 타이머도 같이 지운다. 안 지우면 사라진 방의 타이머가 나중에 깨어난다.
  delete(id: string) {
    const room = this.rooms.get(id);
    if (room?.timer) clearTimeout(room.timer);
    if (room?.replayTimer) clearInterval(room.replayTimer);
    this.rooms.delete(id);
  }

  summaries(): RoomSummary[] {
    return [...this.rooms.values()].map((room) => {
      const { players, phase } = room.game.snapshot();
      return {
        id: room.id,
        name: room.name,
        locked: room.passwordHash !== null,
        playerCount: players.length,
        maxPlayers: room.maxPlayers,
        playing: phase.kind !== 'lobby',
        mode: room.mode,
        category: room.category,
      };
    });
  }

  view(room: Room): RoomView {
    const game = room.game.snapshot();
    return {
      id: room.id,
      name: room.name,
      locked: room.passwordHash !== null,
      maxPlayers: room.maxPlayers,
      rounds: room.rounds,
      roundTimeSec: room.roundTimeSec,
      mode: room.mode,
      category: room.category,
      hostId: game.players[0]?.id ?? null,
      game,
    };
  }

  private replayMs(settings: RoomSettings) {
    return Math.min(settings.roundTimeSec / 2, MAX_REPLAY_SEC) * this.timing.msPerSecond;
  }
}
