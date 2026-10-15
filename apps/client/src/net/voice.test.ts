import { afterEach, describe, expect, it, vi } from 'vitest';

const mintVoiceToken = vi.hoisted(() => vi.fn());
const rooms: MockRoom[] = [];

vi.mock('./login.js', () => ({ mintVoiceToken }));
vi.mock('livekit-client', () => ({
  Room: class extends MockRoom {},
  RoomEvent: { Disconnected: 'disconnected', TrackSubscribed: 'track-subscribed', TrackUnsubscribed: 'track-unsubscribed' },
  Track: { Kind: { Audio: 'audio' } },
}));

class MockElement {
  hidden = false;
  disabled = false;
  textContent = '';
  text = '';
  dataset: Record<string, string> = {};
  listeners = new Map<string, (...args: any[]) => void>();
  removed = false;
  volume = 1;
  setAttribute() {}
  addEventListener(type: string, listener: (...args: any[]) => void) { this.listeners.set(type, listener); }
  remove() { this.removed = true; }
  click() { this.listeners.get('click')?.(); }
}

class MockTrack {
  kind = 'audio';
  attached: MockElement[] = [];
  attach() { const element = new MockElement(); this.attached.push(element); return element; }
  detach() { return this.attached; }
}

class MockRoom {
  static nextConnect: (() => Promise<void>) | null = null;
  events = new Map<string, (...args: any[]) => void>();
  connectCalls: [string, string][] = [];
  disconnectCalls = 0;
  tokenUpdates: string[] = [];
  microphoneCalls: boolean[] = [];
  remoteParticipants = new Map<string, any>();
  localParticipant = {
    setMicrophoneEnabled: vi.fn(async (enabled: boolean) => { this.microphoneCalls.push(enabled); }),
  };
  constructor(_options: unknown) { rooms.push(this); }
  on(event: string, listener: (...args: any[]) => void) { this.events.set(event, listener); }
  async connect(url: string, token: string) {
    this.connectCalls.push([url, token]);
    if (MockRoom.nextConnect) await MockRoom.nextConnect();
  }
  async disconnect() { this.disconnectCalls += 1; }
  async updateToken(token: string) { this.tokenUpdates.push(token); }
  emit(event: string, ...args: any[]) { this.events.get(event)?.(...args); }
}

function makeDom() {
  const elements = new Map<string, MockElement>();
  for (const id of ['voicePanel', 'voiceStatus', 'voiceConnect', 'voiceMute']) elements.set(id, new MockElement());
  const audio: MockElement[] = [];
  const document = {
    body: { append(element: MockElement) { audio.push(element); } },
    getElementById(id: string) { return elements.get(id) ?? null; },
    querySelectorAll(selector: string) { return selector === '[data-voice-audio]' ? audio.filter(element => !element.removed) : []; },
    querySelector(_selector: string) { return null; },
  };
  vi.stubGlobal('document', document);
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  vi.stubGlobal('addEventListener', vi.fn());
  return { elements, audio };
}

async function loadVoice() {
  return import('./voice.js');
}

function connectedCredentials(expiresIn = 300) {
  return { token: 'initial-token', url: 'wss://voice.test', expiresIn };
}

async function connectVoice(response: unknown = { participants: [] }) {
  mintVoiceToken.mockResolvedValueOnce(connectedCredentials()).mockResolvedValueOnce(response);
  const { initVoice } = await loadVoice();
  const voice = initVoice({ base: '/api' });
  expect(await voice.connect()).toBe(true);
  return { voice, room: rooms.at(-1)! };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mintVoiceToken.mockReset();
  rooms.length = 0;
  MockRoom.nextConnect = null;
});

describe('voice client lifecycle', () => {
  it('does not mint a token or request the microphone until Connect is pressed', async () => {
    const { elements } = makeDom();
    const { initVoice } = await loadVoice();
    const voice = initVoice({ base: '/api' });

    expect(mintVoiceToken).not.toHaveBeenCalled();
    expect(voice.state()).toBe('disabled');
    expect(elements.get('voicePanel')!.hidden).toBe(true);

    mintVoiceToken.mockResolvedValueOnce(connectedCredentials()).mockResolvedValueOnce({ participants: [] });
    elements.get('voiceConnect')!.click();
    await vi.waitFor(() => expect(voice.state()).toBe('connected'));

    expect(mintVoiceToken).toHaveBeenCalledWith('/api');
    expect(rooms[0].microphoneCalls).toEqual([true]);
  });

  it('refreshes an expiring token while retaining the active room', async () => {
    makeDom();
    mintVoiceToken
      .mockResolvedValueOnce(connectedCredentials(1))
      .mockResolvedValueOnce({ token: 'refreshed-token', expiresIn: 300, participants: [] });
    const { initVoice } = await loadVoice();
    const voice = initVoice();

    expect(await voice.connect()).toBe(true);
    expect(rooms[0].tokenUpdates).toEqual(['refreshed-token']);
    expect(voice.state()).toBe('connected');
  });

  it('cancels a connection that loses the generation race with disconnect', async () => {
    makeDom();
    let resolveToken!: (value: unknown) => void;
    mintVoiceToken.mockReturnValueOnce(new Promise(resolve => { resolveToken = resolve; }));
    const { initVoice } = await loadVoice();
    const voice = initVoice();

    const connecting = voice.connect();
    await vi.waitFor(() => expect(voice.state()).toBe('connecting'));
    await voice.disconnect();
    resolveToken(connectedCredentials());

    expect(await connecting).toBe(false);
    expect(rooms).toHaveLength(0);
    expect(voice.state()).toBe('disconnected');
  });

  it('fails closed when proximity data is not an array', async () => {
    makeDom();
    mintVoiceToken.mockResolvedValueOnce(connectedCredentials()).mockResolvedValueOnce({ participants: 'not-an-array' });
    const { initVoice } = await loadVoice();
    const voice = initVoice();
    expect(await voice.connect()).toBe(true);

    const track = new MockTrack();
    rooms[0].emit('track-subscribed', track, {}, { identity: 'unknown' });
    expect(track.attached).toHaveLength(0);
  });

  it('attenuates attached audio from authoritative positions', async () => {
    makeDom();
    const response = {
      participants: ['2'],
      position: { x: 0, z: 0 },
      range: 10,
      participantPositions: [{ accountId: 2, x: 5, z: 0 }],
    };
    const { voice, room } = await connectVoice(response);
    const track = new MockTrack();
    rooms[0].emit('track-subscribed', track, {}, { identity: '2' });
    expect(track.attached[0].volume).toBeCloseTo(0.25);
    expect(voice.diagnostics().audioElements).toBe(1);
    expect(room).toBe(rooms[0]);
  });

  it('fails closed when an authorized participant has no position', async () => {
    makeDom();
    const { room } = await connectVoice({ participants: ['2'], position: { x: 0, z: 0 }, participantPositions: [] });
    const track = new MockTrack();
    rooms[0].emit('track-subscribed', track, {}, { identity: '2' });
    expect(track.attached[0].volume).toBe(0);
    expect(room).toBe(rooms[0]);
  });

  it('updates gain on already-attached audio as authoritative positions change', async () => {
    vi.useFakeTimers();
    makeDom();
    mintVoiceToken
      .mockResolvedValueOnce(connectedCredentials())
      .mockResolvedValueOnce({ participants: ['2'], position: { x: 0, z: 0 }, range: 10, participantPositions: [{ accountId: 2, x: 5, z: 0 }] })
      .mockResolvedValueOnce({ participants: ['2'], position: { x: 0, z: 0 }, range: 10, participantPositions: [{ accountId: 2, x: 9, z: 0 }] });
    const { initVoice } = await loadVoice();
    const voice = initVoice();
    expect(await voice.connect()).toBe(true);
    const track = new MockTrack();
    rooms[0].emit('track-subscribed', track, {}, { identity: '2' });
    expect(track.attached[0].volume).toBeCloseTo(0.25);

    await vi.advanceTimersByTimeAsync(1000);
    expect(track.attached[0].volume).toBeCloseTo(0.01);
  });

  it('mutes and unmutes the local participant', async () => {
    makeDom();
    const { voice, room } = await connectVoice();

    expect(await voice.toggleMute()).toBe(true);
    expect(voice.isMuted()).toBe(true);
    expect(voice.state()).toBe('muted');
    expect(await voice.toggleMute()).toBe(true);
    expect(voice.isMuted()).toBe(false);
    expect(room.microphoneCalls).toEqual([true, false, true]);
  });

  it('cleans up timers, attached audio, state, and the room on disconnect', async () => {
    const { audio } = makeDom();
    const { voice, room } = await connectVoice({ participants: ['nearby'] });
    const track = new MockTrack();
    rooms[0].emit('track-subscribed', track, {}, { identity: 'nearby' });
    expect(audio).toHaveLength(1);

    await voice.disconnect();
    expect(room.disconnectCalls).toBe(1);
    expect(audio[0].removed).toBe(true);
    expect(voice.state()).toBe('disconnected');
    expect(voice.isMuted()).toBe(false);
    expect(await voice.toggleMute()).toBe(false);
  });
});
