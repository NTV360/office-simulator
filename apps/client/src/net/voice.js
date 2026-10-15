import { mintVoiceToken } from './login.js';

const MIN_VOLUME = 0, MAX_VOLUME = 2;
const VOLUME_KEYS = { mic: 'office.voice.mic', voices: 'office.voice.voices' };
const clampVolume = value => (Number.isFinite(Number(value)) ? Math.max(MIN_VOLUME, Math.min(MAX_VOLUME, Number(value))) : 1);
/** A saved volume (1 = as is), or 1; storage can be missing or blocked, and the page works the same without it. */
const savedVolume = name => { try { const v = globalThis.localStorage?.getItem(VOLUME_KEYS[name]); return v === null || v === undefined ? 1 : clampVolume(v); } catch { return 1; } };
const saveVolume = (name, value) => { try { globalThis.localStorage?.setItem(VOLUME_KEYS[name], String(value)); } catch { /* not saved: it still applies now */ } };

/**
 * What others hear of you is scaled by a gain placed on the microphone track (a LiveKit audio processor: mic -> gain -> the track that is sent).
 * `level` is read by whoever sets it; the node only exists once LiveKit has started the processor.
 */
function makeMicProcessor(initial) {
  let source = null, gain = null, destination = null;
  const processor = {
    name: 'office-mic-volume',
    level: initial,
    processedTrack: undefined,
    async init(opts) {
      const context = opts.audioContext;
      if (!context?.createMediaStreamSource) throw new Error('no Web Audio for the microphone volume');
      source = context.createMediaStreamSource(new MediaStream([opts.track]));
      gain = context.createGain();
      destination = context.createMediaStreamDestination();
      gain.gain.value = processor.level;
      source.connect(gain).connect(destination);
      processor.processedTrack = destination.stream.getAudioTracks()[0];
    },
    async restart(opts) { await processor.destroy(); await processor.init(opts); },
    async destroy() {
      try { source?.disconnect(); gain?.disconnect(); } catch { /* already gone */ }
      source = gain = destination = null;
      processor.processedTrack = undefined;
    },
    set(level) {
      processor.level = level;
      if (gain) gain.gain.setTargetAtTime?.(level, gain.context?.currentTime ?? 0, .02) ?? (gain.gain.value = level);
    },
    get active() { return !!gain; },
  };
  return processor;
}

/** Optional LiveKit voice lifecycle. Microphone access starts only after Connect is pressed. */
export function initVoice({ base = '', onState = () => {}, listener = null } = {}) {
  let kit = null;
  let room = null;
  let connecting = null;
  let proximityTimer = null;
  let liveTimer = null;
  // how loud you are to others (the mic) and how loud everybody else is to you (on top of the fade with distance); 1 is as it is, saved between visits
  let micVolume = savedVolume('mic');
  let voiceVolume = savedVolume('voices');
  const micProcessor = makeMicProcessor(micVolume);
  const processedTracks = new WeakSet();
  let allowedParticipants = new Set();
  let participantPositions = new Map();
  let ownPosition = null;
  let voiceRange = 10;
  let audioByParticipant = new Map();
  // LiveKit's media element volume is not consistently honored by every browser
  // when the element is managed by the SDK. Keep a per-element Web Audio gain in
  // addition to the element fallback so proximity attenuation is audible rather
  // than only enforced as a binary server-side subscription cutoff.
  let audioContext = null;
  let audioNodes = new Map();
  let attenuationReady = typeof AudioContext === 'undefined';
  let state = 'disabled';
  let muted = false;
  let generation = 0;
  let tokenExpiresAt = 0;

  const report = (next, detail = '') => {
    state = next;
    onState({ state, detail, muted, connected: room !== null });
  };
  const loadKit = async () => { kit ??= await import('livekit-client'); return kit; };
  const gainForDistance = distance => {
    if (!Number.isFinite(distance) || !Number.isFinite(voiceRange) || voiceRange <= 0 || distance >= voiceRange) return 0;
    const ratio = Math.max(0, Math.min(1, distance / voiceRange));
    return Math.pow(1 - ratio, 2);
  };
  /**
   * Where the listener is and which way they face, live (`listener()` is the page's own position and view, so turning your head or walking
   * changes the sound at once). Without it, the position the server last sent is used and nothing is panned.
   */
  const listenerPose = () => {
    const live = listener?.();
    if (live && Number.isFinite(live.x) && Number.isFinite(live.z)) return { x: live.x, z: live.z, yaw: Number.isFinite(live.yaw) ? live.yaw : null };
    return ownPosition ? { x: ownPosition.x, z: ownPosition.z, yaw: null } : null;
  };
  const distanceTo = identity => {
    const remote = participantPositions.get(String(identity));
    const pose = listenerPose();
    if (!remote || !pose) return null;
    return Math.hypot(remote.x - pose.x, remote.z - pose.z);
  };
  /**
   * Where the speaker is from the listener's ears: right (+) or left (-), and ahead (+) or behind (-), in metres. The game faces (sin yaw, cos yaw)
   * with its right hand at (-cos yaw, sin yaw). Null when the listener's facing is not known.
   */
  const placementOf = identity => {
    const remote = participantPositions.get(String(identity));
    const pose = listenerPose();
    if (!remote || !pose || pose.yaw === null) return null;
    const dx = remote.x - pose.x, dz = remote.z - pose.z;
    return { right: -dx * Math.cos(pose.yaw) + dz * Math.sin(pose.yaw), ahead: dx * Math.sin(pose.yaw) + dz * Math.cos(pose.yaw) };
  };
  const applyGain = identity => {
    const key = String(identity);
    const elements = audioByParticipant.get(key);
    if (!elements) return;
    const distance = distanceTo(key);
    const gain = distance === null ? 0 : gainForDistance(distance) * voiceVolume;
    const placement = placementOf(key);
    const now = audioContext?.currentTime ?? 0;
    for (const element of elements) {
      const node = audioNodes.get(element);
      if (!node) { element.volume = Math.min(1, gain); continue; } // (no Web Audio here: the element's own volume is all there is, and it cannot go above 1)
      // The volume is applied once, by the gain node (applied to the element as well it would be squared, far too quiet at a distance)
      element.volume = 1;
      node.level = gain;
      node.gain.gain.setTargetAtTime(gain, now, .05);
      node.placement = placement;
      const panner = node.panner;
      if (panner) {
        // (the listener stays at the origin facing -z, the Web Audio default: the speaker is put where they are from the listener)
        const x = placement ? placement.right : 0, z = placement ? -placement.ahead : -1;
        if (panner.positionX) { panner.positionX.setTargetAtTime(x, now, .08); panner.positionY.setTargetAtTime(0, now, .08); panner.positionZ.setTargetAtTime(z, now, .08); }
        else panner.setPosition?.(x, 0, z);
      }
    }
  };
  const resumeAudio = async () => {
    if (typeof AudioContext === 'undefined') return false;
    try {
      audioContext ??= new AudioContext();
      if (audioContext.state === 'suspended') await audioContext.resume();
      return audioContext.state === 'running';
    } catch {
      return false;
    }
  };
  const ensureAudioNode = element => {
    if (audioNodes.has(element) || typeof AudioContext === 'undefined') return;
    try {
      audioContext ??= new AudioContext();
      // A remote voice is a WebRTC stream. Chrome gives silence when such a stream is routed through createMediaElementSource, so take it from the stream
      // itself; the element stays (it keeps the stream playing) but is muted, because the sound now comes out through the Web Audio chain below.
      const stream = element.srcObject;
      const fromStream = typeof MediaStream !== 'undefined' && stream instanceof MediaStream && typeof audioContext.createMediaStreamSource === 'function';
      const source = fromStream ? audioContext.createMediaStreamSource(stream) : audioContext.createMediaElementSource(element);
      if (fromStream) element.muted = true;
      const gain = audioContext.createGain();
      // Where the voice comes from: an HRTF panner (left/right, and front/back on headphones). It does no distance fade of its own (the gain does).
      let panner = null;
      if (audioContext.createPanner) {
        panner = audioContext.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 1;
        panner.rolloffFactor = 0;
      }
      source.connect(gain);
      if (panner) gain.connect(panner).connect(audioContext.destination); else gain.connect(audioContext.destination);
      audioNodes.set(element, { source, gain, panner, level: 1, placement: null });
    } catch { /* element.volume remains the portable fallback */ }
  };
  const attachAudio = (track, identity) => {
    const key = String(identity);
    const elements = track.attach();
    const attached = Array.isArray(elements) ? elements : [elements];
    for (const element of attached) {
      element.dataset.voiceAudio = key;
      element.setAttribute('aria-hidden', 'true');
      document.body.append(element);
      ensureAudioNode(element);
    }
    audioByParticipant.set(key, attached);
    applyGain(key);
  };
  const removeAudio = track => {
    for (const element of track.detach()) {
      const key = element.dataset.voiceAudio;
      if (key && audioByParticipant.get(key)?.includes(element)) {
        const remaining = audioByParticipant.get(key).filter(candidate => candidate !== element);
        if (remaining.length) audioByParticipant.set(key, remaining); else audioByParticipant.delete(key);
      }
      const node = audioNodes.get(element);
      node?.source?.disconnect();
      node?.gain?.disconnect();
      node?.panner?.disconnect();
      audioNodes.delete(element);
      element.remove();
    }
  };
  /** Drop every audio element held for this person, whatever state LiveKit's track is in (an out-of-range voice must not linger, even silent). */
  const removeParticipantAudio = identity => {
    const key = String(identity);
    for (const element of audioByParticipant.get(key) ?? []) {
      const node = audioNodes.get(element);
      node?.source?.disconnect();
      node?.gain?.disconnect();
      node?.panner?.disconnect();
      audioNodes.delete(element);
      element.remove();
    }
    audioByParticipant.delete(key);
    document.querySelectorAll(`[data-voice-audio="${CSS.escape(key)}"]`).forEach(element => element.remove());
  };
  const applyAllGains = () => { for (const identity of audioByParticipant.keys()) applyGain(identity); };
  const cleanup = () => {
    generation += 1;
    if (proximityTimer) { clearInterval(proximityTimer); proximityTimer = null; }
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
    allowedParticipants.clear();
    participantPositions.clear();
    ownPosition = null;
    for (const node of audioNodes.values()) {
      node.source?.disconnect();
      node.gain?.disconnect();
      node.panner?.disconnect();
    }
    audioNodes.clear();
    audioByParticipant.clear();
    room = null;
    muted = false;
    tokenExpiresAt = 0;
    document.querySelectorAll('[data-voice-audio]').forEach(element => element.remove());
  };
  const disconnect = async () => {
    const active = room;
    cleanup();
    if (active) await active.disconnect();
    report('disconnected');
  };
  const connect = () => {
    if (connecting) return connecting;
    connecting = (async () => {
      // Connect is a user gesture; resume the gain graph here rather than
      // waiting for TrackSubscribed, which may occur outside that gesture.
      attenuationReady = await resumeAudio();
      const attempt = generation;
      report('connecting', attenuationReady || typeof AudioContext === 'undefined' ? '' : 'Connected; browser audio attenuation unavailable');
      const credentials = await mintVoiceToken(base);
      if (attempt !== generation) return false;
      if (!credentials?.token || !credentials.url) {
        report(credentials?.loggedOut ? 'session-ended' : 'unavailable', credentials?.unavailable ? 'Voice service is unavailable' : 'Voice is not configured');
        return false;
      }
      tokenExpiresAt = Date.now() + (Number(credentials.expiresIn) || 300) * 1000;
      const livekit = await loadKit();
      const next = new livekit.Room({ adaptiveStream: true, dynacast: true, autoSubscribe: false });
      next.on(livekit.RoomEvent.Disconnected, () => {
        if (room === next) {
          cleanup();
          report('disconnected');
        }
      });
      next.on(livekit.RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (track.kind !== livekit.Track.Kind.Audio || !allowedParticipants.has(participant.identity)) return;
        attachAudio(track, participant.identity);
      });
      next.on(livekit.RoomEvent.TrackUnsubscribed, removeAudio);
      try {
        await next.connect(credentials.url, credentials.token);
        if (attempt !== generation) { await next.disconnect(); return false; }
        await next.localParticipant.setMicrophoneEnabled(true);
        if (attempt !== generation) { await next.disconnect(); return false; }
        room = next;
        await applyMicVolume(next);
        // Room connection and proximity ACL reconciliation are separate
        // concerns. LiveKit may briefly return 503 while its participant RPC
        // is catching up; keep the connected room alive and retry ACL work on
        // the interval instead of rejecting Connect.
        await updateProximity().catch(() => false);
        if (room !== next || attempt !== generation) { await next.disconnect(); cleanup(); return false; }
        // the sound follows where you stand and look several times a second (the server's positions arrive once a second)
        liveTimer = setInterval(applyAllGains, 100);
        proximityTimer = setInterval(() => {
          void updateProximity().catch(() => {
            // A transient token/ACL refresh failure must not turn an otherwise
            // connected room into an unusable error state. Keep the controls
            // available and retry on the next interval; the server-side ACL
            // remains the authority for proximity access.
            if (room === next) report(muted ? 'muted' : 'connected');
          });
        }, 1000);
        report('connected', attenuationReady || typeof AudioContext === 'undefined' ? '' : 'Connected; browser audio attenuation unavailable');
        return true;
      } catch (error) {
        await next.disconnect().catch(() => {});
        document.querySelectorAll('[data-voice-audio]').forEach(element => element.remove());
        throw error;
      }
    })().catch(error => { report('error', error instanceof Error ? error.message : String(error)); return false; }).finally(() => { connecting = null; });
    return connecting;
  };
  const updateProximity = async () => {
    const activeRoom = room;
    const attempt = generation;
    if (!activeRoom) return false;
    const response = await mintVoiceToken(base);
    if (room !== activeRoom || generation !== attempt) return false;
    if (response?.loggedOut) {
      await disconnect();
      report('session-ended');
      return false;
    }
    if (response?.token && activeRoom.updateToken && Date.now() + 60_000 >= tokenExpiresAt) {
      await activeRoom.updateToken(response.token);
      if (room !== activeRoom || generation !== attempt) return false;
      tokenExpiresAt = Date.now() + (Number(response.expiresIn) || 300) * 1000;
    }
    if (!Array.isArray(response?.participants)) {
      allowedParticipants.clear();
      participantPositions.clear();
      ownPosition = null;
      applyAllGains();
      return false;
    }
    if (room !== activeRoom || generation !== attempt) return false;
    allowedParticipants = new Set(response.participants.map(String));
    voiceRange = Number.isFinite(response.range) && response.range > 0 ? response.range : 10;
    ownPosition = response.position && Number.isFinite(response.position.x) && Number.isFinite(response.position.z)
      ? { x: response.position.x, z: response.position.z }
      : null;
    participantPositions = new Map(Array.isArray(response.participantPositions)
      ? response.participantPositions
        .filter(participant => Number.isInteger(participant?.accountId) && Number.isFinite(participant.x) && Number.isFinite(participant.z))
        .map(participant => [String(participant.accountId), { x: participant.x, z: participant.z }])
      : []);
    applyAllGains();
    for (const participant of activeRoom.remoteParticipants.values()) {
      const enabled = allowedParticipants.has(participant.identity);
      for (const publication of participant.audioTrackPublications.values()) {
        if (enabled) {
          if (publication.setSubscribed && !publication.isSubscribed) {
            try {
              await publication.setSubscribed(true);
            } catch {
              // LiveKit can briefly reject a subscription while the room
              // service is reconciling the server-side ACL. Retry next time.
              continue;
            }
            if (room !== activeRoom || generation !== attempt) return false;
          }
          if (publication.isSubscribed && publication.setEnabled) await publication.setEnabled(true);
          if (publication.isSubscribed && publication.track && !document.querySelector(`[data-voice-audio="${CSS.escape(participant.identity)}"]`)) {
            attachAudio(publication.track, participant.identity);
          }
        } else {
          const track = publication.track;
          if (track) removeAudio(track);
          removeParticipantAudio(participant.identity);
          if (publication.isSubscribed && publication.setSubscribed) {
            // Detach locally before awaiting LiveKit's room-service revoke.
            // A delayed RPC must not leave audible media attached after the
            // authoritative position response has removed the participant.
            void publication.setSubscribed(false).catch(() => {
              // Retry a failed revoke on the next proximity refresh.
            });
          }
        }
      }
    }
    return true;
  };

  /** Put the volume control on the microphone track (once per track). A browser without it keeps the plain microphone and says so. */
  const applyMicVolume = async activeRoom => {
    const publications = activeRoom?.localParticipant?.audioTrackPublications;
    for (const publication of publications ? [...publications.values()] : []) {
      const track = publication.track;
      if (!track?.setProcessor || processedTracks.has(track)) continue;
      try {
        await track.setProcessor(micProcessor);
        processedTracks.add(track);
      } catch {
        report(state, 'Microphone volume is not available in this browser');
      }
    }
  };
  /**
   * The loudest the sound has been, left ear and right ear, over the next `ms` (for runtime checks: it reads the real signal that reaches the speakers,
   * the first voice that is playing). The analysers are connected for the measurement only, so nothing runs when nobody asks.
   */
  const measureOutput = async (ms = 2500) => {
    const element = [...audioByParticipant.values()].flat()[0];
    const node = element && audioNodes.get(element);
    if (!node?.panner || !audioContext?.createChannelSplitter || !audioContext.createAnalyser) return null;
    const splitter = audioContext.createChannelSplitter(2);
    const left = audioContext.createAnalyser(), right = audioContext.createAnalyser();
    left.fftSize = right.fftSize = 2048;
    node.panner.connect(splitter);
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    const a = new Float32Array(left.fftSize), b = new Float32Array(right.fftSize);
    let peakLeft = 0, peakRight = 0;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      left.getFloatTimeDomainData(a);
      right.getFloatTimeDomainData(b);
      for (let i = 0; i < a.length; i++) { peakLeft = Math.max(peakLeft, Math.abs(a[i])); peakRight = Math.max(peakRight, Math.abs(b[i])); }
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    try { node.panner.disconnect(splitter); splitter.disconnect(); } catch { /* the voice went away meanwhile */ }
    return { left: peakLeft, right: peakRight };
  };
  const setMicVolume = value => {
    micVolume = clampVolume(value);
    micProcessor.set(micVolume);
    saveVolume('mic', micVolume);
    return micVolume;
  };
  const setVoiceVolume = value => {
    voiceVolume = clampVolume(value);
    saveVolume('voices', voiceVolume);
    applyAllGains();
    return voiceVolume;
  };

  const toggleMute = async () => {
    if (!room) return false;
    muted = !muted;
    await room.localParticipant.setMicrophoneEnabled(!muted);
    if (!muted) await applyMicVolume(room); // (a track made again after being muted gets the control too)
    report(muted ? 'muted' : 'connected');
    return true;
  };
  /** Non-secret state for browser diagnostics and runtime verification. */
  const diagnostics = () => {
    const active = room;
    const publications = active?.localParticipant?.audioTrackPublications;
    return {
      state,
      detail: state === 'error' ? 'voice connection failed' : '',
      connected: !!active,
      muted,
      attenuationReady,
      micVolume,
      micVolumeActive: micProcessor.active,
      voiceVolume,
      allowedParticipants: [...allowedParticipants],
      audioElements: document.querySelectorAll('[data-voice-audio]').length,
      audioGains: [...audioByParticipant.values()].flat().map(element => audioNodes.get(element)?.level ?? Number(element.volume)),
      audioPlacement: [...audioByParticipant.values()].flat().map(element => audioNodes.get(element)?.placement ?? null),
      ownPosition,
      participantPositions: [...participantPositions.entries()],
      localAudio: publications ? [...publications.values()].map(publication => ({
        subscribed: !!publication.isSubscribed,
        enabled: publication.isEnabled !== false,
        track: !!publication.track,
      })) : [],
      remoteAudio: active ? [...active.remoteParticipants.values()].map(participant => ({
        identity: participant.identity,
        publications: [...participant.audioTrackPublications.values()].map(publication => ({
          subscribed: !!publication.isSubscribed,
          enabled: publication.isEnabled !== false,
          track: !!publication.track,
        })),
      })) : [],
    };
  };

  const panel = document.getElementById('voicePanel');
  const status = document.getElementById('voiceStatus');
  const connectButton = document.getElementById('voiceConnect');
  const muteButton = document.getElementById('voiceMute');
  const updateControls = ({ state: next, detail, muted: isMuted }) => {
    if (status) status.textContent = detail || (next === 'connected' ? 'Connected' : next === 'muted' ? 'Muted' : next);
    if (connectButton) { connectButton.hidden = next === 'connected' || next === 'muted'; connectButton.disabled = next === 'connecting'; }
    if (muteButton) { muteButton.hidden = !(next === 'connected' || next === 'muted'); muteButton.textContent = isMuted ? 'Unmute' : 'Mute'; }
  };
  connectButton?.addEventListener('click', () => { void connect(); });
  muteButton?.addEventListener('click', () => { void toggleMute(); });
  // the two sliders (percent): what others hear of you, and how loud everybody is to you
  const micSlider = document.getElementById('voiceMicVolume');
  const voicesSlider = document.getElementById('voiceVoicesVolume');
  const showPercent = (slider, value) => {
    if (slider) slider.value = String(Math.round(value * 100));
    const label = document.getElementById(slider?.id === 'voiceMicVolume' ? 'voiceMicValue' : 'voiceVoicesValue');
    if (label) label.textContent = `${Math.round(value * 100)}%`;
  };
  showPercent(micSlider, micVolume);
  showPercent(voicesSlider, voiceVolume);
  micSlider?.addEventListener('input', () => showPercent(micSlider, setMicVolume(Number(micSlider.value) / 100)));
  voicesSlider?.addEventListener('input', () => showPercent(voicesSlider, setVoiceVolume(Number(voicesSlider.value) / 100)));
  const originalState = onState;
  onState = update => { originalState(update); updateControls(update); };
  if (panel) panel.hidden = true;
  addEventListener('pagehide', () => { void disconnect(); }, { once: true });
  report('disabled');
  return { connect, disconnect, toggleMute, setMicVolume, setVoiceVolume, measureOutput, micVolume: () => micVolume, voiceVolume: () => voiceVolume, diagnostics, state: () => state, isMuted: () => muted, show: () => { if (panel) panel.hidden = false; }, hide: () => { if (panel) panel.hidden = true; void disconnect(); } };
}
