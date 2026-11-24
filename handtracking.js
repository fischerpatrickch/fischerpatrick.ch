// ==================================================
// Handtracking für «The Touch Within Data»
// ==================================================
// Übernommen aus den P5LIVE-Sketches «Mimosa, Venus, Drosera» und «Shapes_…»:
//   Hand vor der Kamera → Video spult mit der Handgrösse (nah = weiter vorne)
//   keine Hand          → Video läuft langsam zurück an den Anfang
//   Handskelett in Grün, Punkte als Form der Pflanze:
//   Mimosa = Blatt, Venus = Stern, Drosera = Kreis (Zuordnung in scripts.js, shapes)
//
// Zwei Orte:
//   Triptychon – «Touch» links über den drei Videos: alle drei reagieren gleichzeitig
//   Lightbox   – Video anklicken, unten «Touch»: nur das grosse Video
// Hand-Erkennung: MediaPipe HandLandmarker (dasselbe Modell wie ml5.handPose).
// Die Kamera braucht https oder localhost (z. B. Live Server in VS Code).

(function () {
  // --------------------------------------------------
  // Einstellungen (wie im Sketch, Grössen bezogen auf 1080 px Videobreite)
  // --------------------------------------------------
  const COLOR = 'rgb(148, 255, 0)';
  const CIRCLE_SIZE = 14;     // Durchmesser der Punkte
  const LINE_WEIGHT = 5;
  const SMOOTHING = 0.92;     // Video-Glättung
  const MAX_TIME_STEP = 0.04; // max. Sprung pro Bild in Sekunden
  const REWIND_SPEED = 1.2;   // Sekunden zurück pro Sekunde
  const HAND_MIN = 40;        // Handgrösse (Handgelenk → Mittelfinger) in px bei 640 px Kamerabreite
  const HAND_MAX = 220;
  const CAM_W = 640;
  const CAM_H = 480;
  const SKETCH_W = 1080;      // Breite der Sketch-Leinwand

  const MP_VERSION = '0.10.14';
  const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
  const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

  const CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20],
  ];

  // --------------------------------------------------
  // Formen (aus dem Shapes-Sketch)
  // --------------------------------------------------
  const LEAF = new Path2D('M0,-24 C10,-14 10,14 0,24 C-10,14 -10,-14 0,-24 Z');
  const STAR = (() => {
    const p = new Path2D();
    const spikes = 7, outer = 20, inner = 5;
    for (let i = 0; i < spikes; i++) {
      const a = (i * 2 * Math.PI) / spikes;
      const b = a + Math.PI / spikes;
      if (i === 0) p.moveTo(outer * Math.cos(a), outer * Math.sin(a));
      else p.lineTo(outer * Math.cos(a), outer * Math.sin(a));
      p.lineTo(inner * Math.cos(b), inner * Math.sin(b));
    }
    p.closePath();
    return p;
  })();

  function drawShape(ctx, shape, x, y, size) {
    ctx.save();
    ctx.translate(x, y);
    if (shape === 'leaf') {          // 🌿 Mimosa
      ctx.scale(size / 17, size / 15);
      ctx.fill(LEAF);
    } else if (shape === 'star') {   // ⭐ Venus
      ctx.scale(size / 15, size / 15);
      ctx.fill(STAR);
    } else {                         // ● Drosera
      ctx.beginPath();
      ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // --------------------------------------------------
  const state = { active: false };   // active = Lightbox-Modus (scripts.js fragt das ab)
  window.touchTracking = state;

  const lightbox = document.querySelector('.lightbox');
  if (!lightbox) return;
  const lbVideo = lightbox.querySelector('.lightbox__video');

  // Knopf und Zeichenfläche in der Lightbox
  const lbButton = document.createElement('button');
  lbButton.type = 'button';
  lbButton.className = 'touch-toggle';
  lbButton.textContent = 'Touch me';
  lightbox.appendChild(lbButton);

  const lbCanvas = document.createElement('canvas');
  lbCanvas.className = 'touch-canvas';
  lightbox.appendChild(lbCanvas);

  const cam = document.createElement('video');
  cam.muted = true;
  cam.playsInline = true;

  let landmarker = null;
  let stream = null;
  let hands = [];
  let lastCamTime = -1;
  let lastFrame = 0;
  let loading = false;
  let running = false;

  let mode = null;   // null | 'lightbox' | 'grid'
  let grid = null;   // { section, button, el, canvas, targets: [{ video, shape, t }] }
  let lbTarget = { video: lbVideo, t: 0 };

  // --------------------------------------------------
  // Knöpfe
  // --------------------------------------------------
  lbButton.addEventListener('click', (e) => {
    e.stopPropagation();                 // Lightbox nicht schliessen
    if (mode === 'lightbox') stopAll();
    else startLightbox();
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.touch-grid-toggle');
    if (!btn) return;
    e.stopPropagation();
    if (mode === 'grid' && grid && grid.button === btn) stopAll();
    else startGrid(btn);
  }, true);

  document.addEventListener('lightbox:close', () => { if (mode === 'lightbox') stopAll(); });

  // neues Video in der Lightbox (z. B. weitergescrollt) → vorne beginnen
  lbVideo.addEventListener('loadedmetadata', () => {
    if (mode !== 'lightbox') return;
    lbTarget.t = 0;
    lbVideo.currentTime = 0;
  });

  // --------------------------------------------------
  // Kamera + Modell
  // --------------------------------------------------
  async function loadLandmarker() {
    if (landmarker) return landmarker;
    const { FilesetResolver, HandLandmarker } = await import(`${MP_URL}/vision_bundle.mjs`);
    const vision = await FilesetResolver.forVisionTasks(`${MP_URL}/wasm`);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
    });
    try {
      landmarker = await HandLandmarker.createFromOptions(vision, options('GPU'));
    } catch (err) {
      landmarker = await HandLandmarker.createFromOptions(vision, options('CPU'));
    }
    return landmarker;
  }

  async function ensureCamera(button) {
    if (stream && landmarker) return true;
    if (loading) return false;
    loading = true;
    button.textContent = 'Loading …';
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: CAM_W, height: CAM_H, facingMode: 'user' },
        audio: false,
      });
      cam.srcObject = stream;
      await cam.play();
      await loadLandmarker();
      loading = false;
      return true;
    } catch (err) {
      console.warn('Handtracking:', err);
      stopCamera();
      loading = false;
      button.textContent = 'No camera';
      setTimeout(() => { if (button.textContent === 'No camera') button.textContent = 'Touch me'; }, 2500);
      return false;
    }
  }

  function stopCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    cam.srcObject = null;
  }

  // kurzer Hinweis in der Mitte: wächst (wie die Titel auf der Startseite), wird wieder
  // klein und verschwindet
  function showHint() {
    const old = document.querySelector('.touch-hint');
    if (old) old.remove();
    const hint = document.createElement('div');
    hint.className = 'touch-hint';
    hint.textContent = 'Show your hands to the camera';
    document.body.appendChild(hint);
    hint.addEventListener('animationend', () => hint.remove());
  }

  function hideHint() {
    const hint = document.querySelector('.touch-hint');
    if (hint) hint.remove();
  }

  function startLoop() {
    if (running) return;
    running = true;
    lastFrame = performance.now();
    requestAnimationFrame(frame);
  }

  // --------------------------------------------------
  // Lightbox-Modus
  // --------------------------------------------------
  async function startLightbox() {
    if (mode === 'grid') stopGrid();
    if (!(await ensureCamera(lbButton))) return;
    if (!lightbox.classList.contains('is-open')) { stopAll(); return; }

    mode = 'lightbox';
    state.active = true;
    lbButton.textContent = 'Stop';
    lbButton.classList.add('is-active');
    lbTarget.t = 0;
    hands = [];
    window.refreshLightbox && window.refreshLightbox();   // auf Spul-Version wechseln
    lbVideo.pause();
    showHint();
    startLoop();
  }

  function stopLightbox() {
    state.active = false;
    lbButton.textContent = 'Touch me';
    lbButton.classList.remove('is-active');
    clear(lbCanvas);
    if (lightbox.classList.contains('is-open')) {
      window.refreshLightbox && window.refreshLightbox();   // zurück zum normal laufenden Video
    }
  }

  // --------------------------------------------------
  // Triptychon-Modus
  // --------------------------------------------------
  async function startGrid(button) {
    if (mode === 'grid') stopGrid();
    if (!(await ensureCamera(button))) return;

    const section = button.closest('.page__videos');
    const el = section && section.querySelector('.grid-3, .grid-1');
    if (!el) { stopAll(); return; }

    const canvas = document.createElement('canvas');
    canvas.className = 'touch-canvas';
    el.classList.add('has-touch');
    el.appendChild(canvas);

    const targets = [...el.querySelectorAll('video')].map((video) => {
      const target = { video, shape: video.dataset.shape || 'circle', reverse: video.dataset.reverse === '1', t: 0, original: video.src };
      if (video.dataset.scrub) {
        video.addEventListener('loadedmetadata', () => { video.currentTime = 0; }, { once: true });
        video.src = video.dataset.scrub;
      }
      target.controls = video.controls;
      video.controls = false;          // Steuerleiste ausblenden, solange die Kamera läuft
      video.loop = false;
      video.pause();
      return target;
    });

    grid = { section, button, el, canvas, targets };
    mode = 'grid';
    button.textContent = 'Stop';
    button.classList.add('is-active');
    hands = [];
    showHint();
    startLoop();
  }

  function stopGrid() {
    if (!grid) return;
    grid.targets.forEach(({ video, original, controls }) => {
      if (video.src !== original) video.src = original;
      video.controls = controls;       // Steuerleiste wieder zeigen
      video.loop = true;
      video.play().catch(() => {});
    });
    grid.canvas.remove();
    grid.el.classList.remove('has-touch');
    grid.button.textContent = 'Touch me';
    grid.button.classList.remove('is-active');
    grid = null;
  }

  function stopAll() {
    if (mode === 'lightbox') stopLightbox();
    if (mode === 'grid') stopGrid();
    mode = null;
    state.active = false;
    hands = [];
    hideHint();
    stopCamera();
  }

  // --------------------------------------------------
  // Hauptschleife
  // --------------------------------------------------
  function frame(now) {
    if (!mode) { running = false; return; }

    // Projektseite zugemacht → Triptychon-Touch beenden
    if (mode === 'grid' && !grid.section.closest('.bar.is-open')) {
      stopAll();
      running = false;
      return;
    }

    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    detect(now);

    if (mode === 'lightbox') {
      lbTarget.shape = lightbox.dataset.shape || 'circle';
      lbTarget.reverse = lightbox.dataset.reverse === '1';
      draw(lbCanvas, lightbox, [lbTarget]);
      scrub(lbTarget, dt);
    } else if (mode === 'grid') {
      draw(grid.canvas, grid.el, grid.targets);
      grid.targets.forEach((t) => scrub(t, dt));
    }

    requestAnimationFrame(frame);
  }

  // Hände erkennen, Koordinaten wie im Sketch: 640×480, gespiegelt
  function detect(now) {
    if (!landmarker || cam.readyState < 2 || cam.currentTime === lastCamTime) return;
    lastCamTime = cam.currentTime;
    const result = landmarker.detectForVideo(cam, now);
    hands = (result.landmarks || []).map((lms) =>
      lms.map((p) => ({ x: (1 - p.x) * CAM_W, y: p.y * CAM_H })));
  }

  function clear(canvas) {
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  }

  // sichtbares Bild eines Videos (object-fit: contain), relativ zum Container
  function videoRect(video, container) {
    const v = video.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    const vw = video.videoWidth || 1080;
    const vh = video.videoHeight || 1920;
    const s = Math.min(v.width / vw, v.height / vh);
    const w = vw * s;
    const h = vh * s;
    return { x: v.left - c.left + (v.width - w) / 2, y: v.top - c.top + (v.height - h) / 2, w, h };
  }

  // Hände vor jedes Video zeichnen – eingepasst wie im Sketch (Kamera in 1080×1920)
  function draw(canvas, container, targets) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(container.clientWidth * dpr);
    const h = Math.round(container.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    if (!hands.length) return;

    ctx.strokeStyle = COLOR;
    ctx.fillStyle = COLOR;
    ctx.lineCap = 'round';

    for (const target of targets) {
      const r = videoRect(target.video, container);
      if (r.w <= 0 || r.h <= 0) continue;
      const k = (r.w / SKETCH_W) * dpr;              // Sketch-Pixel → Bildschirm
      const scale = Math.min(r.w / CAM_W, r.h / CAM_H) * dpr;
      const ox = r.x * dpr + (r.w * dpr - CAM_W * scale) / 2;
      const oy = r.y * dpr + (r.h * dpr - CAM_H * scale) / 2;
      const px = (p) => [p.x * scale + ox, p.y * scale + oy];

      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x * dpr, r.y * dpr, r.w * dpr, r.h * dpr);
      ctx.clip();                                    // Hand bleibt im eigenen Video
      ctx.lineWidth = LINE_WEIGHT * k;

      for (const hand of hands) {
        if (hand.length < 21) continue;
        for (const p of hand) {
          const [x, y] = px(p);
          drawShape(ctx, target.shape, x, y, CIRCLE_SIZE * k);
        }
        ctx.beginPath();
        for (const [a, b] of CONNECTIONS) {
          const [ax, ay] = px(hand[a]);
          const [bx, by] = px(hand[b]);
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Hand vorhanden → spulen, keine Hand → zurück an den Anfang
  function scrub(target, dt) {
    const video = target.video;
    const dur = video.duration;
    if (!isFinite(dur) || dur <= 0) return;

    if (hands.length && hands[0].length >= 13) {
      const wrist = hands[0][0];
      const middleTip = hands[0][12];
      let size = Math.hypot(middleTip.x - wrist.x, middleTip.y - wrist.y);
      size = Math.min(Math.max(size, HAND_MIN), HAND_MAX);

      const goal = ((size - HAND_MIN) / (HAND_MAX - HAND_MIN)) * dur;
      const desired = target.t + (goal - target.t) * (1 - SMOOTHING);
      const delta = Math.min(Math.max(desired - target.t, -MAX_TIME_STEP), MAX_TIME_STEP);
      target.t += delta;
    } else {
      target.t = Math.max(0, target.t - REWIND_SPEED * dt);
    }

    target.t = Math.min(target.t, dur - 0.05);
    // rückwärts gesteuerte Videos (Mimosa): Zeit spiegeln – nur im «Touch me»-Modus
    const shown = target.reverse ? Math.max(0, dur - 0.05 - target.t) : target.t;
    // nur neu setzen, wenn das letzte Springen fertig ist → kein Stau beim Spulen
    if (!video.seeking && Math.abs(video.currentTime - shown) > 0.01) {
      video.currentTime = shown;
    }
  }
})();
