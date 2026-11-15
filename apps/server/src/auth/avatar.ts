// 프로필 이미지.
//
// 2017년에는 PUT /user/:id가 세션을 보지 않아 누구나 남의 이미지를 바꿀 수 있었고 (REVIEW X3),
// 클라이언트가 PNG도 image/jpeg로 고정해 base64로 보냈으며, 크기 제한이 없어 서버 본문 제한을 50MB로 올렸다 (REVIEW C12).
// 이번에는
// - 바꾸는 주소가 /api/me/avatar 하나다. 누구의 이미지인지는 세션이 정한다.
// - 브라우저가 96×96으로 줄여 이미지 바이트 그대로 보낸다. 서버는 64KB까지만 받는다.
// - Content-Type만 믿지 않고 파일 앞부분(시그니처)이 그 형식인지 확인한다.
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { sessionUser } from './routes.ts';

export const AVATAR_MAX_BYTES = 64 * 1024;

const startsWith = (data: Buffer, bytes: number[], offset = 0) => bytes.every((b, i) => data[offset + i] === b);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

const SIGNATURES: Record<string, (data: Buffer) => boolean> = {
  'image/png': (d) => startsWith(d, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': (d) => startsWith(d, [0xff, 0xd8, 0xff]),
  'image/webp': (d) => startsWith(d, ascii('RIFF')) && startsWith(d, ascii('WEBP'), 8),
};

export function registerAvatarRoutes(fastify: FastifyInstance, db: Db) {
  // 이 형식들만 본문을 바이트 그대로 받는다. 다른 Content-Type은 Fastify가 415로 거절하고,
  // 64KB를 넘으면 본문을 다 읽기 전에 413으로 거절한다.
  fastify.addContentTypeParser(
    Object.keys(SIGNATURES),
    { parseAs: 'buffer', bodyLimit: AVATAR_MAX_BYTES },
    (_request, body, done) => done(null, body),
  );

  fastify.put('/api/me/avatar', async (request, reply) => {
    const user = sessionUser(db, request);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    const mime = (request.headers['content-type'] ?? '').split(';')[0]!.trim();
    const data = request.body;
    if (!Buffer.isBuffer(data) || !SIGNATURES[mime]?.(data)) {
      return reply.code(400).send({ error: 'invalidImage' });
    }

    db.prepare(
      `INSERT INTO avatars (user_id, mime, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`,
    ).run(Number(user.id), mime, data, Date.now());
    return reply.code(204).send();
  });

  fastify.get<{ Params: { id: string } }>('/api/users/:id/avatar', async (request, reply) => {
    const row = db
      .prepare('SELECT mime, data FROM avatars WHERE user_id = ?')
      .get(Number(request.params.id)) as { mime: string; data: Uint8Array } | undefined;
    if (!row) return reply.code(404).send({ error: 'notFound' });
    return reply
      .header('Content-Type', row.mime)
      .header('X-Content-Type-Options', 'nosniff') // 브라우저가 내용을 보고 다른 형식으로 해석하지 않게 한다
      .header('Cache-Control', 'no-cache') // 이미지를 바꾸면 다음 요청에 바로 반영되게 한다
      .send(Buffer.from(row.data));
  });
}
