// 제시어와 저장된 그림. 게임 규칙(Game)은 이 파일을 모르고, 방을 만들 때 뽑기 함수로만 받는다.
import { strokeSchema, type Stroke, type WordCategory } from '@brainreader/shared';
import type { Db } from '../db.ts';

export interface SavedDrawing {
  word: string;
  strokes: Stroke[];
}

// category가 null이면 전체에서 뽑는다. 단어가 하나도 없으면 null.
// 2017년에는 빈 결과에서 .word를 읽다 서버가 죽었다 (REVIEW S17). 비어 있을 수 있다는 것을 타입에 드러낸다.
export function pickWord(db: Db, category: WordCategory | null): string | null {
  const row = db
    .prepare('SELECT word FROM words WHERE ?1 IS NULL OR category = ?1 ORDER BY random() LIMIT 1')
    .get(category) as { word: string } | undefined;
  return row?.word ?? null;
}

export function hasWords(db: Db, category: WordCategory | null): boolean {
  return pickWord(db, category) !== null;
}

// 누군가 맞힌 라운드의 그림만 저장한다. 아무도 못 맞힌 그림은 컴퓨터 모드 문제로 쓰기 어렵다.
// 2017년에는 무작위로 고른 참가자의 브라우저가 자기 캔버스를 저장했다 (REVIEW S9).
// 이번에는 서버가 라운드 동안 받은 출제자의 획을 그대로 저장한다.
export function saveDrawing(db: Db, word: string, strokes: Stroke[], now: number) {
  db.prepare('INSERT INTO drawings (word, strokes, created_at) VALUES (?, ?, ?)').run(
    word,
    JSON.stringify(strokes),
    now,
  );
}

// 단어의 카테고리는 words 표에서 찾는다. 단어 목록에서 빠진 단어의 그림은 전체 카테고리에서만 나온다.
export function pickDrawing(db: Db, category: WordCategory | null): SavedDrawing | null {
  const row = db
    .prepare(
      `SELECT drawings.word, drawings.strokes
         FROM drawings LEFT JOIN words ON words.word = drawings.word
        WHERE ?1 IS NULL OR words.category = ?1
        ORDER BY random() LIMIT 1`,
    )
    .get(category) as { word: string; strokes: string } | undefined;
  if (!row) return null;
  // DB에 있는 값도 한 번 더 검사한다. 저장 형식이 바뀌어 깨진 행이 있어도 클라이언트에 그대로 흘리지 않는다.
  const strokes = strokeSchema.array().safeParse(JSON.parse(row.strokes));
  return strokes.success ? { word: row.word, strokes: strokes.data } : null;
}

export function hasDrawings(db: Db, category: WordCategory | null): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM drawings LEFT JOIN words ON words.word = drawings.word
        WHERE ?1 IS NULL OR words.category = ?1 LIMIT 1`,
    )
    .get(category);
  return row !== undefined;
}
