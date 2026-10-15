import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { TrackType } from '@livekit/protocol';
import { VoiceAclService } from './voice-acl.service';
import { nearbyVoiceParticipants, validVoiceRoom, voiceConfig, voiceToken, VOICE_ROOM, VOICE_TOKEN_TTL_SECONDS } from './voice';

const livekit = vi.hoisted(() => ({
  clients: [] as Array<{ listParticipants: ReturnType<typeof vi.fn>; updateSubscriptions: ReturnType<typeof vi.fn> }>,
}));

vi.mock('livekit-server-sdk', () => ({
  RoomServiceClient: vi.fn().mockImplementation(() => {
    const client = { listParticipants: vi.fn(), updateSubscriptions: vi.fn() };
    livekit.clients.push(client);
    return client;
  }),
}));

const env = { VOICE_ENABLED: 'true', LIVEKIT_URL: 'ws://voice:7880', LIVEKIT_API_KEY: 'key', LIVEKIT_API_SECRET: 'secret' };

describe('voice policy', () => {
  it('is disabled unless all server-only LiveKit settings are present and safe', () => {
    expect(voiceConfig({ VOICE_ENABLED: 'true' }).enabled).toBe(false);
    expect(voiceConfig({ ...env, LIVEKIT_API_SECRET: 'change-this-server-only-secret' }).enabled).toBe(false);
    expect(voiceConfig(env).enabled).toBe(true);
    expect(voiceConfig(env).apiUrl).toBe('http://voice:7880');
    expect(voiceConfig({ ...env, LIVEKIT_URL: 'wss://voice.example' }).apiUrl).toBe('https://voice.example');
  });

  it('only accepts the configured office room', () => {
    const config = voiceConfig(env);
    expect(validVoiceRoom(VOICE_ROOM, config)).toBe(true);
    expect(validVoiceRoom('other', config)).toBe(false);
    expect(validVoiceRoom(1, config)).toBe(false);
  });

  it('returns the authoritative nearby account ids, including the speaker', () => {
    const participants = [
      { accountId: 3, personId: 3, name: 'C', x: 10, z: 0 },
      { accountId: 1, personId: 1, name: 'A', x: 0, z: 0 },
      { accountId: 2, personId: 2, name: 'B', x: 6, z: 0 },
    ];
    expect(nearbyVoiceParticipants(participants[0], participants, 5)).toEqual([2, 3]);
  });

  it('creates a short-lived participant token with restricted grants', () => {
    const result = voiceToken(7, 'Ana', voiceConfig(env), 1000);
    const [header, payload, signature] = result.token.split('.');
    expect(header).toBeTruthy();
    expect(payload).toBeTruthy();
    expect(signature).toHaveLength(43);
    expect(result.expiresIn).toBe(VOICE_TOKEN_TTL_SECONDS);
    expect(result.claims).toMatchObject({ iss: 'key', sub: '7', name: 'Ana', exp: 1000 + VOICE_TOKEN_TTL_SECONDS, video: { room: VOICE_ROOM, canPublish: true, canSubscribe: true, canPublishData: false } });
  });
});

type LiveParticipant = { identity: string; tracks: Array<{ type: TrackType; sid?: string }> };

const participant = (identity: string, tracks: LiveParticipant['tracks'] = []): LiveParticipant => ({ identity, tracks });

function aclFixture(hearers: Array<{ accountId: number; x: number; z: number }> = [
  { accountId: 1, x: 0, z: 0 },
  { accountId: 2, x: 3, z: 0 },
]) {
  process.env.VOICE_ENABLED = env.VOICE_ENABLED;
  process.env.LIVEKIT_URL = env.LIVEKIT_URL;
  process.env.LIVEKIT_API_KEY = env.LIVEKIT_API_KEY;
  process.env.LIVEKIT_API_SECRET = env.LIVEKIT_API_SECRET;
  const players = { manager: vi.fn(() => ({ hearers: vi.fn(() => hearers) })) };
  const service = new VoiceAclService(players as never);
  const client = livekit.clients.at(-1)!;
  return { service, client, players };
}

describe('VoiceAclService', () => {
  beforeEach(() => {
    livekit.clients.length = 0;
    vi.useRealTimers();
  });

  afterEach(() => {
    for (const key of ['VOICE_ENABLED', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']) delete process.env[key];
    vi.useRealTimers();
  });

  it('grants nearby audio tracks, ignores video and self, then revokes when movement puts a listener out of range', async () => {
    const hearers = [
      { accountId: 1, x: 0, z: 0 },
      { accountId: 2, x: 3, z: 0 },
    ];
    const { service, client } = aclFixture(hearers);
    client.listParticipants.mockResolvedValue([
      participant('1', [{ type: TrackType.AUDIO, sid: 'a1' }]),
      participant('2', [{ type: TrackType.AUDIO, sid: 'a2' }, { type: TrackType.VIDEO, sid: 'v2' }]),
    ]);

    await service.reconcile();
    expect(client.updateSubscriptions).toHaveBeenCalledWith('office', '1', ['a2'], true);
    expect(client.updateSubscriptions).toHaveBeenCalledWith('office', '2', ['a1'], true);

    hearers[1].x = 20;
    await service.reconcile();
    expect(client.updateSubscriptions).toHaveBeenCalledWith('office', '1', ['a2'], false);
    expect(client.updateSubscriptions).toHaveBeenCalledWith('office', '2', ['a1'], false);
    expect(client.updateSubscriptions).not.toHaveBeenCalledWith('office', '1', ['v2'], true);
  });

  it('handles multiple source tracks and does not repeat unchanged grants', async () => {
    const { service, client } = aclFixture();
    client.listParticipants.mockResolvedValue([
      participant('1', [{ type: TrackType.AUDIO, sid: 'a1' }, { type: TrackType.AUDIO, sid: 'a1b' }]),
      participant('2', [{ type: TrackType.AUDIO, sid: 'a2' }]),
      participant('3', [{ type: TrackType.AUDIO }]),
    ]);

    await service.reconcile();
    await service.reconcile();
    expect(client.updateSubscriptions).toHaveBeenCalledWith('office', '1', ['a2'], true);
    expect(client.updateSubscriptions).toHaveBeenCalledWith('office', '2', ['a1', 'a1b'], true);
    expect(client.updateSubscriptions).toHaveBeenCalledTimes(2);
  });

  it('revokes stale listeners and tracks when participants disappear', async () => {
    const { service, client } = aclFixture();
    client.listParticipants
      .mockResolvedValueOnce([participant('1', [{ type: TrackType.AUDIO, sid: 'a1' }]), participant('2')])
      .mockResolvedValueOnce([participant('2')]);

    await service.reconcile();
    await service.reconcile();
    expect(client.updateSubscriptions).toHaveBeenCalledWith('office', '2', ['a1'], true);
    expect(client.updateSubscriptions).toHaveBeenCalledWith('office', '2', ['a1'], false);
  });

  it('ignores invalid identities and recovers after a Room Service failure', async () => {
    const { service, client } = aclFixture();
    client.listParticipants
      .mockRejectedValueOnce(new Error('temporary outage'))
      .mockResolvedValueOnce([participant('bad', [{ type: TrackType.AUDIO, sid: 'bad-audio' }]), participant('1'), participant('2', [{ type: TrackType.AUDIO, sid: 'a2' }])]);

    await expect(service.reconcile()).resolves.toBeUndefined();
    await service.reconcile();
    expect(client.updateSubscriptions).toHaveBeenCalledWith('office', '1', ['a2'], true);
    expect(client.updateSubscriptions).not.toHaveBeenCalledWith(expect.anything(), 'bad', expect.anything(), expect.anything());
  });

  it('uses the current manager positions on each reconciliation', async () => {
    const positions = [
      [{ accountId: 1, x: 0, z: 0 }, { accountId: 2, x: 3, z: 0 }],
      [{ accountId: 1, x: 0, z: 0 }, { accountId: 2, x: 20, z: 0 }],
    ];
    process.env.VOICE_ENABLED = env.VOICE_ENABLED;
    process.env.LIVEKIT_URL = env.LIVEKIT_URL;
    process.env.LIVEKIT_API_KEY = env.LIVEKIT_API_KEY;
    process.env.LIVEKIT_API_SECRET = env.LIVEKIT_API_SECRET;
    const players = { manager: vi.fn(), };
    players.manager.mockReturnValueOnce({ hearers: () => positions[0] }).mockReturnValueOnce({ hearers: () => positions[1] });
    const service = new VoiceAclService(players as never);
    const client = livekit.clients.at(-1)!;
    client.listParticipants.mockResolvedValue([participant('1'), participant('2', [{ type: TrackType.AUDIO, sid: 'a2' }])]);
    await service.reconcile();
    await service.reconcile();
    expect(players.manager).toHaveBeenCalledTimes(2);
    expect(client.updateSubscriptions).toHaveBeenCalledWith('office', '1', ['a2'], false);
  });

  it('stops the interval and clears state on shutdown', async () => {
    vi.useFakeTimers();
    const { service, client } = aclFixture();
    client.listParticipants.mockResolvedValue([participant('1'), participant('2', [{ type: TrackType.AUDIO, sid: 'a2' }])]);
    service.onApplicationBootstrap();
    await vi.waitFor(() => expect(client.listParticipants).toHaveBeenCalledTimes(1));
    expect(vi.getTimerCount()).toBe(1);
    service.onApplicationShutdown();
    expect(vi.getTimerCount()).toBe(0);
    await service.reconcile();
    expect(client.listParticipants).toHaveBeenCalledTimes(1);
  });
});
