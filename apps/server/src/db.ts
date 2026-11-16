import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

// 스키마 변경은 이 배열 끝에 추가만 한다. 이미 들어간 항목은 고치지 않는다.
// DB 파일의 PRAGMA user_version이 "몇 번째까지 적용했는지"를 기억한다.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    created_at    INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user_id ON sessions(user_id);
  `,
  // v0.07: 단어와 카테고리, 랭킹 기록, 프로필 이미지, 저장된 그림.
  // 2017년에는 단어 DB를 손으로 채워야 게임이 됐고, 비어 있으면 서버가 죽었다 (REVIEW S17).
  // 이번에는 마이그레이션이 기본 단어를 넣고, 같은 단어는 UNIQUE로 DB가 막는다 (REVIEW S16).
  `
  CREATE TABLE words (
    id       INTEGER PRIMARY KEY,
    category TEXT    NOT NULL,
    word     TEXT    NOT NULL UNIQUE
  );
  CREATE INDEX words_category ON words(category);
  INSERT INTO words (category, word) VALUES
    ('동물', '고양이'), ('동물', '강아지'), ('동물', '기린'), ('동물', '코끼리'), ('동물', '토끼'), ('동물', '펭귄'),
    ('동물', '거북이'), ('동물', '사자'), ('동물', '원숭이'), ('동물', '돼지'), ('동물', '뱀'), ('동물', '닭'),
    ('음식', '사과'), ('음식', '바나나'), ('음식', '수박'), ('음식', '피자'), ('음식', '햄버거'), ('음식', '아이스크림'),
    ('음식', '김밥'), ('음식', '라면'), ('음식', '케이크'), ('음식', '당근'), ('음식', '포도'), ('음식', '달걀'),
    ('사물', '우산'), ('사물', '피아노'), ('사물', '선풍기'), ('사물', '안경'), ('사물', '시계'), ('사물', '가위'),
    ('사물', '의자'), ('사물', '컴퓨터'), ('사물', '전구'), ('사물', '열쇠'), ('사물', '칫솔'), ('사물', '텔레비전'),
    ('탈것', '자전거'), ('탈것', '비행기'), ('탈것', '기차'), ('탈것', '배'), ('탈것', '버스'), ('탈것', '헬리콥터'),
    ('탈것', '오토바이'), ('탈것', '로켓'), ('탈것', '자동차'), ('탈것', '잠수함'), ('탈것', '트럭'), ('탈것', '열기구'),
    ('직업', '의사'), ('직업', '경찰'), ('직업', '소방관'), ('직업', '요리사'), ('직업', '선생님'), ('직업', '가수'),
    ('직업', '화가'), ('직업', '우주비행사'), ('직업', '농부'), ('직업', '어부'), ('직업', '축구선수'), ('직업', '마술사');

  -- 2017년에는 attempt, correct, points에 초기값이 없어 += 1이 NaN이 됐다 (REVIEW C13).
  ALTER TABLE users ADD COLUMN games_played INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN wins         INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN total_score  INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE avatars (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    mime       TEXT    NOT NULL,
    data       BLOB    NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- 그림은 이미지가 아니라 획 목록(JSON)으로, 시각은 문자열이 아니라 밀리초 정수로 둔다 (REVIEW S18).
  CREATE TABLE drawings (
    id         INTEGER PRIMARY KEY,
    word       TEXT    NOT NULL,
    strokes    TEXT    NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
];

// path에 ':memory:'를 주면 테스트용 메모리 DB가 된다.
export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(db: Db) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
