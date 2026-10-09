/*
 * Cursor-follow Dalmatian.
 *
 * The source video (1280×720, 24fps) is split into a static background plate and
 * a 480×530 crop of the dog per frame. Each look direction is a "track": an ordered
 * list of frames from neutral to the full pose. The cursor sets a target
 * {axis, amount}; a smoothed state follows it (≈130ms lag, so the head eases
 * after the pointer) and always passes back through neutral before switching axis —
 * exactly how the reference animation moves. Only big pose jumps are crossfaded;
 * neighbouring frames swap instantly so the dog keeps up with the cursor.
 */
(() => {
  const SRC = { w: 1280, h: 720 };
  const CROP = { x: 520, y: 110, w: 480, h: 530 };
  const HEAD = { x: 795, y: 200 }; // head/eye centre in source pixels

  const range = (a, b, step = 1) => {
    const out = [];
    if (step > 0) for (let i = a; i <= b; i += step) out.push(i);
    else for (let i = a; i >= b; i += step) out.push(i);
    return out;
  };

  // Frame numbers refer to assets/frames/NNN.webp (source video frame index).
  // Blinks in the source have been skipped.
  const TRACKS = {
    left: [0, ...range(29, 50)],
    right: [0, ...range(12, 24, 2), ...range(56, 68)], // eyes lead, then the head turns
    up: [0, ...range(92, 108)],
    down: [0, ...range(128, 138)],
  };
  const IDLE = [...range(0, 9), ...range(8, 1, -1)]; // subtle breathing loop at neutral

  // Reference timeline from the video brief (ms → pose), used by "Play with me"
  // and the ambient demo on touch devices.
  const ROUTINE = [
    [0, null, 0],
    [500, 'left', 0.35],
    [750, 'left', 1],
    [1750, null, 0],
    [2000, 'right', 0.38], // eyes shift first…
    [2250, 'right', 1], // …then the head follows
    [3250, null, 0],
    [3500, 'up', 1],
    [4250, 'down', 1],
    [5000, null, 0],
    [6000, null, 0],
  ];

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = matchMedia('(hover: none), (pointer: coarse)');

  const canvas = document.getElementById('dog');
  const stage = document.getElementById('stage');
  const hero = document.getElementById('hero');
  const playBtn = document.getElementById('play');
  if (!canvas || !stage) return;
  const ctx = canvas.getContext('2d');

  /* ---------- frame loading ---------- */

  const frames = new Map(); // index → HTMLImageElement (decoded)
  const pad = (n) => String(n).padStart(3, '0');
  const all = [...new Set([...IDLE, ...TRACKS.left, ...TRACKS.right, ...TRACKS.up, ...TRACKS.down])];

  function load(i) {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = `assets/frames/${pad(i)}.webp`;
      const done = () => { frames.set(i, img); dirty = true; resolve(); };
      (img.decode ? img.decode() : new Promise((r) => (img.onload = r))).then(done, resolve);
    });
  }

  async function loadAll() {
    await load(0);
    // Pose "anchor" frames first so every direction works quickly, then everything else in parallel.
    await Promise.all([29, 40, 18, 62, 100, 133].map(load));
    await Promise.all(all.filter((i) => !frames.has(i)).map(load));
  }

  // When an in-between isn't loaded yet, fall back to the nearest loaded frame of the track.
  function available(track, idx) {
    for (let d = 0; d < track.length; d++) {
      if (frames.has(track[idx - d])) return track[idx - d];
      if (frames.has(track[idx + d])) return track[idx + d];
    }
    return 0;
  }

  /* ---------- state ---------- */

  const target = { axis: null, mag: 0 };
  const state = { axis: null, mag: 0 };
  const TAU = 0.13; // seconds — follow lag (relaxed: the head eases after the cursor)
  const FADE = 120; // ms crossfade, only for pose jumps

  let shown = 0;
  let prev = 0;
  let fadeStart = -1e9;
  let dirty = true;
  let running = true;
  let lastInput = performance.now();
  let pointerInside = false;
  let routineStart = -1;
  let routineFromButton = false;
  let pointer = null; // latest pointer position, consumed once per frame

  function setTarget(axis, mag) {
    target.axis = mag > 0.001 ? axis : null;
    target.mag = target.axis ? Math.min(1, Math.max(0, mag)) : 0;
  }

  // Convert a viewport point into a look target relative to the dog's head.
  function lookAt(px, py) {
    const r = stage.getBoundingClientRect();
    const hx = r.left + (HEAD.x / SRC.w) * r.width;
    const hy = r.top + (HEAD.y / SRC.h) * r.height;
    const vw = innerWidth;
    const vh = innerHeight;
    const dx = px - hx;
    const dy = py - hy;
    // normalise per side; the full pose is reached ~85% of the way to the screen edge
    const nx = dx < 0 ? dx / Math.max(hx * 0.85, 140) : dx / Math.max((vw - hx) * 0.85, 140);
    const ny = dy < 0 ? dy / Math.max(hy * 0.8, 120) : dy / Math.max((vh - hy) * 0.6, 120);
    const ax = Math.min(1, Math.abs(nx));
    const ay = Math.min(1, Math.abs(ny));
    const DEAD = 0.06;
    const shape = (v) => Math.max(0, (v - DEAD) / (1 - DEAD));
    if (ax * 1.15 >= ay) setTarget(nx < 0 ? 'left' : 'right', shape(ax));
    else setTarget(ny < 0 ? 'up' : 'down', shape(ay));
  }

  /* ---------- input ---------- */

  let touchRelease = 0;

  addEventListener('pointermove', (e) => {
    if (!e.isPrimary || routineFromButton) return;
    lastInput = performance.now();
    pointerInside = e.pointerType !== 'touch';
    routineStart = -1;
    pointer = { x: e.clientX, y: e.clientY };
    wake();
  }, { passive: true });

  hero.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || routineFromButton) return;
    lastInput = performance.now();
    routineStart = -1;
    touchRelease = 0;
    pointer = { x: e.clientX, y: e.clientY };
    wake();
  }, { passive: true });

  const releaseTouch = (e) => {
    if (e.pointerType !== 'touch') return;
    touchRelease = performance.now();
  };
  addEventListener('pointerup', releaseTouch, { passive: true });
  addEventListener('pointercancel', releaseTouch, { passive: true });

  const relax = () => {
    pointerInside = false;
    pointer = null;
    lastInput = performance.now();
    if (!routineFromButton) setTarget(null, 0);
  };
  document.documentElement.addEventListener('pointerleave', relax);
  addEventListener('blur', relax);

  playBtn?.addEventListener('click', () => {
    routineStart = performance.now();
    routineFromButton = true;
    pointer = null;
    playBtn.setAttribute('aria-pressed', 'true');
    wake();
  });

  /* ---------- routine (scripted look-around) ---------- */

  function routineTarget(t) {
    let k = ROUTINE[0];
    for (const key of ROUTINE) if (key[0] <= t) k = key;
    setTarget(k[1], k[2]);
    return t >= ROUTINE[ROUTINE.length - 1][0];
  }

  /* ---------- loop ---------- */

  let last = performance.now();
  let idleClock = 0;
  let rafId = 0;

  function wake() {
    if (!rafId && running) { last = performance.now(); rafId = requestAnimationFrame(tick); }
  }

  function tick(now) {
    rafId = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (pointer) { lookAt(pointer.x, pointer.y); pointer = null; }

    // touch: hold the look briefly after the finger lifts, then relax
    if (touchRelease && now - touchRelease > 1400 && routineStart < 0) {
      touchRelease = 0;
      setTarget(null, 0);
    }

    // ambient demo: touch devices (or a mouse that left the page) after a quiet spell
    const quiet = now - lastInput;
    if (routineStart < 0 && !reduceMotion.matches && !pointerInside && quiet > (coarse.matches ? 3500 : 6000)) {
      routineStart = now;
    }
    if (routineStart >= 0) {
      if (routineTarget(now - routineStart)) {
        routineStart = -1;
        lastInput = now; // pause before the next ambient cycle
        if (routineFromButton) {
          routineFromButton = false;
          playBtn?.setAttribute('aria-pressed', 'false');
        }
      }
    }

    // follow: must pass through neutral before changing axis
    const k = 1 - Math.exp(-dt / TAU);
    if (state.axis && target.axis !== state.axis) {
      state.mag += (0 - state.mag) * Math.min(1, k * 1.4);
      if (state.mag < 0.08) { state.axis = target.axis; state.mag = 0; }
    } else {
      if (!state.axis) state.axis = target.axis;
      state.mag += (target.mag - state.mag) * k;
      if (!target.axis && state.mag < 0.02) { state.axis = null; state.mag = 0; }
    }

    // choose frame
    let frame;
    let trackPos = 0;
    if (state.axis && state.mag > 0.01) {
      const track = TRACKS[state.axis];
      trackPos = Math.round(state.mag * (track.length - 1));
      frame = trackPos === 0 ? 0 : available(track, trackPos);
    } else if (reduceMotion.matches) {
      frame = 0;
    } else {
      idleClock += dt;
      frame = IDLE[Math.floor(idleClock * 9) % IDLE.length];
      if (!frames.has(frame)) frame = 0;
    }

    if (frame !== shown && frames.has(frame)) {
      // neighbouring source frames swap instantly; only real pose jumps get a crossfade
      const jump = Math.abs(frame - shown) > 2;
      prev = shown;
      shown = frame;
      fadeStart = jump ? now : -1e9;
      dirty = true;
    }

    const p = Math.min(1, (now - fadeStart) / FADE);
    if (dirty || p < 1) draw(p);

    rafId = requestAnimationFrame(tick);
  }

  function draw(p) {
    dirty = false;
    const cur = frames.get(shown);
    const old = frames.get(prev);
    if (!cur) return;
    ctx.globalAlpha = 1;
    if (p < 1 && old) {
      ctx.drawImage(old, 0, 0, CROP.w, CROP.h);
      ctx.globalAlpha = p * p * (3 - 2 * p);
    }
    ctx.drawImage(cur, 0, 0, CROP.w, CROP.h);
    ctx.globalAlpha = 1;
  }

  // Pause the loop when the hero is off-screen or the tab is hidden.
  function setRunning(on) {
    running = on;
    if (on) wake();
    else if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  }
  new IntersectionObserver(([e]) => setRunning(e.isIntersecting && !document.hidden)).observe(hero);
  document.addEventListener('visibilitychange', () => setRunning(!document.hidden));

  loadAll();
  wake();

  /* ---------- menu ---------- */

  const toggle = document.getElementById('menu-toggle');
  const menu = document.getElementById('menu');
  function setMenu(open) {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu.hidden = !open;
    document.body.classList.toggle('menu-open', open);
    if (open) menu.querySelector('a')?.focus();
  }
  toggle?.addEventListener('click', () => setMenu(menu.hidden));
  menu?.addEventListener('click', (e) => { if (e.target.closest('a') || e.target === menu) setMenu(false); });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { setMenu(false); toggle.focus(); }
  });
})();
