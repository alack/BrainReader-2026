import { describe, expect, it } from 'vitest';
import { startServer } from '../testing.ts';
import { AVATAR_MAX_BYTES } from './avatar.ts';

// PNG 시그니처 8바이트 + 아무 내용. 서버는 형식 판별만 하고 이미지를 해석하지 않는다.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest')]);

async function setup() {
  const { app } = await startServer();
  const signUp = async (username: string) => {
    const res = await app.fastify.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username, password: 'password123' },
    });
    return { id: res.json().user.id as string, cookie: `sid=${res.cookies.find((c) => c.name === 'sid')!.value}` };
  };
  const put = (body: Buffer, contentType: string, cookie?: string) =>
    app.fastify.inject({
      method: 'PUT',
      url: '/api/me/avatar',
      payload: body,
      headers: { 'content-type': contentType, ...(cookie ? { cookie } : {}) },
    });
  return { app, signUp, put };
}

describe('프로필 이미지', () => {
  it('자기 이미지를 올리고 누구나 볼 수 있다', async () => {
    const { app, signUp, put } = await setup();
    const me = await signUp('alice');
    expect((await put(PNG, 'image/png', me.cookie)).statusCode).toBe(204);

    const res = await app.fastify.inject({ method: 'GET', url: `/api/users/${me.id}/avatar` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.rawPayload.equals(PNG)).toBe(true);
  });

  it('로그인하지 않으면 올릴 수 없다. 누구의 이미지인지는 세션이 정한다 (REVIEW X3)', async () => {
    const { put } = await setup();
    expect((await put(PNG, 'image/png')).statusCode).toBe(401);
  });

  it('형식을 속인 파일, 너무 큰 파일, 이미지가 아닌 형식을 거절한다 (REVIEW C12)', async () => {
    const { signUp, put } = await setup();
    const { cookie } = await signUp('alice');
    expect((await put(Buffer.from('<svg onload=alert(1)>'), 'image/png', cookie)).statusCode).toBe(400);
    expect((await put(PNG, 'image/jpeg', cookie)).statusCode).toBe(400);
    const big = Buffer.concat([PNG, Buffer.alloc(AVATAR_MAX_BYTES)]);
    expect((await put(big, 'image/png', cookie)).statusCode).toBe(413);
    expect((await put(PNG, 'image/svg+xml', cookie)).statusCode).toBe(415);
  });

  it('이미지가 없으면 404', async () => {
    const { app, signUp } = await setup();
    const me = await signUp('alice');
    expect((await app.fastify.inject({ method: 'GET', url: `/api/users/${me.id}/avatar` })).statusCode).toBe(404);
  });
});
