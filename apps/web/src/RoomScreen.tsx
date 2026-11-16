import { useEffect, useState, type FormEvent } from 'react';
import {
  COMPUTER_ID,
  roomSettingsSchema,
  type ChatMessage,
  type Player,
  type PublicUser,
  type RoomSettingsInput,
  type RoomView,
  type Stroke,
} from '@brainreader/shared';
import { Avatar } from './Avatar.tsx';
import { Canvas } from './Canvas.tsx';
import { RoomSettingsFields } from './RoomSettingsFields.tsx';
import { Chat } from './Chat.tsx';
import { clock } from './socket.ts';

// 서버가 정한 마감 시각까지 남은 초. 매초 서버가 알려 주지 않고 브라우저가 계산한다 (REVIEW 2-4).
function useSecondsLeft(endsAt: number | null) {
  const [now, setNow] = useState(clock.serverNow());
  useEffect(() => {
    if (endsAt === null) return;
    const id = window.setInterval(() => setNow(clock.serverNow()), 250);
    return () => window.clearInterval(id);
  }, [endsAt]);
  return endsAt === null ? null : Math.max(0, Math.ceil((endsAt - now) / 1000));
}

export function RoomScreen({
  me,
  room,
  word,
  strokes,
  ranking,
  messages,
  onLeave,
  onReady,
  onSendChat,
  onStroke,
  onClear,
  onUpdate,
  avatarVersion,
}: {
  me: PublicUser;
  room: RoomView;
  word: string | null;
  strokes: Stroke[];
  ranking: Player[] | null;
  messages: ChatMessage[];
  onLeave: () => void;
  onReady: (ready: boolean) => void;
  onSendChat: (text: string) => Promise<string | null>;
  onStroke: (stroke: Stroke) => void;
  onClear: () => void;
  onUpdate: (settings: RoomSettingsInput) => Promise<string | null>;
  avatarVersion: number;
}) {
  const { players, phase } = room.game;
  const myself = players.find((p) => p.id === me.id);
  const drawing = phase.kind === 'drawing' ? phase : null;
  const isDrawer = drawing?.drawerId === me.id;
  const correctIds = phase.kind === 'lobby' ? [] : phase.correctIds;
  const secondsLeft = useSecondsLeft(drawing ? drawing.endsAt : null);
  const drawerName =
    drawing?.drawerId === COMPUTER_ID ? '컴퓨터' : players.find((p) => p.id === drawing?.drawerId)?.name;
  const computer = room.mode === 'computer';
  const minPlayers = computer ? 1 : 2;
  const canEdit = phase.kind === 'lobby' && room.hostId === me.id;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 300px', gap: 16, alignItems: 'start' }}>
      <aside>
        <h2 data-testid="room-name">
          {room.name} {room.locked && '🔒'}
        </h2>
        <p>
          {room.rounds}라운드 · {room.roundTimeSec}초 · 최대 {room.maxPlayers}명
        </p>
        <p data-testid="room-kind">
          {computer ? '컴퓨터 모드' : '함께 그리기'} · 카테고리 {room.category ?? '전체'}
        </p>
        <ul data-testid="player-list" style={{ listStyle: 'none', padding: 0 }}>
          {players.map((p) => (
            <li key={p.id} style={{ padding: '4px 0' }}>
              {drawing?.drawerId === p.id && '✏️ '}
              {correctIds.includes(p.id) && '✅ '}
              {room.hostId === p.id && '👑 '}
              <Avatar userId={p.id} version={avatarVersion} /> <b>{p.name}</b> {p.score}점
              {phase.kind === 'lobby' && (p.ready ? ' · 준비' : ' · 대기')}
            </li>
          ))}
        </ul>
        {phase.kind === 'lobby' && myself && (
          <button onClick={() => onReady(!myself.ready)}>{myself.ready ? '준비 취소' : '준비'}</button>
        )}{' '}
        <button onClick={onLeave}>나가기</button>
        {canEdit && <SettingsEditor room={room} onUpdate={onUpdate} />}
      </aside>

      <section style={{ display: 'grid', gap: 8 }}>
        <div data-testid="game-status" style={{ minHeight: 28 }}>
          {phase.kind === 'lobby' &&
            (players.length < minPlayers ? '2명 이상 모이면 시작할 수 있습니다.' : '모두 준비하면 시작합니다.')}
          {drawing && (
            <>
              {drawing.round}/{room.rounds}라운드 · 남은 시간 <b data-testid="seconds-left">{secondsLeft}</b>초 ·{' '}
              {isDrawer ? (
                <>
                  제시어 <b data-testid="word">{word ?? '…'}</b>
                </>
              ) : (
                <>{drawerName}님이 그리는 중</>
              )}
            </>
          )}
          {phase.kind === 'roundEnd' && (
            <>
              정답은 <b data-testid="answer">{phase.word}</b>
            </>
          )}
        </div>
        <Canvas strokes={strokes} canDraw={isDrawer} onStroke={onStroke} onClear={onClear} />
        {phase.kind === 'lobby' && ranking && (
          <div data-testid="ranking">
            <h3>지난 게임 결과</h3>
            <ol>
              {ranking.map((p) => (
                <li key={p.id}>
                  {p.name} {p.score}점
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      <section>
        <Chat messages={messages} onSend={onSendChat} placeholder={isDrawer ? '출제자는 채팅할 수 없습니다' : '채팅 또는 정답 입력'} />
      </section>
    </div>
  );
}

// 방장만 보는 설정 수정 칸. 저장하면 서버가 방 안의 모두에게 새 설정을 보낸다.
function SettingsEditor({
  room,
  onUpdate,
}: {
  room: RoomView;
  onUpdate: (settings: RoomSettingsInput) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<RoomSettingsInput>(room);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof RoomSettingsInput>(key: K, value: RoomSettingsInput[K]) =>
    setForm({ ...form, [key]: value });

  const start = () => {
    const { name, maxPlayers, rounds, roundTimeSec, category } = room;
    setForm({ name, maxPlayers, rounds, roundTimeSec, category });
    setError(null);
    setOpen(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = roomSettingsSchema.safeParse(form);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? '입력을 확인하세요.');
    const failure = await onUpdate(form);
    setError(failure);
    if (!failure) setOpen(false);
  };

  if (!open) return <button onClick={start}>방 설정</button>;
  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 6, marginTop: 8 }}>
      <RoomSettingsFields form={form} set={set} />
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="submit">저장</button>
        <button type="button" onClick={() => setOpen(false)}>
          취소
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
