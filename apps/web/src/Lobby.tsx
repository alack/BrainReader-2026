import { useEffect, useState, type FormEvent } from 'react';
import {
  createRoomSchema,
  type ChatMessage,
  type CreateRoomInput,
  type LobbyState,
  type RankingEntry,
  type RoomSummary,
} from '@brainreader/shared';
import { fetchRanking } from './api.ts';
import { Chat } from './Chat.tsx';
import { RoomSettingsFields } from './RoomSettingsFields.tsx';

const DEFAULT_ROOM: CreateRoomInput = {
  name: '',
  password: '',
  maxPlayers: 6,
  rounds: 3,
  roundTimeSec: 60,
  category: null,
  mode: 'normal',
};

export function Lobby({
  lobby,
  messages,
  onCreate,
  onJoin,
  onSendChat,
}: {
  lobby: LobbyState;
  messages: ChatMessage[];
  onCreate: (input: CreateRoomInput) => Promise<string | null>;
  onJoin: (roomId: string, password?: string) => Promise<string | null>;
  onSendChat: (text: string) => Promise<string | null>;
}) {
  const [search, setSearch] = useState('');
  const visible = lobby.rooms.filter((r) => r.name.includes(search.trim()));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
      <section>
        <h2>방 목록</h2>
        <input aria-label="방 검색" placeholder="방 이름 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
        {visible.length === 0 && <p>열린 방이 없습니다.</p>}
        <ul data-testid="room-list" style={{ listStyle: 'none', padding: 0 }}>
          {visible.map((room) => (
            <RoomItem key={room.id} room={room} onJoin={onJoin} />
          ))}
        </ul>
        <CreateRoomForm onCreate={onCreate} />
      </section>
      <aside>
        <h2>접속자 {lobby.users.length}명</h2>
        <ul data-testid="user-list">
          {lobby.users.map((u) => (
            <li key={u.id}>
              {u.username}
              {u.roomId && ' (게임방)'}
            </li>
          ))}
        </ul>
        <RankingBoard />
      </aside>
      <section style={{ gridColumn: '1 / -1' }}>
        <h2>대기실 채팅</h2>
        <Chat messages={messages} onSend={onSendChat} />
      </section>
    </div>
  );
}

function RoomItem({ room, onJoin }: { room: RoomSummary; onJoin: (roomId: string, password?: string) => Promise<string | null> }) {
  const [askPassword, setAskPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const full = room.playerCount >= room.maxPlayers;

  const join = async (e?: FormEvent) => {
    e?.preventDefault();
    if (room.locked && !askPassword) return setAskPassword(true);
    setError(await onJoin(room.id, room.locked ? password : undefined));
  };

  return (
    <li style={{ border: '1px solid #ccc', padding: 8, marginBottom: 6 }}>
      <strong>{room.name}</strong> {room.locked && '🔒'} {room.playerCount}/{room.maxPlayers}명
      {room.mode === 'computer' && ' · 컴퓨터 모드'} · {room.category ?? '전체'}
      {room.playing && ' · 게임 중'}{' '}
      <button onClick={() => join()} disabled={full}>
        {full ? '꽉 참' : '입장'}
      </button>
      {askPassword && (
        <form onSubmit={join} style={{ display: 'inline-flex', gap: 4, marginLeft: 8 }}>
          <input
            aria-label="방 비밀번호"
            type="password"
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit">확인</button>
        </form>
      )}
      {error && <span role="alert"> {error}</span>}
    </li>
  );
}

function CreateRoomForm({ onCreate }: { onCreate: (input: CreateRoomInput) => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(DEFAULT_ROOM);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof CreateRoomInput>(key: K, value: CreateRoomInput[K]) => setForm({ ...form, [key]: value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = createRoomSchema.safeParse(form);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? '입력을 확인하세요.');
    setError(await onCreate(form));
  };

  if (!open) return <button onClick={() => setOpen(true)}>방 만들기</button>;

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 6, maxWidth: 320, marginTop: 8 }}>
      <RoomSettingsFields form={form} set={set} />
      <input
        aria-label="방 비밀번호 설정"
        placeholder="비밀번호 (비우면 공개 방)"
        value={form.password ?? ''}
        onChange={(e) => set('password', e.target.value)}
      />
      <label>
        모드{' '}
        <select value={form.mode} onChange={(e) => set('mode', e.target.value as CreateRoomInput['mode'])}>
          <option value="normal">함께 그리기</option>
          <option value="computer">컴퓨터 그림 맞히기</option>
        </select>
      </label>
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="submit">만들기</button>
        <button type="button" onClick={() => setOpen(false)}>
          취소
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

// 대기실에 들어올 때마다 새로 받는다. 게임을 마치고 방에서 나오면 갱신된 순위가 보인다.
function RankingBoard() {
  const [ranking, setRanking] = useState<RankingEntry[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchRanking().then((r) => {
      if (!cancelled) setRanking(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section>
      <h2>랭킹</h2>
      {ranking === null && <p>불러오는 중</p>}
      {ranking?.length === 0 && <p>아직 끝난 게임이 없습니다.</p>}
      <ol data-testid="ranking-board">
        {ranking?.map((r) => (
          <li key={r.id}>
            {r.username} {r.totalScore}점 ({r.gamesPlayed}판 {r.wins}승)
          </li>
        ))}
      </ol>
    </section>
  );
}
