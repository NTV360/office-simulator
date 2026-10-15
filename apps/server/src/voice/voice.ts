import { createHmac } from 'node:crypto';

export const VOICE_ROOM = 'office';
export const VOICE_RANGE = 10;
export const VOICE_TOKEN_TTL_SECONDS = 5 * 60;

export interface VoiceConfig {
  enabled: boolean;
  url: string | null;
  apiUrl: string | null;
  apiKey: string | null;
  apiSecret: string | null;
  room: string;
  range: number;
}

export interface VoiceParticipant {
  accountId: number;
  personId?: number;
  name?: string;
  x: number;
  z: number;
}

export interface VoiceTokenClaims {
  iss: string;
  sub: string;
  name: string;
  exp: number;
  nbf: number;
  video: {
    roomJoin: true;
    room: string;
    canPublish: true;
    canSubscribe: true;
    canPublishData: false;
  };
}

const base64url = (value: string | Buffer): string => Buffer.from(value).toString('base64url');

export function voiceConfig(env: NodeJS.ProcessEnv = process.env): VoiceConfig {
  const candidateUrl = env.LIVEKIT_URL?.trim() || null;
  const url = candidateUrl && /^wss?:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(candidateUrl) ? candidateUrl : null;
  const configuredApiUrl = env.LIVEKIT_API_URL?.trim() || null;
  const apiUrl = configuredApiUrl && /^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(configuredApiUrl)
    ? configuredApiUrl
    : url?.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:') ?? null;
  const apiKey = env.LIVEKIT_API_KEY?.trim() || null;
  const apiSecret = env.LIVEKIT_API_SECRET?.trim() || null;
  const candidateRoom = env.VOICE_ROOM?.trim() || VOICE_ROOM;
  const room = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(candidateRoom) ? candidateRoom : VOICE_ROOM;
  const configuredRange = Number(env.VOICE_RANGE);
  const range = Number.isFinite(configuredRange) && configuredRange >= 1 && configuredRange <= 100
    ? configuredRange
    : VOICE_RANGE;
  const requested = env.VOICE_ENABLED === 'true' || env.VOICE_ENABLED === '1';
  const unsafeDevelopmentSecret = apiSecret === 'change-this-server-only-secret' || apiSecret === 'devsecret';
  return { enabled: requested && !!url && !!apiUrl && !!apiKey && !!apiSecret && !unsafeDevelopmentSecret, url, apiUrl, apiKey, apiSecret, room, range };
}

export function validVoiceRoom(room: unknown, config: VoiceConfig): room is string {
  return typeof room === 'string' && room === config.room && room.length <= 64;
}

export function nearbyVoiceParticipants(
  speaker: VoiceParticipant,
  participants: readonly VoiceParticipant[],
  range: number,
): number[] {
  if (!Number.isFinite(range) || range < 0 || !Number.isFinite(speaker.x) || !Number.isFinite(speaker.z)) return [];
  const squared = range * range;
  const ids = new Set<number>();
  for (const participant of participants) {
    if (!Number.isInteger(participant.accountId) || participant.accountId < 1 || !Number.isFinite(participant.x) || !Number.isFinite(participant.z)) continue;
    if (participant.accountId !== speaker.accountId && (participant.x - speaker.x) ** 2 + (participant.z - speaker.z) ** 2 > squared) continue;
    ids.add(participant.accountId);
  }
  return [...ids].sort((a, b) => a - b);
}

export function voiceToken(
  accountId: number,
  name: string,
  config: VoiceConfig,
  nowSeconds = Math.floor(Date.now() / 1000),
): { token: string; expiresIn: number; claims: VoiceTokenClaims } {
  if (!config.enabled || !config.apiKey || !config.apiSecret || !config.url) throw new Error('voice is not configured');
  if (!Number.isInteger(accountId) || accountId < 1) throw new RangeError('invalid voice identity');
  const safeName = name.trim().slice(0, 80);
  if (!safeName) throw new RangeError('invalid voice name');
  const claims: VoiceTokenClaims = {
    iss: config.apiKey,
    sub: String(accountId),
    name: safeName,
    nbf: nowSeconds,
    exp: nowSeconds + VOICE_TOKEN_TTL_SECONDS,
    video: { roomJoin: true, room: config.room, canPublish: true, canSubscribe: true, canPublishData: false },
  };
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const signature = createHmac('sha256', config.apiSecret).update(signingInput).digest('base64url');
  return { token: `${signingInput}.${signature}`, expiresIn: VOICE_TOKEN_TTL_SECONDS, claims };
}
