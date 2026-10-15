import { mintVoiceToken } from './login.js';

/** Optional LiveKit voice lifecycle. Microphone access starts only after Connect is pressed. */
export function initVoice({ base = '', onState = () => {} } = {}) {
  let kit = null;
  let room = null;
  let connecting = null;
  let proximityTimer = null;
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
  const distanceTo = identity => {
    const remote = participantPositions.get(String(identity));
    if (!remote || !ownPosition) return null;
    return Math.hypot(remote.x - ownPosition.x, remote.z - ownPosition.z);
  };
  const applyGain = identity => {
    const key = String(identity);
    const elements = audioByParticipant.get(key);
    if (!elements) return;
    const distance = distanceTo(key);
    const gain = distance === null ? 0 : gainForDistance(distance);
    for (const element of elements) {
      element.volume = gain;
      audioNodes.get(element)?.gain?.setValueAtTime?.(gain, audioContext?.currentTime ?? 0);
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
      const source = audioContext.createMediaElementSource(element);
      const gain = audioContext.createGain();
      source.connect(gain).connect(audioContext.destination);
      audioNodes.set(element, { source, gain });
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
      audioNodes.delete(element);
      element.remove();
    }
  };
  const applyAllGains = () => { for (const identity of audioByParticipant.keys()) applyGain(identity); };
  const cleanup = () => {
    generation += 1;
    if (proximityTimer) { clearInterval(proximityTimer); proximityTimer = null; }
    allowedParticipants.clear();
    participantPositions.clear();
    ownPosition = null;
    for (const node of audioNodes.values()) {
      node.source?.disconnect();
      node.gain?.disconnect();
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
        // Room connection and proximity ACL reconciliation are separate
        // concerns. LiveKit may briefly return 503 while its participant RPC
        // is catching up; keep the connected room alive and retry ACL work on
        // the interval instead of rejecting Connect.
        await updateProximity().catch(() => false);
        if (room !== next || attempt !== generation) { await next.disconnect(); cleanup(); return false; }
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

  const toggleMute = async () => {
    if (!room) return false;
    muted = !muted;
    await room.localParticipant.setMicrophoneEnabled(!muted);
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
      allowedParticipants: [...allowedParticipants],
      audioElements: document.querySelectorAll('[data-voice-audio]').length,
      audioGains: [...audioByParticipant.values()].flat().map(element => Number(element.volume)),
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
  const originalState = onState;
  onState = update => { originalState(update); updateControls(update); };
  if (panel) panel.hidden = true;
  addEventListener('pagehide', () => { void disconnect(); }, { once: true });
  report('disabled');
  return { connect, disconnect, toggleMute, diagnostics, state: () => state, isMuted: () => muted, show: () => { if (panel) panel.hidden = false; }, hide: () => { if (panel) panel.hidden = true; void disconnect(); } };
}
