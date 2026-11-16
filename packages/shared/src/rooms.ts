import { z } from 'zod';
import type { GameSnapshot } from './game.ts';

// 제시어 카테고리. 단어 자체는 서버 DB에 있다.
export const WORD_CATEGORIES = ['동물', '음식', '사물', '탈것', '직업'] as const;
export type WordCategory = (typeof WORD_CATEGORIES)[number];

// normal: 사람이 돌아가며 그린다. computer: 서버가 저장된 그림을 다시 그리고 모두 맞힌다.
export const ROOM_MODES = ['normal', 'computer'] as const;
export type RoomMode = (typeof ROOM_MODES)[number];

// 방장이 게임 시작 전에 바꿀 수 있는 설정. category가 null이면 전체 카테고리.
export const roomSettingsSchema = z.object({
  name: z.string().trim().min(1, '방 이름을 입력하세요').max(20, '방 이름은 20자 이하'),
  maxPlayers: z.number().int().min(2).max(8),
  rounds: z.number().int().min(1).max(10),
  roundTimeSec: z.number().int().min(30).max(180),
  category: z.enum(WORD_CATEGORIES).nullable().default(null),
});
export type RoomSettingsInput = z.input<typeof roomSettingsSchema>;

export const createRoomSchema = roomSettingsSchema.extend({
  // 빈 문자열은 비밀번호 없음으로 본다.
  password: z
    .string()
    .max(20, '비밀번호는 20자 이하')
    .optional()
    .transform((p) => (p ? p : undefined)),
  mode: z.enum(ROOM_MODES).default('normal'),
});
export type CreateRoomInput = z.input<typeof createRoomSchema>;

export const joinRoomSchema = z.object({
  roomId: z.string().min(1),
  password: z.string().max(20).optional(),
});
export type JoinRoomInput = z.infer<typeof joinRoomSchema>;

export const chatTextSchema = z.string().trim().min(1).max(200);

// 대기실 목록에 나가는 방 정보. 비밀번호는 있는지 여부(locked)만 알린다.
export interface RoomSummary {
  id: string;
  name: string;
  locked: boolean;
  playerCount: number;
  maxPlayers: number;
  playing: boolean;
  mode: RoomMode;
  category: WordCategory | null;
}

// 방 안에 있는 사람에게 나가는 방 정보.
export interface RoomView {
  id: string;
  name: string;
  locked: boolean;
  maxPlayers: number;
  rounds: number;
  roundTimeSec: number;
  mode: RoomMode;
  category: WordCategory | null;
  hostId: string | null; // 가장 먼저 들어와 있는 사람. 방 설정을 바꿀 수 있다.
  game: GameSnapshot;
}

export interface LobbyState {
  rooms: RoomSummary[];
  users: { id: string; username: string; roomId: string | null }[];
}

export interface ChatMessage {
  userId: string;
  username: string;
  text: string;
  sentAt: number;
}

// 요청에 대한 서버의 응답(ack). 실패하면 error에 이유 코드가 온다.
export type Ack<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

// 랭킹에 나가는 유저 정보. 비밀번호 해시 같은 칼럼은 담지 않는다 (REVIEW X1).
export interface RankingEntry {
  id: string;
  username: string;
  gamesPlayed: number;
  wins: number;
  totalScore: number;
}
