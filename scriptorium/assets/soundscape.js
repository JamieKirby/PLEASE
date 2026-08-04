/* ==========================================================================
   Burren — ambient soundscape engine.

   Procedurally synthesized (filtered noise + slow LFOs) via the native
   Web Audio API — no audio files to host or license. Four broad modes
   (wind / water / woodland / meadow) that the many specific habitat tags
   map down to, cross-fading between them rather than hard-cutting.

   This is DSP written and reasoned through rather than tuned by ear —
   the structure (noise source -> filter -> slow LFO modulation -> gain)
   is sound, but treat the exact tone/levels as a first draft, not a
   finished mix.

   Starts silent; playback only begins on an explicit user click (both
   because that's the "non-intrusive" ask and because browsers block
   AudioContext startup without a user gesture regardless).

   ---- WHY THIS IS ITS OWN FILE NOW ----

   index.html used to carry this inlined, with a comment saying it was
   "the same module used on the Scriptorium pages
   (scriptorium/assets/scriptorium-soundscape.js), inlined here to keep
   this map file self-contained." That second file did not exist in the
   repo. So the Scriptorium had no soundscape at all, and the comment
   described an intent rather than a state of affairs.

   This is that file, for real, loaded by both surfaces. A page
   navigation destroys the AudioContext, so the audio genuinely stops
   when you cross between the map and a Scriptorium page — what carries
   across is the preference (playing / volume / mode, via state.js), and
   the other side fades back in on its first user gesture. That reads as
   continuous without pretending to be.
   ========================================================================== */
(function (root) {
  'use strict';


  var ctx = null;
  var master = null;
  var modeGains = {};
  var MODES = ['wind', 'water', 'woodland', 'meadow'];
  var currentMode = null;
  var isPlaying = false;
  var userVolume = 0.15; // default 15%, per the "quiet by default" ask
  var duckedFactor = 1;
  var CROSSFADE_SEC = 2.6;

  // The many specific habitat tags used across sites/flora collapse down
  // to just four ambience families — enough variety to feel context-aware
  // without needing a distinct stem per habitat tag.
  var HABITAT_TO_MODE = {
    'Upland': 'wind', 'Limestone Pavement': 'wind', 'Exposed Limestone Rock': 'wind',
    'Coastal Dune': 'wind', 'Short Turf / Grassland': 'wind',
    'Wetland / Turlough': 'water', 'Freshwater Lake': 'water', 'Coastal Bay': 'water', 'Cave System': 'water',
    'Hazel Woodland': 'woodland', 'Hazel Scrub': 'woodland',
    'Meadow': 'meadow', 'Calcareous Grassland': 'meadow', 'Grassland Grips': 'meadow'
  };

  function makeNoiseBuffer(audioCtx, seconds) {
    var rate = audioCtx.sampleRate;
    var length = Math.floor(rate * seconds);
    var buffer = audioCtx.createBuffer(1, length, rate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  // A slow sub-audible oscillator used purely as a modulation source
  // (e.g. wandering a filter's cutoff for a "gusting" feel), scaled down
  // through its own gain node before reaching the target AudioParam.
  function makeLFO(audioCtx, freq, depth, targetParam) {
    var lfo = audioCtx.createOscillator();
    lfo.frequency.value = freq;
    var scaler = audioCtx.createGain();
    scaler.gain.value = depth;
    lfo.connect(scaler);
    scaler.connect(targetParam);
    lfo.start();
    return lfo;
  }

  function buildMode(audioCtx, mode) {
    var gain = audioCtx.createGain();
    gain.gain.value = 0;
    var noise = audioCtx.createBufferSource();
    noise.buffer = makeNoiseBuffer(audioCtx, 4);
    noise.loop = true;

    if (mode === 'wind') {
      var windFilter = audioCtx.createBiquadFilter();
      windFilter.type = 'lowpass'; windFilter.frequency.value = 500; windFilter.Q.value = 0.7;
      makeLFO(audioCtx, 0.07, 220, windFilter.frequency);
      noise.connect(windFilter); windFilter.connect(gain);
    } else if (mode === 'water') {
      var waterFilter = audioCtx.createBiquadFilter();
      waterFilter.type = 'bandpass'; waterFilter.frequency.value = 1100; waterFilter.Q.value = 0.9;
      makeLFO(audioCtx, 0.11, 300, waterFilter.frequency);
      var rumble = audioCtx.createOscillator();
      rumble.type = 'sine'; rumble.frequency.value = 70;
      var rumbleGain = audioCtx.createGain(); rumbleGain.gain.value = 0.05;
      rumble.connect(rumbleGain); rumbleGain.connect(gain);
      rumble.start();
      noise.connect(waterFilter); waterFilter.connect(gain);
    } else if (mode === 'woodland') {
      var woodFilter = audioCtx.createBiquadFilter();
      woodFilter.type = 'highpass'; woodFilter.frequency.value = 2200; woodFilter.Q.value = 0.6;
      makeLFO(audioCtx, 0.05, 500, woodFilter.frequency);
      noise.connect(woodFilter); woodFilter.connect(gain);
    } else { // meadow
      var meadowFilter = audioCtx.createBiquadFilter();
      meadowFilter.type = 'bandpass'; meadowFilter.frequency.value = 900; meadowFilter.Q.value = 0.5;
      var ampLfo = audioCtx.createOscillator(); ampLfo.frequency.value = 0.09;
      var ampScaler = audioCtx.createGain(); ampScaler.gain.value = 0.15;
      ampLfo.connect(ampScaler); ampScaler.connect(gain.gain);
      ampLfo.start();
      noise.connect(meadowFilter); meadowFilter.connect(gain);
    }
    noise.start();
    gain.connect(master);
    return gain;
  }

  function ensureContext() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    MODES.forEach(function (m) { modeGains[m] = buildMode(ctx, m); });
  }

  function modeForHabitats(tags) {
    if (!tags || !tags.length) return null;
    for (var i = 0; i < tags.length; i++) { if (HABITAT_TO_MODE[tags[i]]) return HABITAT_TO_MODE[tags[i]]; }
    return null;
  }

  function crossfadeTo(mode) {
    if (!ctx || mode === currentMode) return;
    currentMode = mode;
    var now = ctx.currentTime;
    MODES.forEach(function (m) {
      var g = modeGains[m];
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(m === mode ? 1 : 0, now + CROSSFADE_SEC);
    });
  }

  function applyVolume() {
    if (!ctx) return;
    var now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(isPlaying ? userVolume * duckedFactor : 0, now + 0.4);
  }

  var Soundscape = {
    // Called when a drawer/entry with habitat tags becomes active. Safe
    // to call before play() — it just remembers the mode for whenever
    // playback starts.
    setHabitat: function (tags) {
      var mode = modeForHabitats(tags) || currentMode || 'wind';
      if (!ctx) { currentMode = mode; updateModeLabel(); return; }
      crossfadeTo(mode);
      updateModeLabel();
    },
    play: function () {
      ensureContext();
      if (ctx.state === 'suspended') ctx.resume();
      isPlaying = true;
      if (!currentMode) currentMode = 'wind';
      var mode = currentMode;
      currentMode = null; // force crossfadeTo to actually ramp the chosen mode up from 0
      crossfadeTo(mode);
      applyVolume();
      updateModeLabel();
    },
    pause: function () { isPlaying = false; applyVolume(); },
    toggle: function () { if (isPlaying) this.pause(); else this.play(); return isPlaying; },
    setVolume: function (v) { userVolume = Math.max(0, Math.min(1, v)); applyVolume(); },
    // Ducks under a pronunciation/bird-call trigger without pausing outright
    // (and without fighting the user's own volume setting — duckedFactor is
    // a multiplier on top of it, restored to 1 on unduck).
    duck: function () { duckedFactor = 0.25; applyVolume(); },
    unduck: function () { duckedFactor = 1; applyVolume(); },
    isPlaying: function () { return isPlaying; },
    getVolume: function () { return userVolume; },
    getMode: function () { return currentMode; }
  };

  function updateModeLabel() {
    var label = document.getElementById('soundscapeModeLabel');
    if (label && currentMode) label.textContent = currentMode.charAt(0).toUpperCase() + currentMode.slice(1);
  }

  // Builds the small persistent control widget (play/pause, volume,
  // current-mode label) once per page. Call Soundscape.mount() after
  // the page's own DOM is ready; safe to call more than once. No
  // longer appends itself anywhere — it now lives inside the burger
  // menu (see renderBurgerMenu, which re-attaches this same node,
  // listeners intact, every time the menu panel is rebuilt) rather
  // than as a standalone floating widget.
  Soundscape.mount = function () {
    if (Soundscape.widgetEl) return;
    var el = document.createElement('div');
    el.id = 'soundscapeWidget';
    el.className = 'soundscape-widget';
    el.innerHTML =
      '<button class="soundscape-toggle" id="soundscapeToggle" aria-label="Play ambient soundscape" title="Play ambient soundscape">' +
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>' +
      '<input class="soundscape-volume" id="soundscapeVolume" type="range" min="0" max="100" value="15" aria-label="Soundscape volume">' +
      '<span class="soundscape-mode" id="soundscapeModeLabel">' + (currentMode ? currentMode.charAt(0).toUpperCase() + currentMode.slice(1) : 'Wind') + '</span>';
    var toggleBtn = el.querySelector('#soundscapeToggle');
    toggleBtn.addEventListener('click', function () {
      var playing = Soundscape.toggle();
      toggleBtn.classList.toggle('playing', playing);
      toggleBtn.innerHTML = playing
        ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    });
    el.querySelector('#soundscapeVolume').addEventListener('input', function (e) {
      Soundscape.setVolume(e.target.value / 100);
    });
    Soundscape.widgetEl = el;
  };

  // Restores the stored preference so crossing between the map and a
  // Scriptorium page doesn't reset the mix. Volume and mode are applied
  // immediately; PLAYBACK is not auto-resumed, because browsers require a
  // user gesture to start an AudioContext and attempting it here would
  // just log a console error on every page load. seam.js arms a one-shot
  // gesture listener instead (see resumeOnFirstGesture).
  Soundscape.restorePrefs = function () {
    if (!root.BurrenState) return null;
    var prefs = root.BurrenState.soundscape.get();
    Soundscape.setVolume(prefs.volume);
    if (prefs.mode) Soundscape.setHabitat([prefs.mode]);
    return prefs;
  };
  Soundscape.persistPrefs = function () {
    if (!root.BurrenState) return;
    root.BurrenState.soundscape.set({
      playing: Soundscape.isPlaying(),
      volume: Soundscape.getVolume(),
      mode: Soundscape.getMode()
    });
  };

  root.BurrenSoundscape = Soundscape;
}(typeof self !== 'undefined' ? self : this));
