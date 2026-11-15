// 게임 결과 누적과 랭킹 조회.
import type { FastifyInstance } from 'fastify';
import type { Player, RankingEntry } from '@brainreader/shared';
import type { Db } from '../db.ts';

export const RANKING_SIZE = 20;

// 끝까지 끝난 게임 한 판의 결과를 한 트랜잭션으로 반영한다.
// 최고 점수가 0보다 크면 그 점수를 받은 사람 모두가 1승이다.
// 2017년에는 클라이언트 서비스에 기록 함수만 있고 아무도 부르지 않았다 (REVIEW C13).
// 이번에는 서버가 게임 종료 이벤트를 처리하는 한 곳에서만 기록한다.
export function recordGame(db: Db, ranking: Player[]) {
  const top = Math.max(0, ...ranking.map((p) => p.score));
  const update = db.prepare(
    `UPDATE users
        SET games_played = games_played + 1,
            wins = wins + ?,
            total_score = total_score + ?
      WHERE id = ?`,
  );
  db.exec('BEGIN');
  try {
    for (const p of ranking) update.run(top > 0 && p.score === top ? 1 : 0, p.score, Number(p.id));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// 응답에 들어갈 칼럼을 SELECT에서 고른다. 2017년 /user/rank는 비밀번호 해시까지 내보냈다 (REVIEW X1).
export function topRanking(db: Db, limit = RANKING_SIZE): RankingEntry[] {
  const rows = db
    .prepare(
      `SELECT id, username, games_played, wins, total_score
         FROM users
        WHERE games_played > 0
        ORDER BY total_score DESC, wins DESC, id
        LIMIT ?`,
    )
    .all(limit) as { id: number; username: string; games_played: number; wins: number; total_score: number }[];
  return rows.map((r) => ({
    id: String(r.id),
    username: r.username,
    gamesPlayed: r.games_played,
    wins: r.wins,
    totalScore: r.total_score,
  }));
}

export function registerRankingRoutes(fastify: FastifyInstance, db: Db) {
  fastify.get('/api/ranking', async () => ({ ranking: topRanking(db) }));
}
