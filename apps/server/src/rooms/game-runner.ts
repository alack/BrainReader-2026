import type { Db } from '../db.ts';
import { recordGame } from '../content/ranking.ts';
import { saveDrawing } from '../content/words.ts';
import type { GameEvent } from '../game/game.ts';
import type { Presence } from '../presence.ts';
import type { AppServer } from '../socket-types.ts';
import type { Room, RoomManager } from './room-manager.ts';

export const roomChannel = (roomId: string) => `room:${roomId}`;

// 컴퓨터가 그림을 다시 그릴 때 획을 내보내는 간격.
const REPLAY_TICK_MS = 50;

// Game이 돌려준 이벤트를 소켓 메시지로 바꾸고, 다음 시간 전이를 예약한다.
// Game은 "무슨 일이 일어났는가"만 말하고, "누구에게 보내는가"는 여기서 정한다.
// 게임 결과(랭킹)와 그림 저장도 여기서 한다. Game은 DB를 모르고, 게임 종료와 라운드 종료를 이벤트로 알려 줄 뿐이다.
export function createGameRunner({
  io,
  rooms,
  presence,
  db,
}: {
  io: AppServer;
  rooms: RoomManager;
  presence: Presence;
  db: Db;
}) {
  const emitRoomState = (room: Room) => {
    io.to(roomChannel(room.id)).emit('room:state', rooms.view(room));
  };

  const apply = (room: Room, events: GameEvent[]) => {
    const channel = io.to(roomChannel(room.id));
    for (const event of events) {
      switch (event.type) {
        case 'wordAssigned':
          // 정답 단어는 출제자 소켓 하나에만 보낸다.
          presence.get(event.drawerId)?.emit('round:word', { round: event.round, word: event.word });
          break;
        case 'chat': {
          const sender = room.game.snapshot().players.find((p) => p.id === event.playerId);
          channel.emit('room:chat', {
            userId: event.playerId,
            username: sender?.name ?? '',
            text: event.text,
            sentAt: Date.now(),
          });
          break;
        }
        case 'roundStarted':
          stopReplay(room);
          room.strokes = [];
          channel.emit('draw:clear');
          channel.emit('game:event', event);
          if (room.mode === 'computer') startReplay(room);
          break;
        case 'roundEnded':
          stopReplay(room);
          // 사람이 그렸고 누군가 맞힌 그림만 컴퓨터 모드 문제로 남긴다.
          if (room.mode === 'normal' && event.correctIds.length > 0 && room.strokes.length > 0) {
            saveDrawing(db, event.word, room.strokes, Date.now());
          }
          channel.emit('game:event', event);
          break;
        case 'gameEnded':
          stopReplay(room);
          // 끝까지 진행한 일반 게임만 랭킹에 반영한다. 혼자 하는 컴퓨터 모드나 중간에 끝난 게임은 넣지 않는다.
          if (room.mode === 'normal' && event.reason === 'finished') recordGame(db, event.ranking);
          channel.emit('game:event', event);
          break;
        default:
          channel.emit('game:event', event);
      }
    }
    // 채팅만 있었다면 방 상태는 그대로다.
    if (events.some((e) => e.type !== 'chat')) emitRoomState(room);
    schedule(room);
  };

  // 방마다 타이머는 하나뿐이다. 다음에 깨어날 시각은 Game이 알려 준다 (REVIEW 2-4).
  const schedule = (room: Room) => {
    if (room.timer) clearTimeout(room.timer);
    room.timer = undefined;
    const deadline = room.game.nextDeadline();
    if (deadline === null) return;
    room.timer = setTimeout(
      () => {
        room.timer = undefined;
        if (rooms.get(room.id) !== room) return; // 그 사이 방이 사라졌다
        apply(room, room.game.tick(Date.now()));
      },
      Math.max(0, deadline - Date.now()),
    );
  };

  // 저장된 그림의 획을 replayMs에 걸쳐 나눠 보낸다. 사람이 그릴 때와 같은 draw:stroke 이벤트라
  // 클라이언트는 출제자가 사람인지 컴퓨터인지 구분하지 않고 그린다.
  const startReplay = (room: Room) => {
    const strokes = room.replay ?? [];
    room.replay = undefined;
    if (strokes.length === 0) return;
    const ticks = Math.max(1, Math.floor(room.replayMs / REPLAY_TICK_MS));
    const perTick = Math.ceil(strokes.length / ticks);
    let sent = 0;
    room.replayTimer = setInterval(() => {
      if (rooms.get(room.id) !== room) return stopReplay(room);
      for (const stroke of strokes.slice(sent, sent + perTick)) {
        room.strokes.push(stroke); // 늦게 들어온 사람도 draw:sync로 받는다
        io.to(roomChannel(room.id)).emit('draw:stroke', stroke);
      }
      sent += perTick;
      if (sent >= strokes.length) stopReplay(room);
    }, REPLAY_TICK_MS);
  };

  const stopReplay = (room: Room) => {
    if (room.replayTimer) clearInterval(room.replayTimer);
    room.replayTimer = undefined;
  };

  return { apply, emitRoomState };
}

export type GameRunner = ReturnType<typeof createGameRunner>;
