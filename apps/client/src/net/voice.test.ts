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
  vi.useRealTimers();
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

  /** A tiny Web Audio: enough to see what the voice code asks of it. */
  function stubWebAudio() {
    const param = () => ({ value: 0, setTargetAtTime(v: number) { this.value = v; } });
    class Node { connected: unknown[] = []; connect(n: unknown) { this.connected.push(n); return n; } disconnect() {} }
    class Gain extends Node { gain = param(); }
    class Panner extends Node { panningModel = ''; rolloffFactor = -1; positionX = param(); positionY = param(); positionZ = param(); }
    vi.stubGlobal('AudioContext', class {
      state = 'running'; currentTime = 0; destination = new Node();
      async resume() {}
      createMediaElementSource() { return new Node(); }
      createGain() { return new Gain(); }
      createPanner() { return new Panner(); }
    });
  }

  it('applies the volume once, with the gain node, and puts the speaker where they are from the listener', async () => {
    vi.useFakeTimers(); // (before connecting: the page's refresh timer is made then)
    makeDom();
    stubWebAudio();
    let pose = { x: 0, z: 0, yaw: 0 }; // facing +z (the game's yaw 0)
    mintVoiceToken.mockResolvedValueOnce(connectedCredentials()).mockResolvedValueOnce({ participants: ['2'], position: { x: 0, z: 0 }, range: 10, participantPositions: [{ accountId: 2, x: 5, z: 0 }] });
    const { initVoice } = await loadVoice();
    const voice = initVoice({ listener: () => pose });
    expect(await voice.connect()).toBe(true);
    const track = new MockTrack();
    rooms[0].emit('track-subscribed', track, {}, { identity: '2' });
    const near = (value: number | undefined, expected: number) => expect(value ?? NaN).toBeCloseTo(expected, 5);
    // the element stays at full volume (it would be squared otherwise); the gain is what a 5 m distance in a 10 m range gives
    expect(track.attached[0].volume).toBe(1);
    expect(voice.diagnostics().audioGains[0]).toBeCloseTo(0.25);
    // facing +z, a speaker at +x is on the listener's LEFT (the game's right hand is -x)
    near(voice.diagnostics().audioPlacement[0]?.right, -5);
    near(voice.diagnostics().audioPlacement[0]?.ahead, 0);
    // turn to face +x: the same speaker is now straight ahead
    pose = { x: 0, z: 0, yaw: Math.PI / 2 };
    await vi.advanceTimersByTimeAsync(150); // (the page refreshes the sound several times a second, with no new server message)
    near(voice.diagnostics().audioPlacement[0]?.right, 0);
    near(voice.diagnostics().audioPlacement[0]?.ahead, 5);
    // turn to face -x: now behind
    pose = { x: 0, z: 0, yaw: -Math.PI / 2 };
    await vi.advanceTimersByTimeAsync(150);
    near(voice.diagnostics().audioPlacement[0]?.ahead, -5);
    // walk up to the speaker: louder at once
    pose = { x: 4, z: 0, yaw: Math.PI / 2 };
    await vi.advanceTimersByTimeAsync(150);
    expect(voice.diagnostics().audioGains[0]).toBeCloseTo(0.81, 2);
  });

  it('takes a remote voice from its stream, not through the element, which Chrome plays as silence; the element is muted', async () => {
    makeDom();
    class Stream { getAudioTracks() { return []; } }
    vi.stubGlobal('MediaStream', Stream);
    const calls: string[] = [];
    const node = () => ({ connect(n: any) { return n; }, disconnect() {} });
    vi.stubGlobal('AudioContext', class {
      state = 'running'; currentTime = 0; destination = node();
      async resume() {}
      createMediaStreamSource() { calls.push('stream'); return node(); }
      createMediaElementSource() { calls.push('element'); return node(); }
      createGain() { return { ...node(), gain: { value: 1, setTargetAtTime() {} } }; }
      createPanner() { return { ...node(), positionX: { setTargetAtTime() {} }, positionY: { setTargetAtTime() {} }, positionZ: { setTargetAtTime() {} } }; }
    });
    await connectVoice({ participants: ['2'], position: { x: 0, z: 0 }, range: 10, participantPositions: [{ accountId: 2, x: 5, z: 0 }] });
    const track = new MockTrack();
    track.attach = () => { const element = new MockElement() as MockElement & { srcObject?: unknown; muted?: boolean }; element.srcObject = new Stream(); track.attached.push(element); return element; };
    rooms[0].emit('track-subscribed', track, {}, { identity: '2' });
    expect(calls).toEqual(['stream']);
    expect((track.attached[0] as MockElement & { muted?: boolean }).muted).toBe(true);
  });

  it('with no known facing it is not panned, and with no Web Audio the element volume carries the fade', async () => {
    makeDom();
    const { voice } = await connectVoice({ participants: ['2'], position: { x: 0, z: 0 }, range: 10, participantPositions: [{ accountId: 2, x: 5, z: 0 }] });
    const track = new MockTrack();
    rooms[0].emit('track-subscribed', track, {}, { identity: '2' });
    expect(voice.diagnostics().audioPlacement[0]).toBeNull();
    expect(track.attached[0].volume).toBeCloseTo(0.25);
  });

  it('the voices volume scales everybody on top of the fade with distance, and is saved', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
    makeDom();
    const { voice } = await connectVoice({ participants: ['2'], position: { x: 0, z: 0 }, range: 10, participantPositions: [{ accountId: 2, x: 5, z: 0 }] });
    const track = new MockTrack();
    rooms[0].emit('track-subscribed', track, {}, { identity: '2' });
    expect(voice.diagnostics().audioGains[0]).toBeCloseTo(0.25); // (5 m of 10)
    voice.setVoiceVolume(.5);
    expect(voice.diagnostics().audioGains[0]).toBeCloseTo(0.125);
    expect(voice.diagnostics().voiceVolume).toBe(.5);
    voice.setVoiceVolume(0);
    expect(voice.diagnostics().audioGains[0]).toBe(0);
    voice.setVoiceVolume(99); // (the most it can be turned up)
    expect(voice.voiceVolume()).toBe(2);
    voice.setVoiceVolume(Number.NaN);
    expect(voice.voiceVolume()).toBe(1);
    voice.setVoiceVolume(.75);
    expect(store.get('office.voice.voices')).toBe('0.75');
    // a new visit starts where it was left
    vi.resetModules();
    const { initVoice } = await loadVoice();
    expect(initVoice().voiceVolume()).toBe(.75);
  });

  it('the mic volume is a gain on the track that is sent, set live, and the microphone still works without it', async () => {
    makeDom();
    const gains: Array<{ value: number }> = [];
    class MediaStreamStub { constructor(public tracks: unknown[]) {} getAudioTracks() { return this.tracks; } }
    vi.stubGlobal('MediaStream', MediaStreamStub);
    const context = {
      currentTime: 0,
      createMediaStreamSource: () => ({ connect(n: any) { return n; }, disconnect() {} }),
      createGain: () => { const g = { gain: { value: 1, setTargetAtTime(v: number) { this.value = v; } }, connect(n: any) { return n; }, disconnect() {}, context }; gains.push(g.gain); return g; },
      createMediaStreamDestination: () => ({ stream: new MediaStreamStub([{ id: 'processed' }]) }),
    };
    mintVoiceToken.mockResolvedValueOnce(connectedCredentials()).mockResolvedValueOnce({ participants: [] });
    const { initVoice } = await loadVoice();
    const voice = initVoice();
    const mic = { setProcessor: vi.fn(async (processor: any) => { await processor.init({ kind: 'audio', track: { id: 'mic' }, audioContext: context }); }) };
    // the room has a published microphone track by the time it is connected
    MockRoom.nextConnect = async () => { (rooms.at(-1)!.localParticipant as any).audioTrackPublications = new Map([['mic', { track: mic }]]); };
    expect(await voice.connect()).toBe(true);
    expect(mic.setProcessor).toHaveBeenCalledTimes(1);
    expect(voice.diagnostics().micVolumeActive).toBe(true);
    expect(gains[0].value).toBe(1);
    voice.setMicVolume(.4);
    expect(gains[0].value).toBe(.4);
    voice.setMicVolume(5);
    expect(gains[0].value).toBe(2);
    // muting and unmuting does not set it up twice
    await voice.toggleMute(); await voice.toggleMute();
    expect(mic.setProcessor).toHaveBeenCalledTimes(1);
  });

  it('a browser that cannot process the microphone keeps connecting, with a note', async () => {
    makeDom();
    mintVoiceToken.mockResolvedValueOnce(connectedCredentials()).mockResolvedValueOnce({ participants: [] });
    const { initVoice } = await loadVoice();
    const voice = initVoice();
    MockRoom.nextConnect = async () => { (rooms.at(-1)!.localParticipant as any).audioTrackPublications = new Map([['mic', { track: { setProcessor: async () => { throw new Error('unsupported'); } } }]]); };
    expect(await voice.connect()).toBe(true);
    expect(voice.diagnostics().micVolumeActive).toBe(false);
    expect(voice.state()).not.toBe('error');
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
