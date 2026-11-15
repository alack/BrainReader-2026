import { WORD_CATEGORIES, type RoomSettingsInput, type WordCategory } from '@brainreader/shared';

// 방 만들기와 방 설정 수정이 같이 쓰는 입력 칸.
export function RoomSettingsFields<T extends RoomSettingsInput>({
  form,
  set,
}: {
  form: T;
  set: <K extends keyof T>(key: K, value: T[K]) => void;
}) {
  return (
    <>
      <input
        aria-label="방 이름"
        placeholder="방 이름"
        value={form.name}
        onChange={(e) => set('name', e.target.value as T['name'])}
      />
      <label>
        최대 인원{' '}
        <input
          type="number"
          min={2}
          max={8}
          value={form.maxPlayers}
          onChange={(e) => set('maxPlayers', Number(e.target.value) as T['maxPlayers'])}
        />
      </label>
      <label>
        라운드 수{' '}
        <input
          type="number"
          min={1}
          max={10}
          value={form.rounds}
          onChange={(e) => set('rounds', Number(e.target.value) as T['rounds'])}
        />
      </label>
      <label>
        제한 시간(초){' '}
        <input
          type="number"
          min={30}
          max={180}
          value={form.roundTimeSec}
          onChange={(e) => set('roundTimeSec', Number(e.target.value) as T['roundTimeSec'])}
        />
      </label>
      <label>
        카테고리{' '}
        <select
          value={form.category ?? ''}
          onChange={(e) => set('category', (e.target.value || null) as WordCategory | null as T['category'])}
        >
          <option value="">전체</option>
          {WORD_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
