// ---------- Zieharmonika ----------
const accordion = document.querySelector('.accordion');
const allBars = [...document.querySelectorAll('.bar')];             // alle 8 Balken
const projectBars = allBars.filter((b) => b.hasAttribute('data-folder'));

let activeIndex = -1;   // welcher Balken gerade gross ist (-1 = keiner)

// ---------- Aktiver Balken (Hover und Scroll teilen sich diesen Zustand) ----------
function setActive(index) {
  if (accordion.classList.contains('has-open')) return;
  index = Math.max(0, Math.min(allBars.length - 1, index));
  if (index === activeIndex) return;

  activeIndex = index;
  allBars.forEach((bar, i) => {
    const isActive = i === index;
    bar.classList.toggle('is-active', isActive);
    isActive ? playVideo(bar) : pauseVideo(bar);
  });
}

// ---------- Hover ----------
// Nach dem Scrollen zählt Hover erst wieder, wenn die Maus wirklich bewegt wird.
// Sonst würde der Balken, der beim Scrollen unter den Zeiger rutscht
// (z. B. in der unteren Bildschirmhälfte), die Scroll-Auswahl sofort überschreiben.
const HOVER_UNLOCK_DISTANCE = 12;   // px, so weit muss die Maus nach dem Scrollen bewegt werden
let hoverLock = null;               // Mausposition beim letzten Scrollen

// Handy / Tablet (Touch): kein Hover, alles nur per Klick/Tippen.
// (Browser melden beim Tippen sonst eine «Maus»-Bewegung und würden das Kästchen aufziehen)
const IS_TOUCH = window.matchMedia('(hover: none), (pointer: coarse)').matches;
document.documentElement.classList.toggle('is-touch', IS_TOUCH);

// schmales Fenster (Handy-Grösse) verhält sich gleich: keine Hover-Animation
const MOBILE_MAX = 700;   // px
const noHover = () => IS_TOUCH || window.innerWidth <= MOBILE_MAX;

accordion.addEventListener('mousemove', (e) => {
  if (noHover()) {
    if (activeIndex !== -1) { activeIndex = -1; allBars.forEach((b) => b.classList.remove('is-active')); }
    accordion.classList.remove('is-hovering');
    return;
  }
  if (hoverLock) {
    const dist = Math.hypot(e.clientX - hoverLock.x, e.clientY - hoverLock.y);
    if (dist < HOVER_UNLOCK_DISTANCE) return;
    hoverLock = null;
  }

  const bar = e.target.closest('.bar');
  if (bar) {
    setActive(allBars.indexOf(bar));
    // Maus hovert ein Projekt → Thumbnails der anderen Balken weichzeichnen
    accordion.classList.toggle('is-hovering', !accordion.classList.contains('has-open'));
  }
});

// ---------- Scrollen (Mausrad / Trackpad) ----------
// Geschlossen: jeder Scroll-Schritt zieht den nächsten Balken auf.
// Geöffnet: Scrollen lässt eine weisse Seite über das Bild/Video fahren;
// ganz oben wieder nach oben scrollen führt zurück ins Menü.
const SCROLL_THRESHOLD = 50;   // wie viel gescrollt werden muss für einen Schritt
const SCROLL_PAUSE = 250;      // ms Mindestabstand zwischen zwei Schritten
const CLOSE_THRESHOLD = 120;   // wie weit man oben nach oben scrollen muss, um ins Menü zu kommen
let scrollSum = 0;
let lastStepTime = 0;
let resetTimer = null;

// Nach dem Zurückkommen ins Menü kurz nicht weiterscrollen,
// damit der Schwung vom Trackpad nicht gleich durch die Balken rast.
const MENU_LOCK_AFTER_CLOSE = 400;   // ms
let menuLockUntil = 0;
let closeSum = 0;
let closeTimer = null;

window.addEventListener('wheel', (e) => {
  hoverLock = { x: e.clientX, y: e.clientY };
  if (isGridMenu()) return;                // normales Scrollen der Landingpage
  e.preventDefault();

  const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);

  if (lightboxOpen) {
    handleLightboxScroll(horizontal ? e.deltaX : e.deltaY);
    return;
  }

  // Trackpad seitwärts in einer Galerie → aktuelle Bildreihe verschieben
  if (horizontal && accordion.classList.contains('has-open') && nudgeCurrentRow(-e.deltaX)) {
    return;
  }

  if (accordion.classList.contains('has-open')) {
    handleOpenScroll(e.deltaY);
    return;
  }

  if (Date.now() < menuLockUntil) return;   // Schwung vom Schliessen ignorieren

  handleMenuScroll(e.deltaY);
}, { passive: false });

// Raster-Landingpage: Mausrad/Trackpad scrollt die Seite ganz normal nach unten
// (sobald es mehr Projekte gibt, als auf einen Bildschirm passen)
function isGridMenu() {
  return accordion.classList.contains('accordion--grid') &&
         !accordion.classList.contains('has-open') && !lightboxOpen;
}

// Menü: ein Mal scrollen = genau ein Projekt weiter. Nach einem Schritt wird
// gesperrt, bis die Scroll-Bewegung (inkl. Nachrollen vom Trackpad) vorbei ist –
// also wenn kurz nichts mehr kommt oder klar neu angesetzt wird.
let menuLocked = false;
let menuLastDelta = 0;
let menuIdleTimer = null;

function handleMenuScroll(delta) {
  const size = Math.abs(delta);

  clearTimeout(menuIdleTimer);
  menuIdleTimer = setTimeout(() => {
    menuLocked = false;
    scrollSum = 0;
  }, 180);

  if (menuLocked) {
    const newSwipe = size > menuLastDelta * 1.6 && size > 15 &&
                     Date.now() - lastStepTime > 250;
    menuLastDelta = size;
    if (!newSwipe) return;
    menuLocked = false;
    scrollSum = 0;
  }
  menuLastDelta = size;

  scrollSum += delta;
  if (Math.abs(scrollSum) < SCROLL_THRESHOLD) return;

  step(scrollSum > 0 ? 1 : -1);
  scrollSum = 0;
  lastStepTime = Date.now();
  menuLocked = true;
}

// ---------- Geöffnetes Projekt: weisse Seite reinscrollen ----------
// Erst wenn der Titel klein oben angekommen ist, kann gescrollt werden.
// Weisse Seite + Titel bewegen sich 1:1 mit dem Scrollen,
// das Bild/Video dahinter langsamer (Parallax-Versatz).
const PARALLAX = 0.4;   // 0 = Bild bleibt stehen, 1 = Bild bewegt sich gleich schnell
let pageOffset = 0;
let titleReady = false;

function scrollOpenPage(delta) {
  const bar = document.querySelector('.bar.is-open');
  if (!bar || !titleReady) return;

  // bis die weisse Seite ganz drin ist – bei längeren Seiten (Galerie) bis zu ihrem Ende
  const page = bar.querySelector('.bar__page');
  const max = Math.max(bar.offsetHeight, page ? page.offsetHeight : 0);
  delta = consumeFold(bar, delta);         // Faltplakat: Seite steht, Scrollen faltet
  pageOffset = Math.max(0, Math.min(max, pageOffset + delta));

  galleryBoost += delta;                   // Scrollen schiebt die Bildreihen mit

  setY(bar.querySelector('.bar__page'), -pageOffset);
  // Der Titel bleibt unten stehen (sticky) – die Seite fährt unter ihm hoch
  setY(bar.querySelector('.bar__media'), -pageOffset * PARALLAX);
}

// Ganz oben (Bild sichtbar) nach oben scrollen → zurück ins Menü
function handleOpenScroll(delta) {
  if (document.querySelector('.bar.is-closing')) return;
  if (pageOffset === 0 && delta < 0) {
    // ganz oben weiter nach oben scrollen → sammeln, ab CLOSE_THRESHOLD schliessen
    closeSum += -delta;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { closeSum = 0; }, 300);
    if (closeSum > CLOSE_THRESHOLD) {
      closeSum = 0;
      closeAll();
    }
    return;
  }

  closeSum = 0;
  scrollOpenPage(delta);
}

function setY(el, y) {
  if (el) el.style.transform = `translateY(${y}px)`;
}

function resetOpenPage() {
  pageOffset = 0;
  // Faltplakate wieder aufgefaltet
  document.querySelectorAll('.page__poster3d, .page__model3d').forEach((sec) => {
    const f = sec.fold || sec.zoom;   // 3D-Modell: Zoom wieder zurück
    if (f) { f.p = 0; f.shown = 0; f.start(); }
  });
  titleReady = false;
  document.querySelectorAll('.bar__label, .bar__page, .bar__media')
    .forEach((el) => { el.style.transform = ''; });
}

// Titel-Animation fertig → Scrollen freigeben
document.addEventListener('animationend', (e) => {
  if (e.animationName === 'title-to-top') titleReady = true;
  // Titel ist beim Schliessen wieder gross in der Mitte → Zieharmonika zurück
  if (e.animationName === 'title-to-center') finishClose(e.target.closest('.bar'));
});

// ---------- Wischen auf Touch-Geräten ----------
// Die Seite folgt dem Finger etwas schneller (TOUCH_FACTOR) und rollt nach dem
// Loslassen mit Schwung weiter, wie man es vom Handy gewohnt ist.
const TOUCH_FACTOR = 1.6;       // 1 = genau mit dem Finger, grösser = empfindlicher
let touchStartY = null;
let touchVel = 0;               // px pro Frame (für den Schwung)
let touchLastT = 0;
let momentumRaf = 0;

let touchOnModel = false;        // Finger bedient ein 3D-Modell → Seite scrollt nicht mit
let touchOnGallery = false;      // Finger startet auf einer Galerie
let touchDir = null;             // null | 'x' (Galerie wischen) | 'y' (Seite scrollen)
let touchX0 = 0;
let touchY0 = 0;

window.addEventListener('touchstart', (e) => {
  touchOnModel = !!(e.target.closest && e.target.closest('.model3d'));
  // Galerie: erst entscheiden, ob seitwärts (Galerie) oder hoch/runter (Seite) gewischt wird
  touchOnGallery = !!(e.target.closest && e.target.closest('.gallery__track'));
  touchDir = null;
  touchX0 = e.touches[0].clientX;
  touchY0 = e.touches[0].clientY;
  touchStartY = e.touches[0].clientY;
  touchVel = 0;
  touchLastT = performance.now();
  cancelAnimationFrame(momentumRaf);      // neuer Finger stoppt den Schwung
  // neuer Wisch: Faltplakat / 3D-Modell dürfen sofort weiterfalten bzw. zoomen
  document.querySelectorAll('.page__poster3d, .page__model3d').forEach((sec) => {
    if (sec.fold) { sec.fold.locked = false; clearTimeout(sec.fold.lockTimer); }
  });
}, { passive: true });

let touchCloseSum = 0;

window.addEventListener('touchmove', (e) => {
  if (lightboxOpen) return;
  if (touchStartY === null || !accordion.classList.contains('has-open')) return;
  const y = e.touches[0].clientY;
  const delta = touchStartY - y;
  touchStartY = y;
  if (touchOnModel) { touchVel = 0; return; }   // Drehen/Zoomen am 3D-Modell: Seite bleibt stehen
  // Galerie seitwärts gewischt → Seite bleibt stehen (bis der Finger losgelassen wird)
  if (touchOnGallery) {
    if (!touchDir) {
      const ax = Math.abs(e.touches[0].clientX - touchX0);
      const ay = Math.abs(y - touchY0);
      if (ax < 6 && ay < 6) return;               // noch unklar: nichts bewegen
      touchDir = ax > ay ? 'x' : 'y';
    }
    if (touchDir === 'x') { touchVel = 0; return; }
  }

  // Handy: langer CV scrollt in sich selbst (normales Scrollen), erst ganz oben schliesst ein
  // Wisch nach unten die Seite
  const ownScroll = e.target.closest && e.target.closest('.tab-panel');
  if (ownScroll && ownScroll.scrollHeight > ownScroll.clientHeight + 1 &&
      !(ownScroll.scrollTop <= 0 && delta < 0)) {
    touchCloseSum = 0;
    return;
  }

  // Ganz oben nach unten wischen → zurück ins Menü
  if (pageOffset === 0 && delta < 0) {
    touchCloseSum += -delta;
    if (touchCloseSum > CLOSE_THRESHOLD) {
      closeAll();
      touchCloseSum = 0;
      touchStartY = null;
    }
    return;
  }
  touchCloseSum = 0;
  const now = performance.now();
  const d = delta * TOUCH_FACTOR;
  const frames = Math.max(1, (now - touchLastT) / 16.7);
  touchVel = touchVel * 0.4 + (d / frames) * 0.6;
  touchLastT = now;
  scrollOpenPage(d);
}, { passive: true });

function touchMomentum() {
  if (Math.abs(touchVel) < 0.5 || !accordion.classList.contains('has-open') || lightboxOpen) return;
  const before = pageOffset;
  scrollOpenPage(touchVel);
  if (Math.abs(pageOffset - before) < 0.1) return;   // angehalten (z. B. beim Plakat) → Schwung aus
  touchVel *= 0.95;
  momentumRaf = requestAnimationFrame(touchMomentum);
}

window.addEventListener('touchend', (e) => {
  touchCloseSum = 0;
  if (touchStartY === null) return;
  if (lightboxOpen) {
    const delta = touchStartY - e.changedTouches[0].clientY;
    if (Math.abs(delta) > 30) showLightbox(lightboxIndex + (delta > 0 ? 1 : -1));
    touchStartY = null;
    return;
  }
  if (!accordion.classList.contains('has-open') && !isGridMenu()) {
    const delta = touchStartY - e.changedTouches[0].clientY;
    if (Math.abs(delta) > 30) step(delta > 0 ? 1 : -1);
  }
  touchStartY = null;
  // offenes Projekt: mit Schwung weiterrollen (nur wenn der Finger zuletzt noch bewegt wurde)
  if (accordion.classList.contains('has-open') && performance.now() - touchLastT < 80) {
    cancelAnimationFrame(momentumRaf);
    momentumRaf = requestAnimationFrame(touchMomentum);
  }
});

// ---------- Pfeiltasten ----------
document.addEventListener('keydown', (e) => {
  if (lightboxOpen) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') showLightbox(lightboxIndex + 1);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') showLightbox(lightboxIndex - 1);
    if (e.key === 'Escape') closeLightbox();
    return;
  }
  if (e.key === 'ArrowDown') step(1);
  if (e.key === 'ArrowUp') step(-1);
  if (e.key === 'Escape') closeAll();
});

function step(direction) {
  accordion.classList.remove('is-hovering');   // Scrollen/Tasten: kein Blur
  // Beim ersten Scrollen nach unten starten wir beim obersten Balken
  if (activeIndex === -1) setActive(direction > 0 ? 0 : allBars.length - 1);
  else setActive(activeIndex + direction);
}

// ---------- Klick: Projekt komplett öffnen bzw. schliessen ----------
// fischerpatrick.ch bleibt beim Öffnen eines Projekts genau dort stehen, wo es ist
// (sticky): der Balken wird auf seiner aktuellen Höhe eingefroren, das Projekt
// füllt den Rest des Bildschirms.
const titleBar = document.querySelector('.bar--title');
let titleUnfreezeTimer = null;

function freezeTitleBar() {
  clearTimeout(titleUnfreezeTimer);
  // im Raster-Modus regelt das CSS die Höhe (ein Achtel), hier nichts einfrieren
  if (accordion.classList.contains('accordion--grid')) return;
  const h = titleBar.getBoundingClientRect().height;
  titleBar.style.transition = 'none';
  titleBar.style.flex = `0 0 ${h}px`;
  titleBar.style.height = `${h}px`;
  titleBar.offsetHeight;                 // sofort übernehmen, ohne Animation
  titleBar.style.transition = '';
}

function unfreezeTitleBar(animated) {
  if (!titleBar.style.flex) return;
  if (animated) {
    titleBar.style.flex = '';
    titleBar.style.height = '';
    return;
  }
  // erst lösen, wenn die anderen Balken fertig zurückgefahren sind → kein Sprung
  titleUnfreezeTimer = setTimeout(() => {
    titleBar.style.transition = 'none';
    titleBar.style.flex = '';
    titleBar.style.height = '';
    titleBar.offsetHeight;
    titleBar.style.transition = '';
  }, 700);
}

// Name gleitet von seiner bisherigen Position an die neue (statt zu springen):
// vorher/nachher messen, Unterschied als Versatz setzen, dann weich auf 0 animieren
const titleLabel = titleBar.querySelector('.bar__label');

function glideTitleLabel(before) {
  const after = titleLabel.getBoundingClientRect();
  const dx = (before.left + before.width / 2) - (after.left + after.width / 2);
  const dy = (before.top + before.height / 2) - (after.top + after.height / 2);
  if (!dx && !dy) return;
  // Web-Animation: läuft auf der Grafikkarte weiter, auch wenn der Browser
  // gerade mit anderem beschäftigt ist → bleibt nicht mehr hängen
  titleLabel.getAnimations().forEach((a) => { if (a.id === 'glide') a.cancel(); });
  const anim = titleLabel.animate(
    [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
    { duration: 600, easing: 'cubic-bezier(0.83, 0, 0.17, 1)' },
  );
  anim.id = 'glide';
}

function textRect() {
  // Position des Textes selbst (nicht des ganzen Balkens)
  const range = document.createRange();
  range.selectNodeContents(titleLabel);
  return range.getBoundingClientRect();
}

function openBar(bar) {
  accordion.classList.remove('is-hovering');
  if (accordion.classList.contains('accordion--grid')) window.scrollTo(0, 0);
  const nameBefore = textRect();
  if (bar !== titleBar) freezeTitleBar();
  resetOpenPage();
  projectBars.forEach((b) => b.classList.remove('is-open'));
  bar.classList.add('is-open');
  accordion.classList.add('has-open');
  if (bar !== titleBar) glideTitleLabel(nameBefore);
  playVideo(bar);
}

// Schliessen = Öffnen rückwärts:
// 1. Titel wird wieder gross und wandert in die Mitte
// 2. danach schrumpft das Bild zurück und die Zieharmonika erscheint wieder
function closeAll() {
  const bar = document.querySelector('.bar.is-open');
  if (!bar || bar.classList.contains('is-closing')) return;

  // Titel ist noch gross (Animation nach oben noch nicht fertig) → direkt zurück
  if (!titleReady) {
    finishClose(bar);
    return;
  }

  // weisse Seite / Bild / Titel zurück an den Start, dann Titel-Animation rückwärts
  document.querySelectorAll('.bar__label, .bar__page, .bar__media')
    .forEach((el) => { el.style.transform = ''; });
  pageOffset = 0;
  bar.classList.add('is-closing');
}

function finishClose(bar) {
  const nameBefore = textRect();
  const label = bar.querySelector('.bar__label');
  const sizeBefore = getComputedStyle(label).fontSize;   // grosser Titel in der Mitte
  const scaleBefore = getComputedStyle(label).scale;      // Handy: Titel wird per «scale» klein
  resetOpenPage();
  bar.classList.remove('is-open', 'is-closing');
  accordion.classList.remove('has-open');
  // Handy: Titel schrumpft weich zurück auf die Grösse im Kästchen (statt zu springen)
  if (noHover()) {
    const sizeAfter = getComputedStyle(label).fontSize;
    if (sizeAfter !== sizeBefore) {
      label.animate([{ fontSize: sizeBefore }, { fontSize: sizeAfter }],
        { duration: 800, easing: 'cubic-bezier(0.83, 0, 0.17, 1)' });
    }
    const scaleAfter = getComputedStyle(label).scale;
    if (scaleAfter !== scaleBefore) {
      label.animate([{ scale: scaleBefore }, { scale: scaleAfter }],
        { duration: 800, easing: 'cubic-bezier(0.83, 0, 0.17, 1)' });
    }
  }
  if (bar !== titleBar) glideTitleLabel(nameBefore);
  menuLockUntil = Date.now() + MENU_LOCK_AFTER_CLOSE;

  // Schliessen wegen Inaktivität → danach Reset-Welle
  if (waveAfterClose) {
    waveAfterClose = false;
    unfreezeTitleBar(true);
    allBars.forEach((b) => { b.classList.remove('is-active'); pauseVideo(b); });
    activeIndex = -1;
    setTimeout(playWave, 500);
    return;
  }

  unfreezeTitleBar(false);

  // der geschlossene Balken bleibt aufgezogen (wie beim Hover) und schrumpft dorthin
  // (auf dem Handy nicht: dort gibt es kein Aufziehen, alle Kästchen bleiben gleich gross)
  activeIndex = noHover() ? -1 : allBars.indexOf(bar);
  allBars.forEach((b) => {
    b.classList.toggle('is-active', !noHover() && b === bar);
    b === bar && !noHover() ? playVideo(b) : pauseVideo(b);   // Handy: Startseite steht still
  });
}

projectBars.forEach((bar) => {
  const label = bar.querySelector('.bar__label');
  label.addEventListener('click', (e) => {
    // nochmals klicken = zurück; fischerpatrick.ch oben führt aus jedem Projekt ins Menü
    if (bar.classList.contains('is-open') || accordion.classList.contains('has-open')) {
      // nur ein Klick auf den Text selbst führt zurück, nicht ein Klick ins Leere daneben
      // (z. B. auf der CV-Seite knapp neben einen Reiter)
      if (e.detail > 0) {
        const range = document.createRange();
        range.selectNodeContents(label);
        const r = range.getBoundingClientRect();
        const pad = 10;
        if (e.clientX < r.left - pad || e.clientX > r.right + pad ||
            e.clientY < r.top - pad || e.clientY > r.bottom + pad) return;
      }
      closeLightbox();
      closeAll();
    } else {
      openBar(bar);
    }
  });
});

// ---------- Videos: laufen nur im aktiven oder geöffneten Balken ----------
function playVideo(bar) {
  const video = bar.querySelector('.bar__media video');
  if (video) video.play().catch(() => {});
  if (bar.classList.contains('is-open')) {
    bar.querySelectorAll('.bar__page video').forEach((v) => v.play().catch(() => {}));
  }
}

function pauseVideo(bar) {
  if (bar.classList.contains('is-open')) return;
  const video = bar.querySelector('.bar__media video');
  if (video) video.pause();
  bar.querySelectorAll('.bar__page video').forEach((v) => v.pause());
}

// Handy: auf der Startseite stehen die Thumbnails still (Standbild), das Video läuft erst
// im geöffneten Projekt

// ---------- Thin Hair Setter: Satzzeichen-Feld mit Maus-«Loch» ----------
// Zufällige Zeichen in einem Raster auf Schwarz. Wo die Maus ist, werden sie
// geometrisch (quadratisch) und graduell weggeschoben und federn danach zurück.
// Gilt für jede Zeichenfläche mit der Klasse .symbol-field (Startseite und Leiste unten).
function initSymbolField(canvas) {
  const ctx = canvas.getContext('2d');
  let wasConnected = false;  // Zeichenfläche wieder entfernt → Animation stoppen

  const SYMBOLS = '.:,;–!?/(){}[]+…1234567890«»'.split('');
  const SPACING = 26;        // Abstand zwischen den Zeichen (px) – kleiner = dichter
  const FONT_SIZE = 16;      // Schriftgrösse der Zeichen (px)
  const HOLE_SIZE = 90;      // halbe Breite des quadratischen «Lochs» (px)
  const INFLUENCE = 240;     // bis wie weit das Raster mitverschoben wird (px, mind. 2 × HOLE_SIZE)
  const STIFFNESS = 0.08;    // wie stark die Zeichen zurückfedern
  const DAMPING = 0.78;      // Abbremsen (kleiner = weniger Nachschwingen)

  let particles = [];
  let fieldW = 0;
  let fieldH = 0;
  let mouse = null;          // Mausposition im Canvas oder null

  // Zeichen über die ganze Bildschirmfläche verteilen (unabhängig von der
  // Balkenhöhe). Gezeigt wird – wie bei den Bildern – der Ausschnitt aus der Mitte.
  function build() {
    fieldW = window.innerWidth;
    fieldH = window.innerHeight;
    particles = [];
    // Exaktes Raster, mittig ausgerichtet; nur die Zeichen selbst sind zufällig
    const startX = (fieldW % SPACING) / 2 + SPACING / 2;
    const startY = (fieldH % SPACING) / 2 + SPACING / 2;
    for (let y = startY; y < fieldH; y += SPACING) {
      for (let x = startX; x < fieldW; x += SPACING) {
        const hx = x;
        const hy = y;
        particles.push({
          hx, hy,            // Ruheposition
          x: hx, y: hy,      // aktuelle Position
          vx: 0, vy: 0,
          char: SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        });
      }
    }
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Handy/Tablet (kein Hovern): eine unsichtbare «Maus» wandert zufällig und weich über das Feld
  const wander = { x: 0, y: 0, tx: 0, ty: 0, started: false, nextAt: 0 };
  function updateWander(rect, now) {
    if (!wander.started) {
      wander.x = wander.tx = rect.width / 2;
      wander.y = wander.ty = rect.height / 2;
      wander.started = true;
    }
    // neues zufälliges Ziel, sobald das alte (fast) erreicht ist oder nach einer Weile
    if (now > wander.nextAt || Math.hypot(wander.tx - wander.x, wander.ty - wander.y) < 8) {
      wander.tx = rect.width * (0.1 + Math.random() * 0.8);
      wander.ty = rect.height * (0.1 + Math.random() * 0.8);
      wander.nextAt = now + 2500 + Math.random() * 2500;
    }
    wander.x += (wander.tx - wander.x) * 0.02;
    wander.y += (wander.ty - wander.y) * 0.02;
    mouse = { x: wander.x, y: wander.y };
  }

  window.addEventListener('mousemove', (e) => {
    if (noHover()) return;
    const rect = canvas.getBoundingClientRect();
    const inside = e.clientX >= rect.left && e.clientX <= rect.right &&
                   e.clientY >= rect.top && e.clientY <= rect.bottom;
    mouse = inside ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : null;
  });
  document.addEventListener('mouseleave', () => { mouse = null; });

  function frame() {
    if (canvas.isConnected) wasConnected = true;
    else if (wasConnected) return;
    const rect = canvas.getBoundingClientRect();
    // Handy: auf der Startseite stehen die Zeichen still; im geöffneten Projekt wandert
    // eine unsichtbare «Maus» zufällig über das Feld
    if (noHover()) {
      if (canvas.closest('.bar.is-open') && canvas.closest('.bar__media') && rect.height > 1) {
        updateWander(rect, performance.now());
      }
      else { mouse = null; wander.started = false; }
    }
    if (rect.height > 1) {
      // Feld vertikal zentrieren → Ausschnitt aus der Mitte
      const offsetY = (rect.height - fieldH) / 2;
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.fillStyle = '#fff';
      ctx.font = FONT_SIZE + 'px "Helvetica Neue", Helvetica, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (const p of particles) {
        let tx = p.hx;
        let ty = p.hy;

        // Geometrisches, quadratisches Loch mit gradueller Verschiebung:
        // Abstand wird «eckig» gemessen (grösserer von x/y-Abstand), dadurch
        // entsteht ein Quadrat. Zeichen nahe der Maus werden stark, weiter
        // entfernte immer weniger verschoben – das Raster staucht sich weich.
        if (mouse) {
          const dx = p.hx - mouse.x;
          const dy = p.hy + offsetY - mouse.y;
          const dist = Math.max(Math.abs(dx), Math.abs(dy)) || 0.001;
          if (dist < INFLUENCE) {
            const t = 1 - dist / INFLUENCE;              // 1 = bei der Maus, 0 = Rand
            const push = HOLE_SIZE * t * t;              // graduell abnehmend
            tx += (dx / dist) * push;
            ty += (dy / dist) * push;
          }
        }

        // Feder-Physik: beschleunigt, schwingt leicht nach, kommt zur Ruhe
        p.vx = (p.vx + (tx - p.x) * STIFFNESS) * DAMPING;
        p.vy = (p.vy + (ty - p.y) * STIFFNESS) * DAMPING;
        p.x += p.vx;
        p.y += p.vy;

        const drawY = p.y + offsetY;
        if (drawY > -FONT_SIZE && drawY < rect.height + FONT_SIZE) {
          ctx.fillText(p.char, p.x, drawY);
        }
      }
    }
    requestAnimationFrame(frame);
  }

  // Canvas mitwachsen lassen, wenn der Balken grösser/kleiner wird
  new ResizeObserver(resize).observe(canvas);
  // nur neu aufbauen, wenn sich die Breite ändert: auf dem Handy ändert sich beim Scrollen
  // die Höhe (Adressleiste ein/aus) – sonst würden die Zeichen jedes Mal neu gemischt
  let builtWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth !== builtWidth) { builtWidth = window.innerWidth; build(); }
    resize();
  });

  build();
  resize();
  requestAnimationFrame(frame);
}
document.querySelectorAll('.symbol-field').forEach(initSymbolField);

// ---------- Reset-Welle ----------
// Beim Laden der Seite und nach 5 Minuten ohne Interaktion läuft eine Welle
// von oben nach unten durch die Balken; danach sind alle wieder gleich gross.
const IDLE_RESET = 5 * 60 * 1000;   // ms ohne Interaktion bis zum Reset (5 Minuten)
const WAVE_STEP = 140;              // ms Versatz von Balken zu Balken
const WAVE_HOLD = 450;              // ms, wie lange jeder Balken aufgezogen bleibt
const WAVE_STEP_GRID = 600;         // Raster: Versatz von Kästchen zu Kästchen
const WAVE_HOLD_GRID = 700;         // Raster: wie lange jedes Kästchen gross bleibt
let waveTimers = [];
let idleTimer = null;
let waveAfterClose = false;

function playWave() {
  stopWave();
  accordion.classList.remove('is-hovering');
  // vorher: alles auf gleichmässig
  activeIndex = -1;
  allBars.forEach((b) => { b.classList.remove('is-active'); pauseVideo(b); });

  // im Raster läuft die Welle Kästchen für Kästchen (wie Hovern), etwas ruhiger
  const grid = accordion.classList.contains('accordion--grid');
  const stepMs = grid ? WAVE_STEP_GRID : WAVE_STEP;
  const holdMs = grid ? WAVE_HOLD_GRID : WAVE_HOLD;

  accordion.classList.add('is-waving');          // kleine Kästchen weichzeichnen
  allBars.forEach((bar, i) => {
    waveTimers.push(setTimeout(() => bar.classList.add('is-wave'), i * stepMs));
    waveTimers.push(setTimeout(() => bar.classList.remove('is-wave'), i * stepMs + holdMs));
  });
  waveTimers.push(setTimeout(() => accordion.classList.remove('is-waving'),
    (allBars.length - 1) * stepMs + holdMs));
}

function stopWave() {
  waveTimers.forEach(clearTimeout);
  waveTimers = [];
  accordion.classList.remove('is-waving');
  allBars.forEach((b) => b.classList.remove('is-wave'));
}

function resetToIdle() {
  closeLightbox();
  if (accordion.classList.contains('has-open')) {
    waveAfterClose = true;   // erst Projekt schliessen, dann Welle (siehe finishClose)
    closeAll();
  } else {
    playWave();
  }
}

// Welle bei Inaktivität ist ausgeschaltet (kein automatischer Reset mehr).
// Wieder einschalten: die auskommentierte Zeile unten wieder aktivieren.
function restartIdleTimer() {
  clearTimeout(idleTimer);
  // idleTimer = setTimeout(resetToIdle, IDLE_RESET);
}

// Jede echte Interaktion: Welle abbrechen und 5-Minuten-Timer neu starten
function onActivity(e) {
  if (e.type === 'mousemove' && e.movementX === 0 && e.movementY === 0) return;
  if (waveTimers.length && !waveAfterClose) stopWave();
  restartIdleTimer();
}

['mousemove', 'wheel', 'touchstart', 'keydown', 'mousedown'].forEach((type) => {
  window.addEventListener(type, onActivity, { capture: true, passive: true });
});

// Maus verlässt das Fenster → ohne Welle zurück zur gleichmässigen Aufteilung
// (nur im Menü; ein offenes Projekt bleibt offen)
document.documentElement.addEventListener('mouseleave', () => {
  accordion.classList.remove('is-hovering');
  if (accordion.classList.contains('has-open')) return;
  stopWave();
  activeIndex = -1;
  allBars.forEach((b) => { b.classList.remove('is-active'); pauseVideo(b); });
});

// Beim Öffnen / Neuladen der Seite (ohne Anfangs-Welle)
window.addEventListener('load', () => {
  restartIdleTimer();
});

// ---------- Zufälliges Thumbnail aus Unterordnern ----------
// Bei jedem Laden wird ein zufälliger Unterordner und daraus ein zufälliges Bild gewählt.
// Neue Bilder/Ordner: einfach hier in der Liste ergänzen (der Browser kann
// Ordner nicht selbst auslesen).
const RANDOM_IMAGES = {
  'Analogue Archive': {
    '01': [
      '011220221-07.jpg',
      '011220221-12.jpg',
      '011220222-01.jpg',
      'fotogramm_Puppe6 2-14.jpg',
      'Unbenannt-9.jpg',
      'Unbenannt-92.jpg',
      'Unbenannt-99.jpg'
    ],
    '02': [
      '011220221-04-2.jpg',
      '011220221-09-3.jpg',
      '011220222-28-2.jpg',
      '081220222-4.jpg',
      '081220222-5-2.jpg',
      'Fotogramm_Puppe2-11.jpg',
      'Fotogramm_Puppe2-2.jpg',
      'Fotogramm_Puppe2-5-2.jpg',
      'fotogramm_Puppe3 2-2-2.jpg',
      'fotogramm_Puppe3 2-3.jpg',
      'fotogramm_Puppe3 2-4.jpg',
      'fotogramm_Puppe6 2-11.jpg',
      'fotogramm_Puppe6 2-9.jpg'
    ],
    '03': [
      '06.03.2025-10.jpg',
      '06.03.2025-13.jpg',
      '06.03.2025-18.jpg',
      '06.03.2025-20.jpg',
      '06.03.2025-3.jpg',
      '06.03.2025-4.jpg',
      '06.03.2025-6.jpg',
      '2026-02-24-0003.jpg'
    ],
    '04': [
      '2026-08-17-0005.jpg',
      '2026-08-17-0006.jpg',
      '2026-08-17-0008-3.jpg',
      '2026-08-17-0013-2.jpg',
      '2026-08-17-0015.jpg',
      '2026-08-17-0016.jpg',
      '2026-08-17-0017.jpg',
      '2026-08-17-0022.jpg'
    ],
  },
};

document.querySelectorAll('img[data-random]').forEach((img) => {
  const folder = img.dataset.random;
  const subfolders = Object.entries(RANDOM_IMAGES[folder] || {})
    .filter(([, list]) => list.length > 0)           // leere Ordner überspringen
    // optional nur bestimmte Unterordner, z. B. data-random-sub="04" oder "03,04"
    .filter(([sub]) => !img.dataset.randomSub || img.dataset.randomSub.split(',').includes(sub));
  if (!subfolders.length) return;

  const [sub, list] = subfolders[Math.floor(Math.random() * subfolders.length)];
  const file = list[Math.floor(Math.random() * list.length)];
  // verkleinerte Web-Version aus dem Unterordner _web (schneller, ruckelt nicht)
  img.src = ['Media', mediaDir(folder), sub, '_web', file].map(encodeURIComponent).join('/');
});

// ---------- Lange Titel passen in die Breite ----------
// Gross (Hover/geöffnet) dürfen Titel nicht breiter als der Bildschirm werden.
// Für zu lange Titel wird ein Faktor --fit < 1 berechnet, der nur sie verkleinert.
function fitTitles() {
  const ctx = document.createElement('canvas').getContext('2d');
  const grow = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--text-grow')) || 1;
  let maxWidth = window.innerWidth * 0.92;
  if (accordion.classList.contains('accordion--grid') && window.innerWidth > 700) {   // Handy: ganze Breite
    // im Raster ist das aktive Projekt nur so breit wie seine Spalte
    const colGrow = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--grid-col-grow')) || 1;
    maxWidth *= colGrow / (colGrow + 1);
  }

  document.querySelectorAll('.bar__label').forEach((label) => {
    const style = getComputedStyle(label);
    const baseSize = parseFloat(getComputedStyle(document.documentElement).fontSize) *
                     parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-size'));
    ctx.font = `${style.fontWeight} ${baseSize}px ${style.fontFamily}`;
    // Handy: Titel mit Umbruch (z. B. «Neue Scheune / Merian Gärten») – die längere Zeile zählt
    const mLine = label.querySelector('.m-line');
    const lines = (mLine && window.innerWidth <= MOBILE_MAX)
      ? [label.textContent.replace(mLine.textContent, ''), mLine.textContent]
      : [label.textContent];
    const smallWidth = Math.max(...lines.map((t) => ctx.measureText(t.trim()).width));
    const bigWidth = smallWidth * grow;
    label.style.setProperty('--fit', Math.min(1, maxWidth / bigWidth));
    // Handy: Titel landet links am Rand (16px) – Verschiebung von der Mitte aus
    label.style.setProperty('--end-shift', `calc(16px + ${(smallWidth / 2).toFixed(1)}px - 50vw)`);
    // Handy-Startseite: Titel passt ohne Umbruch in sein halbes Kästchen (sonst etwas kleiner)
    const cell = window.innerWidth / 2 - 24;
    const fitCell = Math.min(1, cell / smallWidth);
    label.style.setProperty('--fit-cell', fitCell.toFixed(3));
    // Handy: Verkleinerung des (immer gross gesetzten) Titels auf die kleine Grösse
    label.style.setProperty('--bigw', `${Math.ceil(bigWidth * Math.min(1, maxWidth / bigWidth)) + 4}px`);
    label.style.setProperty('--s-small', (fitCell / (grow * Math.min(1, maxWidth / bigWidth))).toFixed(4));
  });
}

fitTitles();
window.addEventListener('resize', fitTitles);
document.fonts && document.fonts.ready.then(fitTitles);

// ---------- Galerie: Bildreihen pro Unterordner ----------
// Jede Reihe läuft über den Bildschirmrand hinaus und bewegt sich von rechts
// nach links – von alleine und zusätzlich mit dem Scrollen. Bilder werden
// erst beim ersten Öffnen geladen.
const GALLERY_SPEED = 40;        // px pro Sekunde, wenn nicht gescrollt wird
const GALLERY_SCROLL_FACTOR = 1; // wie stark Scrollen die Reihen seitlich schiebt
const GALLERY_COPIES = 3;        // Reihe wird wiederholt → endloses Band
let galleryBoost = 0;
let galleryRows = [];

// Inhalt der Projektseiten. Reihenfolge = Reihenfolge beim Scrollen.
//   pair:    Bilder nebeneinander, so gross wie möglich (Klick → gross)
//   video:   Video in maximaler Grösse
//   gallery: Bildreihen wie bei Analogue Archive (eine Reihe pro Eintrag)
// Analogue Archive: Text und Angaben pro Reihe (Unterordner), erscheinen beim «+»
const ANALOGUE_INFO = {
  '04': {
    text: 'This series explores black-and-white photography through inversion. Negative space becomes the ' +
      'main design element, so that light turns into shadow and shadow into form. The photographs were ' +
      'taken in summer 2026 in Sweden and the Swiss Alps.',
    credits: 'Analogue Archive 04\n(2026), 35mm HP5 Film,\nOlympus AF-1\n\nPrivate Project',
  },
  '03': {
    text: 'Taken in November 2024, this series uses the camera flash as its main tool. The flash lights only ' +
      'what is directly in front of the lens while everything else falls into darkness, transforming the ' +
      'surroundings into an inner world.',
    credits: 'Analogue Archive 03\n(2024), 35mm HP5 Film,\nOlympus AF-1\n\nPrivate Project',
  },
  '02': {
    text: 'This series was created in 2022 to capture the liminal moments of everyday life in Basel. Image by ' +
      'image, ordinary routes and places add up to an everyday odyssey.',
    credits: 'Analogue Archive 02\n(2022), 35mm HP5 Film,\nNikon F-501\n\nPrivate Project',
  },
  '01': {
    text: 'Also taken in Basel in 2022, this series captures the liminal moments of everyday life and follows ' +
      'them as an everyday odyssey. In addition, it explores perspective by placing vertical lines and ' +
      'structures in a new context.',
    credits: 'Analogue Archive 01\n(2022), 35mm HP5 Film,\nNikon F-501\n\nPrivate Project',
  },
};

const LSD = 'LSD – Trip : Therapie';
const PAGE_CONTENT = {
  'Analogue Archive': [
    {
      type: 'gallery',
      rows: Object.entries(RANDOM_IMAGES['Analogue Archive'])
        .filter(([, list]) => list.length > 0)
        .sort(([a], [b]) => b.localeCompare(a))          // grösste Nummer zuerst
        .map(([sub, files]) => ({ caption: sub, path: `${sub}/_web`, files,     // Web-Versionen
          ...(ANALOGUE_INFO[sub] || {}) })),                                   // Text + Angaben pro Reihe
    },
  ],
  'Slaughter House': [
    {
      type: 'videos',
      columns: 1,                                 // ganzes Video in voller Breite
      folder: '_web',                             // Web-Version (kleiner, mit Ton)
      files: ['Slaughterhouse.mp4'],
      start: 5,                                   // läuft immer ab Sekunde 5 (Anfang ist schwarz)
      text: 'Slaughter House is a short film that immerses the viewer in an inner virtual world told from ' +
        'the perspective of non-human persons: sentient beings exploited and killed for their flesh. ' +
        'The film takes the form of the Bell Food Group slaughterhouse in Basel. Inspired by the Backrooms, ' +
        'its architecture becomes a distorted place of memory, holding both the lives of the animals and ' +
        'my own reflection during the hottest summer on record.',
      // Angaben unter dem Text (Zeilenumbrüche bleiben, Leerzeile = Abstand)
      credits: 'Slaughter House\n(2026), Video, 1920×1080,\n2:05 min, Cinema 4D, Blender\nAnimation\n\n' +
        'Independent Project',
    },
    // 3D-Modell (aus Cinema 4D), gleich wie bei der Scheune: dreht sich, Scrollen/Pinch zoomt
    { type: 'model3d', script: '_web/slaughter.glb.js', name: 'slaughter', info: false },
  ],
  'The Touch Within Data': [
    {
      type: 'videos',
      folder: '_web',
      files: ['Fischer_Patrick_01.mp4', 'Fischer_Patrick_02.mp4', 'Fischer_Patrick_03.mp4'],
      // Handtracking in der Lightbox (handtracking.js). Beim Spulen mit der Hand werden die
      // Versionen aus diesem Ordner genommen: jedes 3. Bild ein Keyframe → flüssiges Vor/Zurück
      handtracking: '_scrub',
      // Form der Hand-Punkte pro Video (gleiche Reihenfolge wie files):
      // Mimosa = Blatt, Venus = Stern, Drosera = Kreis
      shapes: ['leaf', 'star', 'circle'],
      // nur mit «Touch me» aktiv rückwärts gesteuert (normal läuft jedes Video vorwärts)
      reverseTouch: [false, false, false],   // true = mit «Touch me» rückwärts gesteuert
      // Angaben unter dem Text (Zeilenumbrüche bleiben, Leerzeile = Abstand)
      credits: 'The Touch Within Data\n(2025), 1080×1920,\nCinema 4D, JavaScript\n\n' +
        'Student Project\nFHNW HGK Basel\nLecturer Dirk Koy',
      text: 'Starting from three real plants that respond to touch, I ask what a digital touch might look like. ' +
        'In my poster series, I explore this question from a critical future perspective: humanity lives in a dystopia ' +
        'in which plants no longer exist in our physical world but coexist with us solely in digital form. ' +
        'This creates a visual language that transfers the relationship between humans and nature into digital space ' +
        'and makes tangible a world in which touch is no longer physical but conveyed through data and movement.',
    },
  ],
  'Creative Coding': [
    // Galerie wie bei Analogue Archive mit den Videos 1–4, darunter die Fotos fest in den Spalten 2–4
    {
      type: 'gallery',
      rows: [{
        caption: '',                                  // Titel in Spalte 2 (leer = ohne)
        path: '_web',
        files: ['1.mp4', '2.mp4', '3.mp4', '4.mp4'],
        tryMe: 'cameraSpheres',                       // Knopf «Try me» → Sketch im Vollbild
        text: 'The project was created for a group exhibition at Bollag Atelier in Basel, supervised by ' +
          'Martin Fuchs. A fixed camera captures its surroundings and transforms this input into ' +
          'negative space within the installation.',
        credits: 'x·-1\n(2025), Video Triptych,\n1920×1080, JavaScript/p5.js\n\n' +
          'Student Project\nFHNW HGK Basel\nLecturer Martin Fuchs',
      }],
    },
    // Fotos der Installation: fest in den rechten 3 Spalten, Spalte 1 bleibt frei
    { type: 'images', folder: '_web', files: ['6T4A2322.jpg', '6T4A2323.jpg', 'neu.jpg'] },
  ],
  'Thin Hair Setter': [
    // untereinander: Demo-Video, dann die zwei Bilder (je so gross wie möglich, mittig).
    // Über dem Video wie überall: Knopf «Download Tool» in Spalte 2, «+» in Spalte 4 mit Text
    {
      type: 'stack',
      files: ['_web/Demo.mp4', 'Output_Marked.png', 'Bildschirmfoto 2026-11-23 um 18.33.27.png'],
      download: { label: 'Download Tool', href: 'https://github.com/fischerpatrickch/Thin-Hair-Setter' },
      text: 'A scripting tool for Adobe InDesign that automates microtypographic adjustments. Thin Hair Setter ' +
        'inserts typographically correct spacing around punctuation marks, brackets, guillemets, dashes, and ' +
        'special characters. It also formats phone numbers, dates, abbreviations, units, and numerals — ' +
        'following Swiss typographic conventions.',
      credits: 'Thin Hair Setter\n(2026), Adobe InDesign Script,\np5.js, basil.js, Sublime Text\n\n' +
        'Student Project\nFHNW HGK Basel\nLecturer Ted Davis',
    },
  ],
  'Neue Scheune Merian Gärten': [
    // ganzes Video in voller Breite, «+» für den Text (Web-Version ohne Ton aus _web)
    {
      type: 'videos',
      columns: 1,
      folder: '_web',
      files: ['Scheune_Patrick_Ella_1.mp4'],
      text: 'Built in 1906 as a farm building and later home to the carriage and sleigh collection of the ' +
        'Historical Museum Basel, the barn at the Merian Gärten was converted by Miller & Maranta in 2023 into ' +
        'a restaurant and event hall. The project explores how existing architecture can be reinterpreted ' +
        'rather than replaced: the stone foundation anchors the building in the landscape, new openings connect ' +
        'the garden with the interior, and the preserved wood and natural stone keep its original character ' +
        'visible. Old and new elements form a new whole, making the case for building sustainably within ' +
        'existing structures.',
      // Angaben unter dem Text (Zeilenumbrüche bleiben, Leerzeile = Abstand)
      credits: 'Neue Scheune Merian Gärten\n(2025), Video, 1920×1080,\n1:45 min, Cinema 4D\nAnimation\n\n' +
        'Student Project\nFHNW HGK Basel\nLecturer Dirk Koy',
    },
    // 3D-Modell (aus Cinema 4D): dreht sich von selbst, mit der Maus drehen,
    // Scrollen (Seite steht) oder Zwei-Finger-Zoom/Pinch zoomt hinein
    { type: 'model3d', script: '_web/scheune.glb.js', name: 'scheune', info: false },   // info: false = ohne «+»
  ],
  [LSD]: [
    // 3D-Plakat: mit der Maus drehen, Klick auf Vorder-/Rückseite öffnet das Bild gross.
    // «+» in Spalte 4 zeigt den Text (text: '…' ergänzen, sonst Platzhalter)
    {
      type: 'poster3d',
      folder: '_web',
      files: ['Vorne.jpg', 'Hinten.jpg'],
      scrollButton: true,                         // Knopf «Scroll» → spielt die Faltung ab
      text: 'LSD is often seen in a negative light, shaped by its misuse as a drug and by social stigma, ' +
        'yet its history reaches from Albert Hofmann\'s accidental discovery to the pop culture of the 1960s ' +
        'and its role in therapy and research. This double-sided poster brings these contrasting aspects ' +
        'together and folds down to A5 to be sent by post: the back relies on dynamic typography, while the ' +
        'front works with grain, blur, distortion and toxic colours. Ears of grain were scanned on a copier, ' +
        'distorted through movement and coloured digitally, creating an interplay of natural and artificial elements.',
      credits: 'LSD Trip/Therapie\n(2024), A3 Digital Print\n\n' +
        'Student Project\nFHNW HGK Basel\nLecturer Leander Eisenmann',
    },
    {
      type: 'gallery',
      rows: [{
        caption: '',                                  // ohne Titel
        info: false,                                  // ohne «+»
        path: 'Prozess',
        files: ['Roggen1.jpg', 'Roggen2.jpg', 'Roggen3.jpg', 'Roggen4.jpg', 'Roggen5.jpg', 'Roggen6.jpg',
                'Seife2.jpg', 'Seife4_Hand.jpg', 'Seife5.jpg', 'Seife6.jpg', 'Seife7.jpg'],
      }],
    },
  ],
};

// ---------- 3D-Plakat: drehen mit der Maus, falten mit dem Scrollen ----------
// Ziehen dreht das Plakat, beim Loslassen dreht es mit Schwung weiter und läuft
// dann langsam von selbst. Kommt man beim Scrollen beim Plakat an, bleibt die Seite
// stehen und das Scrollen faltet das Plakat (gleiche Abfolge wie im Video):
//   1. Plakat dreht sich auf die Rückseite
//   2. Zickzack-Faltung quer in 4 Streifen
//   3. in der Mitte längs gefaltet
//   4. das gefaltete Kärtchen (LSD-Titel) kommt nach vorne in die Mitte
// Danach scrollt die Seite normal weiter, zurückscrollen faltet es wieder auf.
const FOLD_SCROLL = 2800;   // so viel Scrollen braucht die ganze Faltung (px)
const FOLD_HOLD = 0.15;     // erster Teil davon: Plakat bleibt noch flach (klickbar)

function initPoster3d(stage, card, srcs, onPick) {
  const [frontSrc, backSrc] = srcs;
  const fold = { p: 0, shown: 0 };          // p = Ziel (Scrollen), shown = sichtbar (weich)

  // ganzes Plakat (ungefaltet, ohne Nahtlinien)
  const full = document.createElement('div');
  full.className = 'poster3d__full';
  full.innerHTML =
    `<div class="poster3d__face" style="background-image:url('${backSrc}')"></div>` +
    `<div class="poster3d__face poster3d__face--front" style="background-image:url('${frontSrc}')"></div>`;

  // gefaltetes Plakat: 2 Hälften × 4 Streifen, jeder Streifen hängt am vorherigen
  // (Koordinaten von der Rückseite aus gesehen; Vorderseite ist gespiegelt)
  const mover = document.createElement('div');
  mover.className = 'poster3d__mover';
  const hinges = [[], []];
  const halves = [0, 1].map((c) => {
    const half = document.createElement('div');
    half.className = 'poster3d__half poster3d__half--' + (c ? 'r' : 'l');
    let parent = half;
    for (let r = 0; r < 4; r++) {
      const panel = document.createElement('div');
      panel.className = 'poster3d__panel' + (r ? ' poster3d__panel--next' : '');
      const pos = (col) => `${col * 100}% ${(r * 100) / 3}%`;
      panel.innerHTML =
        `<div class="poster3d__face" style="background-image:url('${backSrc}');background-position:${pos(c)}"></div>` +
        `<div class="poster3d__face poster3d__face--front" style="background-image:url('${frontSrc}');background-position:${pos(1 - c)}"></div>`;
      parent.appendChild(panel);
      if (r) hinges[c].push(panel);
      parent = panel;
    }
    mover.appendChild(half);
    return half;
  });
  card.append(full, mover);

  let rotY = -20, rotX = 0;          // Grad
  let moved = 0;                     // wie weit gezogen wurde (Klick oder Drehen?)
  let velY = 0;                      // Grad pro Frame
  const idle = 0.12;                 // langsames Weiterdrehen
  let dragging = false, lastX = 0, lastY = 0, visible = false, raf = 0;
  let foldBase = null;               // Drehung beim Start der Faltung
  let dragOff = 0;                   // Drehen mit der Maus während der Faltung (federt zurück)
  let spinY = 0, spinVel = 0;        // Drehen, wenn ganz gefaltet (bleibt, mit Schwung)
  const foldAmount = () => clamp01((fold.shown - FOLD_HOLD) / (1 - FOLD_HOLD));
  const spinWeight = () => seg(foldAmount(), 0.9, 1);   // erst ganz gefaltet frei drehbar

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const ease = (v) => (1 - Math.cos(Math.PI * v)) / 2;   // sanftes Ein-/Ausschwingen, gleichmässig in der Mitte
  const seg = (v, a, b) => ease(clamp01((v - a) / (b - a)));

  const render = () => {
    const f = foldAmount();
    const folding = f > 0.0005;
    card.classList.toggle('is-folding', folding);

    let y = rotY, x = rotX;
    if (folding) {
      if (foldBase === null) {
        foldBase = ((rotY % 360) + 540) % 360 - 180;    // auf -180…180 bringen
        rotY = foldBase;
      }
      const turn = seg(f, 0, 0.22);                      // 1. auf die Rückseite drehen
      const target = foldBase >= 0 ? 180 : -180;
      const wobble = Math.sin(Math.PI * clamp01((f - 0.1) / 0.8));    // räumlich schräg beim Falten
      y = foldBase + (target - foldBase) * turn + 28 * wobble + dragOff + spinY * spinWeight();
      x = rotX - 14 * wobble;

      // 2. Zickzack quer wie eine Ziehharmonika: zuerst knickt die Mitte (zwischen
      //    2. und 3. Viertel) ein, kurz danach die beiden äusseren Falze – alles schiebt
      //    sich gleichmässig zusammen und bleibt dabei in der Mitte
      const signs = [-1, 1, -1];
      const ranges = [[0.24, 0.56], [0.16, 0.5], [0.24, 0.56]];   // Mitte startet zuerst
      const angles = [0, 1, 2].map((k) => {
        const angle = signs[k] * 177 * seg(f, ranges[k][0], ranges[k][1]);
        hinges[0][k].style.transform = `rotateX(${angle}deg)`;
        hinges[1][k].style.transform = `rotateX(${angle}deg)`;
        return angle;
      });
      // wie hoch der Stapel gerade ist → so verschieben, dass er mittig bleibt
      let theta = 0, yPos = 1, yMin = 0, yMax = 1;            // in Streifen-Höhen
      angles.forEach((angle) => {
        theta += angle;
        yPos += Math.cos(theta * Math.PI / 180);
        yMin = Math.min(yMin, yPos); yMax = Math.max(yMax, yPos);
      });
      const shiftY = 0.5 - (yMin + yMax) / 2 / 4;             // Anteil der Plakathöhe

      // 3. rechte Hälfte längs nach hinten falten (Drehachse hinter dem Stapel), bleibt mittig
      const v = seg(f, 0.58, 0.84);
      const phi = 178 * v;
      halves[1].style.transform = `translateZ(-14px) rotateY(${phi}deg) translateZ(14px)`;
      const xMax = Math.max(1, 1 + Math.cos(phi * Math.PI / 180));   // in Hälften-Breiten
      const shiftX = 0.5 - xMax / 4;

      // 4. schon während des Faltens grösser werden (Kärtchen am Ende gross in der Mitte)
      const m = seg(f, 0.45, 1);
      mover.style.transform = `scale(${1 + m}) translate(${(shiftX * 100).toFixed(3)}%, ${(shiftY * 100).toFixed(3)}%)`;
    } else if (foldBase !== null) {
      rotY = foldBase;                                   // ganz aufgefaltet: weiterdrehen wie vorher
      foldBase = null;
      dragOff = 0;
      spinY = 0; spinVel = 0;
    }

    const shade = Math.abs(Math.sin(y * Math.PI / 180));
    card.style.setProperty('--light', (1 - shade * 0.45).toFixed(3));
    // +180: das Faltmodell ist von der Rückseite aus gebaut
    card.style.transform = `rotateX(${x.toFixed(2)}deg) rotateY(${(y + 180).toFixed(2)}deg)`;
  };

  const tick = () => {
    raf = 0;
    fold.shown += (fold.p - fold.shown) * 0.07;          // Faltung folgt dem Scrollen weich (glättet Mausrad-Sprünge)
    if (Math.abs(fold.p - fold.shown) < 0.0005) fold.shown = fold.p;
    const folding = foldAmount() > 0.0005;
    if (!dragging) {
      if (folding) {
        dragOff *= 0.94;                                 // Drehung von Hand federt zurück
        if (spinWeight() >= 1) {
          spinVel += (idle - spinVel) * 0.02;            // gefaltet: dreht mit Schwung, dann langsam weiter
          spinY += spinVel;
        } else {
          spinVel = 0;                                   // beim Auffalten: zurück auf die kürzeste Drehung
          spinY = ((spinY % 360) + 540) % 360 - 180;
          spinY *= 0.9;
        }
      } else {
        velY += (idle - velY) * 0.02;                    // Schwung klingt aus, geht ins langsame Drehen über
        rotY += velY;
      }
      rotX += (0 - rotX) * 0.06;                         // Neigung federt zurück
    }
    render();
    if (visible || dragging || fold.shown !== fold.p) raf = requestAnimationFrame(tick);
  };
  const start = () => { if (!raf) raf = requestAnimationFrame(tick); };
  fold.start = start;

  stage.addEventListener('pointerdown', (e) => {
    dragging = true;
    moved = 0;
    lastX = e.clientX; lastY = e.clientY; velY = 0;
    stage.classList.add('is-dragging');
    stage.setPointerCapture(e.pointerId);
    start();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    rotX = Math.max(-25, Math.min(25, rotX - dy * 0.25));
    if (foldAmount() > 0.0005 && spinWeight() >= 1) {
      spinY += dx * 0.4;                                 // ganz gefaltet: frei drehen
      spinVel = spinVel * 0.5 + dx * 0.4 * 0.5;
    } else if (foldAmount() > 0.0005) {
      dragOff += dx * 0.4;
    } else {
      rotY += dx * 0.4;
      velY = velY * 0.5 + dx * 0.4 * 0.5;
    }
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('is-dragging');
    velY = Math.max(-20, Math.min(20, velY));
    spinVel = Math.max(-20, Math.min(20, spinVel));
    // kaum bewegt = Klick: die Seite öffnen, die gerade zu sehen ist (nur ungefaltet)
    if (e.type === 'pointerup' && moved < 6 && onPick && foldAmount() < 0.0005) {
      const a = ((rotY % 360) + 360) % 360;
      velY = 0;
      onPick(a < 90 || a > 270 ? 0 : 1);
    }
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  // nur animieren, wenn das Plakat sichtbar ist
  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (visible) start();
  }).observe(stage);
  render();
  return fold;
}

// Scrollen auf einer Projektseite mit Faltplakat: kommt die Seite beim Plakat an,
// bleibt sie stehen und das Scrollen geht in die Faltung (zurück: erst auffalten).
// Gibt zurück, wie viel vom Scrollen noch für die Seite übrig bleibt.
// Gilt für alle «stehenden» Abschnitte: Faltplakat (LSD) und 3D-Modell (Scheune, Zoom).
function consumeFold(bar, delta) {
  const page = bar.querySelector('.bar__page');
  if (!page) return delta;
  // Handy: das Plakat faltet nur über den Knopf «Scroll», Scrollen läuft einfach weiter
  if (noHover()) return delta;
  page.querySelectorAll('.page__poster3d, .page__model3d').forEach((sec) => {
    if (sec.fold) delta = consumePinned(bar, sec, delta);
  });
  return delta;
}

function consumePinned(bar, sec, delta) {
  const f = sec.fold;
  const RANGE = f.range || FOLD_SCROLL;
  const pin = bar.offsetHeight + sec.offsetTop;   // hier steht das Plakat genau im Bild

  // Beim Ankommen: Schwung vom Scrollen nicht gleich ins Falten geben.
  // Erst wenn kurz nichts mehr kommt, faltet ein neues Scrollen weiter.
  const lockFold = () => {
    f.locked = true;
    clearTimeout(f.lockTimer);
    f.lockTimer = setTimeout(() => { f.locked = false; }, 220);
  };
  if (delta < 0) { f.locked = false; clearTimeout(f.lockTimer); }

  if (delta > 0 && f.p < 1 && pageOffset <= pin + 0.5) {
    const toPin = Math.max(0, pin - pageOffset);
    if (delta < toPin) return delta;
    if (toPin > 0 || f.locked) { lockFold(); return toPin; }   // angekommen: Seite steht
    const excess = delta - toPin;
    const used = Math.min(excess, (1 - f.p) * RANGE);
    f.p = Math.min(1, f.p + used / RANGE);
    f.start();
    return toPin + (excess - used);
  }
  if (delta < 0 && f.p > 0 && pageOffset >= pin - 0.5) {
    const toPin = Math.min(0, pin - pageOffset);
    if (delta >= toPin) return delta;
    const excess = toPin - delta;
    const used = Math.min(excess, f.p * RANGE);
    f.p = Math.max(0, f.p - used / RANGE);
    f.start();
    return toPin - (excess - used);
  }
  return delta;
}

// ---------- 3D-Modell (z. B. Neue Scheune) ----------
// three.js wird erst geladen, wenn die Seite geöffnet wird. Das Modell liegt als
// Text in einer .js-Datei, damit es auch direkt aus dem Ordner (ohne Server) lädt.
// Dreht sich langsam von selbst, Ziehen dreht mit Schwung (wie das LSD-Plakat).
// Zoomen: beim Modell angekommen bleibt die Seite stehen und Scrollen zoomt hinein,
// danach geht es weiter. Zusätzlich: Pinch auf dem Trackpad / zwei Finger.
const MODEL_ZOOM_SCROLL = 1600;   // so viel Scrollen für ganz hineinzoomen (px)
const MODEL_ZOOM_MAX = 0.8;       // 0.8 = bis auf 20 % der Anfangsdistanz heran

const scriptCache = {};
function loadScript(src) {
  if (!scriptCache[src]) {
    scriptCache[src] = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = reject;
      document.head.appendChild(el);
    });
  }
  return scriptCache[src];
}

function initModel3d(stage, dataSrc, name) {
  const ctrl = { p: 0, shown: 0, range: MODEL_ZOOM_SCROLL, start: () => {} };

  loadScript('vendor/three/three.min.js')
    .then(() => loadScript('vendor/three/GLTFLoader.js'))
    .then(() => loadScript(dataSrc))
    .then(setup)
    .catch((err) => console.warn('3D-Modell konnte nicht geladen werden', err));

  function setup() {
    const THREE = window.THREE;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputEncoding = THREE.sRGBEncoding;
    stage.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 2000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x202020, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 0.75);
    sun.position.set(40, 60, 30);
    scene.add(sun);
    const back = new THREE.DirectionalLight(0xffffff, 0.25);
    back.position.set(-40, 20, -30);
    scene.add(back);
    const pivot = new THREE.Group();
    scene.add(pivot);

    let fitDist = 100, rXZ = 1, height = 1;
    let rotY = -0.5, rotX = 0;            // Drehung (rad), Neigung (rad, zusätzlich)
    let velY = 0;
    const idle = 0.0025;                  // langsames Weiterdrehen
    const baseElev = 0.32;                // Blick leicht von oben
    let dragging = false, lastX = 0, lastY = 0, visible = false, raf = 0, ready = false;
    const pointers = new Map();
    let pinchDist = 0;

    // Modell aus dem eingebetteten Text laden
    const bin = atob(window.MODEL_DATA[name]);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    new THREE.GLTFLoader().parse(buf.buffer, '', (gltf) => {
      const model = gltf.scene;
      const mat = new THREE.MeshStandardMaterial({ color: 0xcfcfcf, roughness: 0.9, metalness: 0 });
      model.traverse((o) => { if (o.isMesh) o.material = mat; });
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      model.position.sub(center);            // Mitte des Modells = Drehpunkt
      pivot.add(model);
      rXZ = Math.hypot(size.x, size.z) / 2;
      height = size.y;
      ready = true;
      resize();
      start();
    });

    const ease = (v) => (1 - Math.cos(Math.PI * v)) / 2;

    function resize() {
      const w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // so weit weg, dass das drehende Modell in die mittleren 2 Spalten und in die Höhe passt
      const vHalf = (camera.fov * Math.PI / 180) / 2;
      // Computer: mittlere 2 von 4 Spalten (halbe Breite); Handy: beide Spalten (ganze Breite)
      const share = window.innerWidth <= 700 ? 0.95 : 0.5;
      const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect * share);
      // drehendes Modell = Kreis mit Radius rXZ; von leicht oben gesehen
      const distW = rXZ / Math.sin(hHalf);
      const halfH = (height / 2) * Math.cos(baseElev) + rXZ * Math.sin(baseElev);
      const distH = halfH / Math.sin(vHalf * 0.9);
      fitDist = Math.max(distW, distH);
    }
    new ResizeObserver(() => { resize(); start(); }).observe(stage);

    function render() {
      const z = ease(ctrl.shown);
      const dist = fitDist * (1 - MODEL_ZOOM_MAX * z);
      const elev = Math.max(-0.2, Math.min(1.2, baseElev + rotX));
      camera.position.set(0, Math.sin(elev) * dist, Math.cos(elev) * dist);
      camera.lookAt(0, 0, 0);
      pivot.rotation.y = rotY;
      renderer.render(scene, camera);
    }

    function tick() {
      raf = 0;
      ctrl.shown += (ctrl.p - ctrl.shown) * 0.08;      // Zoom folgt weich
      if (Math.abs(ctrl.p - ctrl.shown) < 0.0005) ctrl.shown = ctrl.p;
      if (!dragging) {
        velY += (idle - velY) * 0.02;                  // Schwung klingt aus → langsam weiter
        rotY += velY;
        rotX += (0 - rotX) * 0.05;                     // Neigung federt zurück
      }
      if (ready) render();
      if (visible || dragging || ctrl.shown !== ctrl.p) raf = requestAnimationFrame(tick);
    }
    function start() { if (!raf) raf = requestAnimationFrame(tick); }
    ctrl.start = start;

    // Drehen mit Maus / einem Finger, Zoomen mit zwei Fingern
    stage.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      stage.setPointerCapture(e.pointerId);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        dragging = false;
        return;
      }
      dragging = true;
      lastX = e.clientX; lastY = e.clientY; velY = 0;
      stage.classList.add('is-dragging');
      start();
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        ctrl.p = Math.max(0, Math.min(1, ctrl.p + (d - pinchDist) / 300));
        pinchDist = d;
        start();
        return;
      }
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      rotY += dx * 0.008;
      velY = velY * 0.5 + dx * 0.008 * 0.5;
      rotX = Math.max(-0.5, Math.min(0.8, rotX + dy * 0.005));
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        dragging = false;
        stage.classList.remove('is-dragging');
        velY = Math.max(-0.35, Math.min(0.35, velY));
      }
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);

    // Pinch auf dem Trackpad (kommt als Mausrad mit Ctrl) → zoomen, nicht die Seite
    stage.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      ctrl.p = Math.max(0, Math.min(1, ctrl.p - e.deltaY * 0.01));
      start();
    }, { passive: false });

    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible) start();
    }).observe(stage);
  }

  return ctrl;
}

// ---------- «Try me»: p5.js-Sketch im Vollbild (Creative Coding) ----------
// p5.js wird erst beim Klick geladen. Klick auf den Bildschirm (oder Esc) schliesst
// den Sketch und schaltet die Kamera wieder aus.
const SKETCHES = {
  // Kamerabild als Punktwolke aus kleinen Kugeln, Kamera schwingt hin und her
  cameraSpheres: (p) => {
    let myCapture;
    let cam;
    //https://p5js.org/reference/p5.Camera/roll/

    p.setup = () => {
      p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
      myCapture = p.createCapture(p.VIDEO, { flipped: true });
      myCapture.size(640, 480);
      myCapture.hide();
      p.capture = myCapture;

      cam = p.createCamera();
    };

    p.draw = () => {
      p.background(0);

      //translate(windowWidth*-0.2,windowHeight*-0.3)

      const camX = p.sin(p.frameCount * 0.01) * 700;
      const camY = p.sin(p.frameCount * 0.01) * 700;
      //let camY = sin(frameCount*0.01)*1000

      cam.setPosition(camX, camY, 400);
      //cam.setPosition(camY, 0, 800);
      cam.lookAt(0, 0, 0);

      const rectSize = 7;
      myCapture.loadPixels();

      for (let y = 0; y < myCapture.height; y += rectSize) {
        for (let x = 0; x < myCapture.width; x += rectSize) {
          const index = (x + y * myCapture.width) * 4;
          const r = myCapture.pixels[index];

          p.rotateX(p.sin(p.frameCount * 0.0000001));
          p.rotateY(p.frameCount * 0.000001);

          p.noFill();
          p.stroke(255);

          p.push();
          p.translate(x, y, r);
          p.sphere(1, 3, 2);
          //box(rectSize);
          p.pop();
        }
      }
    };

    p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);
  },
};

let sketchOverlay = null;

function openSketch(name) {
  if (sketchOverlay || !SKETCHES[name]) return;
  const overlay = document.createElement('div');
  overlay.className = 'sketch-overlay';
  overlay.addEventListener('click', closeSketch);                   // Klick → zurück zur Seite
  // Scrollen/Wischen im Vollbild nicht an die Seite weitergeben
  ['wheel', 'touchmove'].forEach((type) => overlay.addEventListener(type, (e) => {
    e.stopPropagation();
    if (type === 'wheel') e.preventDefault();
  }, { passive: false }));
  document.body.appendChild(overlay);
  sketchOverlay = { overlay, instance: null };

  loadScript('vendor/p5/p5.min.js').then(() => {
    if (!sketchOverlay || sketchOverlay.overlay !== overlay) return;   // schon wieder zu
    sketchOverlay.instance = new window.p5(SKETCHES[name], overlay);
    showCameraHint();                                              // kurzer Hinweis zur Kamera
  });
}

// kurzer Hinweis in der Mitte (wie bei «Touch me»): wächst, wird wieder klein, verschwindet
function showCameraHint() {
  hideCameraHint();
  const hint = document.createElement('div');
  hint.className = 'touch-hint';
  hint.textContent = 'Show your hands to the camera';
  document.body.appendChild(hint);
  hint.addEventListener('animationend', () => hint.remove());
}

function hideCameraHint() {
  document.querySelectorAll('.touch-hint').forEach((el) => el.remove());
}

function closeSketch() {
  if (!sketchOverlay) return;
  const { overlay, instance } = sketchOverlay;
  sketchOverlay = null;
  hideCameraHint();
  if (instance) {
    const stream = instance.capture && instance.capture.elt && instance.capture.elt.srcObject;
    if (stream) stream.getTracks().forEach((t) => t.stop());          // Kamera aus
    instance.remove();
  }
  overlay.remove();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSketch();
});

// Video läuft immer ab «start» Sekunden: beim Laden dorthin springen und am Ende
// wieder dorthin statt an den Anfang
function applyVideoStart(video, start) {
  video.loop = false;
  video.dataset.start = start;
  const jump = () => { if (video.currentTime < start) video.currentTime = start; };
  video.addEventListener('loadedmetadata', jump);
  video.addEventListener('play', jump);
  video.addEventListener('ended', () => {
    video.currentTime = start;
    video.play().catch(() => {});
  });
}

// Klick auf die Steuerleiste eines Videos (unterster Streifen) soll nichts anderes auslösen
function inVideoControls(e) {
  const v = e.target;
  if (!v || v.tagName !== 'VIDEO' || !v.controls) return false;
  const r = v.getBoundingClientRect();
  return e.clientY > r.bottom - 60;
}

// Knopf «Scroll» beim Faltplakat: Seite zum Plakat, dann Faltung abspielen
// (ist es schon gefaltet, faltet es sich wieder auf)
function playFold(section) {
  const f = section.fold;
  const bar = section.closest('.bar');
  if (!f || !bar) return;
  if (noHover()) {
    // Handy: Plakat mittig in den Bildschirm holen
    const r = section.querySelector('.poster3d').getBoundingClientRect();
    const d = r.top + r.height / 2 - window.innerHeight / 2;
    if (Math.abs(d) > 0.5) scrollOpenPage(d);
  } else {
    const pin = bar.offsetHeight + section.offsetTop;
    if (Math.abs(pin - pageOffset) > 0.5) scrollOpenPage(pin - pageOffset);   // Plakat ins Bild
  }
  const to = f.p >= 0.999 ? 0 : 1;
  const from = to === 1 ? Math.max(f.p, FOLD_HOLD) : f.p;   // flache Wartezone überspringen
  const duration = 4500 * Math.abs(to - from);          // ganze Faltung ≈ 4,5 Sekunden
  const t0 = performance.now();
  cancelAnimationFrame(f.playRaf);
  const step = (now) => {
    const k = duration ? Math.min(1, (now - t0) / duration) : 1;
    f.p = from + (to - from) * k;
    f.shown = f.p;                                      // folgt direkt, ohne Nachziehen
    f.start();
    if (k < 1) f.playRaf = requestAnimationFrame(step);
  };
  f.playRaf = requestAnimationFrame(step);
}

// Online heissen die Medienordner kürzer und ohne Sonderzeichen (z. B. «neue-scheune-merian-gaerten»),
// weil Umlaute/Doppelpunkte beim Hochladen sonst verloren gehen. Die Zuordnung steht dann
// in index.html (window.MEDIA_DIRS); lokal fehlt sie und es gelten die normalen Ordnernamen.
function mediaDir(name) {
  return (window.MEDIA_DIRS && window.MEDIA_DIRS[name]) || name;
}

function mediaUrl(first, ...parts) {
  return ['Media', mediaDir(first), ...parts].filter(Boolean)
    .map((p) => p.split('/').map(encodeURIComponent).join('/')).join('/');
}

// Video in einer Galerie-Reihe: stumm, im Loop; spielt nur, solange es zu sehen ist
const galleryVideoObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) entry.target.play().catch(() => {});
    else entry.target.pause();
  });
});

function makeGalleryVideo(src, page) {
  const video = document.createElement('video');
  video.src = src;
  video.width = 1920;                             // Seitenverhältnis schon vor dem Laden
  video.height = 1080;
  video.dataset.lightboxIndex = page.lightboxList.length;
  page.lightboxList.push(src);                    // Klick → gross in der Lightbox
  return video;
}

function prepareGalleryVideo(video) {
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'metadata';
  galleryVideoObserver.observe(video);
}

function makeImage(src, page) {
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  img.decoding = 'async';
  img.draggable = false;                          // kein Browser-Bild-Ziehen
  img.loading = 'lazy';
  img.dataset.lightboxIndex = page.lightboxList.length;
  page.lightboxList.push(src);                    // Lightbox blättert innerhalb dieser Seite
  return img;
}

// Platzhalter-Text, bis echte Texte da sind (pro Reihe später mit text: '…' ersetzbar)
const GALLERY_PLACEHOLDER =
  'Hier steht bald ein kurzer Text zu dieser Serie. ' +
  'Er beschreibt die Idee, den Entstehungsprozess und die verwendeten Techniken. ' +
  'Bis dahin dient dieser Platzhalter als Vorschau für das Layout.';

function buildGallery(page) {
  if (page.dataset.built) return;
  page.dataset.built = 'true';
  page.lightboxList = [];

  const folder = page.dataset.gallery;
  (PAGE_CONTENT[folder] || []).forEach((block) => {
    if (block.type === 'poster3d') {
      // wie die anderen Abschnitte: Kopfzeile im 4er-Raster mit «+» in Spalte 4,
      // Text klappt darunter auf, das Plakat steht mittig über den Spalten 2–3
      const section = document.createElement('section');
      section.className = 'gallery__section page__poster3d';

      const head = document.createElement('div');
      head.className = 'gallery__head';
      const plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'gallery__plus';
      plus.textContent = '+';
      plus.setAttribute('aria-label', 'Text anzeigen');
      head.appendChild(plus);

      const info = document.createElement('div');
      info.className = 'gallery__info';
      info.innerHTML = '<div class="gallery__info-inner"><p></p></div>';
      info.querySelector('p').textContent = block.text || GALLERY_PLACEHOLDER;
      if (block.credits) {
        const credits = document.createElement('p');
        credits.className = 'gallery__credits';
        credits.textContent = block.credits;
        info.querySelector('.gallery__info-inner').appendChild(credits);
      }
      // «Scroll» in Spalte 2: spielt die Faltung von selbst ab (nochmals klicken = auffalten)
      if (block.scrollButton) {
        const scrollBtn = document.createElement('button');
        scrollBtn.type = 'button';
        scrollBtn.className = 'try-toggle scroll-toggle';
        scrollBtn.textContent = 'Scroll';
        scrollBtn.addEventListener('click', () => playFold(section));
        head.appendChild(scrollBtn);
      }

      plus.addEventListener('click', () => {
        const open = section.classList.toggle('show-info');
        plus.textContent = open ? '−' : '+';
        plus.setAttribute('aria-label', open ? 'Text schliessen' : 'Text anzeigen');
      });

      const grid = document.createElement('div');
      grid.className = 'grid-poster3d';
      const stage = document.createElement('div');
      stage.className = 'poster3d';
      const card = document.createElement('div');
      card.className = 'poster3d__card';
      const indexes = [];
      const srcs = block.files.map((file) => {
        const src = mediaUrl(folder, block.folder, file);
        indexes.push(page.lightboxList.length);   // gleiche Lightbox wie die Galerien
        page.lightboxList.push(src);
        return src;
      });
      stage.appendChild(card);
      grid.appendChild(stage);

      section.append(head, info, grid);
      page.appendChild(section);
      section.fold = initPoster3d(stage, card, srcs, (side) => openPosterLightbox(page, indexes[side]));
    }

    if (block.type === 'model3d') {
      // wie die anderen Abschnitte: «+» in Spalte 4, Text klappt auf,
      // das Modell steht mittig im Raster (Zeichenfläche über alle 4 Spalten)
      const section = document.createElement('section');
      section.className = 'gallery__section page__model3d';

      const head = document.createElement('div');
      head.className = 'gallery__head';
      const plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'gallery__plus';
      plus.textContent = '+';
      plus.setAttribute('aria-label', 'Text anzeigen');
      if (block.info !== false) head.appendChild(plus);   // Kopfzeile bleibt (gleiche Höhe), nur ohne «+»

      const info = document.createElement('div');
      info.className = 'gallery__info';
      info.innerHTML = '<div class="gallery__info-inner"><p></p></div>';
      info.querySelector('p').textContent = block.text || GALLERY_PLACEHOLDER;

      plus.addEventListener('click', () => {
        const open = section.classList.toggle('show-info');
        plus.textContent = open ? '−' : '+';
        plus.setAttribute('aria-label', open ? 'Text schliessen' : 'Text anzeigen');
      });

      const grid = document.createElement('div');
      grid.className = 'grid-model3d';
      const stage = document.createElement('div');
      stage.className = 'model3d';
      grid.appendChild(stage);

      if (block.info !== false) section.append(head, info, grid);
      else section.append(head, grid);
      page.appendChild(section);
      // Zoomen nur mit zwei Fingern / Trackpad-Pinch, nicht mehr durch Scrollen (Seite bleibt nicht stehen)
      section.zoom = initModel3d(stage, mediaUrl(folder, block.script), block.name);
    }

    if (block.type === 'info') {
      // Abschnitt nur mit Text: Kopfzeile (Knopf in Spalte 2, «−» in Spalte 4), Text schon offen
      const section = document.createElement('section');
      section.className = 'gallery__section page__info show-info';
      const head = document.createElement('div');
      head.className = 'gallery__head';
      if (block.download) {
        const link = document.createElement('a');
        link.className = 'try-toggle';
        link.href = block.download.href;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = block.download.label;
        head.appendChild(link);
      }
      const plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'gallery__plus';
      plus.textContent = '−';
      plus.setAttribute('aria-label', 'Text schliessen');
      head.appendChild(plus);

      const info = document.createElement('div');
      info.className = 'gallery__info';
      info.innerHTML = '<div class="gallery__info-inner"><p></p></div>';
      info.querySelector('p').textContent = block.text || GALLERY_PLACEHOLDER;
      if (block.credits) {
        const credits = document.createElement('p');
        credits.className = 'gallery__credits';
        credits.textContent = block.credits;
        info.querySelector('.gallery__info-inner').appendChild(credits);
      }
      plus.addEventListener('click', () => {
        const open = section.classList.toggle('show-info');
        plus.textContent = open ? '−' : '+';
        plus.setAttribute('aria-label', open ? 'Text schliessen' : 'Text anzeigen');
      });
      section.append(head, info);
      page.appendChild(section);
    }

    if (block.type === 'stack') {
      // jedes Bild/Video in einem eigenen Abschnitt untereinander, mittig im Raster
      block.files.forEach((file, idx) => {
        const section = document.createElement('section');
        section.className = 'gallery__section page__stack';
        const head = document.createElement('div');
        head.className = 'gallery__head';              // leere Kopfzeile, gleiche Abstände
        let info = null;
        // erster Abschnitt: Knopf (Spalte 2) und «+» (Spalte 4) mit Text, zu Beginn zu
        if (idx === 0 && (block.download || block.text)) {
          if (block.download) {
            const link = document.createElement('a');
            link.className = 'try-toggle';
            link.href = block.download.href;
            link.target = '_blank';
            link.rel = 'noopener';
            link.textContent = block.download.label;
            head.appendChild(link);
          }
          const plus = document.createElement('button');
          plus.type = 'button';
          plus.className = 'gallery__plus';
          plus.textContent = '+';
          plus.setAttribute('aria-label', 'Text anzeigen');
          head.appendChild(plus);
          info = document.createElement('div');
          info.className = 'gallery__info';
          info.innerHTML = '<div class="gallery__info-inner"><p></p></div>';
          info.querySelector('p').textContent = block.text || GALLERY_PLACEHOLDER;
          if (block.credits) {
            const credits = document.createElement('p');
            credits.className = 'gallery__credits';
            credits.textContent = block.credits;
            info.querySelector('.gallery__info-inner').appendChild(credits);
          }
          plus.addEventListener('click', () => {
            const open = section.classList.toggle('show-info');
            plus.textContent = open ? '−' : '+';
            plus.setAttribute('aria-label', open ? 'Text schliessen' : 'Text anzeigen');
          });
        }
        const grid = document.createElement('div');
        grid.className = 'grid-1';
        const src = mediaUrl(folder, file);
        let el;
        if (/\.(mp4|mov|webm)$/i.test(file)) {
          el = document.createElement('video');
          el.src = src;
          el.muted = true;
          el.loop = true;
          el.playsInline = true;
          el.autoplay = true;
          el.controls = true;                         // Steuerleiste (Ton, Pause, Zeit)
          el.dataset.lightboxIndex = page.lightboxList.length;
          page.lightboxList.push(src);
          el.play().catch(() => {});
        } else {
          el = makeImage(src, page);
        }
        el.classList.add('zoomable');                 // Klick → gross
        grid.appendChild(el);
        if (info) section.append(head, info, grid);
        else section.append(head, grid);
        page.appendChild(section);
      });
    }

    if (block.type === 'images') {
      // wie das Video-Triptychon: Bilder je mittig in den Spalten 2–4, Kopfzeile leer
      const section = document.createElement('section');
      section.className = 'gallery__section page__images';
      const head = document.createElement('div');
      head.className = 'gallery__head';
      const grid = document.createElement('div');
      grid.className = 'grid-3';
      block.files.forEach((file) => {
        const img = makeImage(mediaUrl(folder, block.folder, file), page);
        img.classList.add('zoomable');               // Klick → gross
        grid.appendChild(img);
      });
      section.append(head, grid);
      page.appendChild(section);
    }

    if (block.type === 'pair') {
      const section = document.createElement('section');
      section.className = 'page__section page__pair';
      block.files.forEach((file) => {
        const img = makeImage(mediaUrl(folder, file), page);
        img.classList.add('zoomable');
        img.loading = 'eager';
        section.appendChild(img);
      });
      page.appendChild(section);
    }

    if (block.type === 'videos') {
      // oben: 4er-Raster mit «+» in Spalte 4, Text klappt darunter auf (Spalten 2–4)
      // darunter: ausnahmsweise ein 3er-Raster mit den Videos
      // gleicher Aufbau wie eine Galerie-Reihe (ein Bildschirm hoch, Kopfzeile mit «+»,
      // Text klappt auf), nur stehen die Videos still in einem 3er-Raster
      const section = document.createElement('section');
      section.className = 'gallery__section page__videos';

      const head = document.createElement('div');
      head.className = 'gallery__head';
      const plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'gallery__plus';
      plus.textContent = '+';
      plus.setAttribute('aria-label', 'Text anzeigen');
      head.appendChild(plus);

      // «Touch» in Spalte 2 der Kopfzeile: Handtracking für alle drei Videos (handtracking.js)
      if (block.handtracking) {
        const touchBtn = document.createElement('button');
        touchBtn.type = 'button';
        touchBtn.className = 'touch-grid-toggle';
        touchBtn.textContent = 'Touch me';
        head.prepend(touchBtn);
      }

      const info = document.createElement('div');
      info.className = 'gallery__info';
      info.innerHTML = '<div class="gallery__info-inner"><p></p></div>';
      info.querySelector('p').textContent = block.text || GALLERY_PLACEHOLDER;
      if (block.credits) {
        const credits = document.createElement('p');
        credits.className = 'gallery__credits';
        credits.textContent = block.credits;
        info.querySelector('.gallery__info-inner').appendChild(credits);
      }

      plus.addEventListener('click', () => {
        const open = section.classList.toggle('show-info');
        plus.textContent = open ? '−' : '+';
        plus.setAttribute('aria-label', open ? 'Text schliessen' : 'Text anzeigen');
      });

      const grid = document.createElement('div');
      grid.className = block.columns === 1 ? 'grid-1' : 'grid-3';
      block.files.forEach((file, i) => {
        const video = document.createElement('video');
        video.src = mediaUrl(folder, block.folder, file);
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.autoplay = true;
        video.controls = true;                         // Steuerleiste vom Browser (Play, Ton, Zeit)
        video.classList.add('zoomable');               // Klick → einzeln gross
        video.dataset.lightboxIndex = page.lightboxList.length;
        page.lightboxList.push(video.src);
        if (block.start) {
          applyVideoStart(video, block.start);
          page.startList = page.startList || {};
          page.startList[video.src] = block.start;     // auch in der Grossansicht ab hier
        }
        if (block.handtracking) {
          const scrub = new URL(mediaUrl(folder, block.handtracking, file), location.href).href;
          const shape = (block.shapes && block.shapes[i]) || 'circle';
          video.dataset.scrub = scrub;
          video.dataset.shape = shape;
          const reverse = !!(block.reverseTouch && block.reverseTouch[i]);
          if (reverse) video.dataset.reverse = '1';
          page.reverseList = page.reverseList || {};
          page.reverseList[video.src] = reverse;
          page.scrubList = page.scrubList || {};
          page.shapeList = page.shapeList || {};
          page.scrubList[video.src] = scrub;
          page.shapeList[video.src] = shape;
        }
        grid.appendChild(video);
        video.play().catch(() => {});
      });

      section.append(head, info, grid);
      page.appendChild(section);
    }

    if (block.type === 'video') {
      const section = document.createElement('section');
      section.className = 'page__section page__video';
      const video = document.createElement('video');
      video.src = mediaUrl(folder, block.file);
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.autoplay = true;
      video.controls = true;
      section.appendChild(video);
      page.appendChild(section);
      video.play().catch(() => {});
    }

    if (block.type === 'gallery') {
      block.rows.forEach((row, i) => {
        const section = document.createElement('section');
        section.className = 'gallery__section';

        // Kopfzeile im 4er-Raster: Ordnername links, «+» mittig in der rechten Spalte
        const head = document.createElement('div');
        head.className = 'gallery__head';
        const caption = document.createElement('p');
        caption.className = 'gallery__caption';
        caption.textContent = row.caption;
        const plus = document.createElement('button');
        plus.type = 'button';
        plus.className = 'gallery__plus';
        plus.textContent = '+';
        plus.setAttribute('aria-label', 'Text anzeigen');
        head.append(caption);
        if (row.info !== false) head.appendChild(plus);   // info: false = Reihe ohne «+»
        if (row.tryMe) {
          const tryBtn = document.createElement('button');
          tryBtn.type = 'button';
          tryBtn.className = 'try-toggle';
          tryBtn.textContent = 'Try me';
          tryBtn.addEventListener('click', () => openSketch(row.tryMe));
          head.appendChild(tryBtn);
        }

        // Text oberhalb der Galerie über 3/4 der Breite (Spalten 2–4),
        // klappt per Klick auf «+» auf; «−» schliesst ihn wieder
        const info = document.createElement('div');
        info.className = 'gallery__info';
        info.innerHTML = `<div class="gallery__info-inner"><p>${row.text || GALLERY_PLACEHOLDER}</p></div>`;
        if (row.credits) {
          const credits = document.createElement('p');
          credits.className = 'gallery__credits';
          credits.textContent = row.credits;               // Zeilenumbrüche bleiben (CSS)
          info.querySelector('.gallery__info-inner').appendChild(credits);
        }
        plus.addEventListener('click', () => {
          const open = section.classList.toggle('show-info');
          plus.textContent = open ? '−' : '+';
          plus.setAttribute('aria-label', open ? 'Text schliessen' : 'Text anzeigen');
        });

        // erste Kopie registriert die Bilder für die Lightbox, weitere Kopien zeigen darauf
        const track = document.createElement('div');
        track.className = 'gallery__track';
        // Bilder oder Videos (Videos laufen stumm im Loop, nur wenn sichtbar)
        const first = row.files.map((file) => (/\.(mp4|mov|webm)$/i.test(file)
          ? makeGalleryVideo(mediaUrl(folder, row.path, file), page)
          : makeImage(mediaUrl(folder, row.path, file), page)));
        for (let c = 0; c < GALLERY_COPIES; c++) {
          first.forEach((el) => {
            const item = c === 0 ? el : el.cloneNode();
            if (item.tagName === 'VIDEO') prepareGalleryVideo(item);
            track.appendChild(item);
          });
        }

        section.append(head, info, track);
        page.appendChild(section);

        // leicht unterschiedliche Geschwindigkeit pro Reihe wirkt lebendiger
        galleryRows.push({ page, section, track, x: 0, vel: 0, dragging: false, speed: 1 + (i % 3) * 0.15 });
      });
    }
  });

  appendProjectNav(page);                  // ganz unten: vorheriges / nächstes Projekt
}

// ---------- Ganz unten auf jeder Projektseite: vorheriges | nächstes Projekt ----------
// Balken in zwei Hälften (Spalten 1–2 und 3–4): links das vorherige Projekt, rechts das
// folgende, je mit Thumbnail und Titel. Klick: die Hälfte wächst wie ein Kästchen auf der
// Startseite auf den ganzen Bildschirm und das Projekt ist offen (ohne Umweg über die Startseite).
const navBars = projectBars.filter((b) => b !== titleBar);   // Reihenfolge wie auf der Startseite

function appendProjectNav(page) {
  const bar = page.closest('.bar');
  const i = navBars.indexOf(bar);
  if (i < 0) return;
  const prev = navBars[(i - 1 + navBars.length) % navBars.length];
  const next = navBars[(i + 1) % navBars.length];

  const section = document.createElement('section');
  section.className = 'page__projectnav';
  const nav = document.createElement('nav');
  nav.className = 'project-nav';
  [prev, next].forEach((target) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'project-nav__item';
    const media = projectThumb(target);
    if (media) item.appendChild(media);
    const label = document.createElement('span');
    label.className = 'project-nav__label';
    label.innerHTML = target.querySelector('.bar__label').innerHTML;   // gleicher Titel (inkl. – und /)
    label.style.setProperty('--chars', label.textContent.trim().length);  // für die Grösse beim Hovern
    item.appendChild(label);
    item.addEventListener('click', () => switchProject(target, item));
    nav.appendChild(item);
  });
  section.appendChild(nav);
  page.appendChild(section);
}

// Thumbnail des anderen Projekts: Bild/Video übernehmen, Zeichenfläche als Standbild
function projectThumb(bar) {
  const src = bar.querySelector('.bar__media img, .bar__media video, .bar__media canvas');
  if (!src) return null;
  let el;
  if (src.tagName === 'CANVAS') {
    // Thin Hair Setter: eigenes, lebendiges Satzzeichen-Feld (weicht auch hier der Maus aus)
    el = document.createElement('canvas');
    el.className = 'symbol-field';
    initSymbolField(el);
    el.classList.add('project-nav__media');
    return el;
  } else if (src.tagName === 'VIDEO') {
    el = document.createElement('video');
    el.src = src.currentSrc || src.src;
    if (noHover()) {
      // Handy: Vorschau unten steht still (nur Standbild)
      el.muted = true;
      el.playsInline = true;
      el.preload = 'metadata';
      if (src.poster) el.poster = src.poster;
    } else {
      prepareGalleryVideo(el);               // stumm, Loop, spielt nur wenn sichtbar
    }
  } else {
    el = document.createElement('img');
    el.src = src.currentSrc || src.src;
  }
  el.className = 'project-nav__media';
  el.alt = '';
  el.draggable = false;
  return el;
}

function switchProject(target, fromEl) {
  if (document.querySelector('.project-switch')) return;
  closeLightbox();
  const current = document.querySelector('.bar.is-open');

  // Deckblatt: Thumbnail + grosser Titel des neuen Projekts (wie ein frisch geöffnetes Projekt)
  const cover = document.createElement('div');
  cover.className = 'project-switch';
  const media = projectThumb(target);
  if (media) {
    media.className = 'project-switch__media';
    if (media.tagName === 'VIDEO') { galleryVideoObserver.unobserve(media); media.play().catch(() => {}); }
    cover.appendChild(media);
  }
  const targetLabel = target.querySelector('.bar__label');
  const label = document.createElement('span');
  label.className = 'project-switch__label';
  label.innerHTML = targetLabel.innerHTML;
  label.style.setProperty('--fit', targetLabel.style.getPropertyValue('--fit') || 1);
  cover.appendChild(label);

  // startet genau dort, wo die angeklickte Hälfte ist, mit gleich grossem Titel …
  const r = fromEl ? fromEl.getBoundingClientRect() : { top: innerHeight, left: 0, width: innerWidth, height: 0 };
  Object.assign(cover.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px` });
  const fromLabel = fromEl && fromEl.querySelector('.project-nav__label');
  if (fromLabel) label.style.fontSize = getComputedStyle(fromLabel).fontSize;
  document.body.appendChild(cover);
  cover.getBoundingClientRect();
  // … und wächst wie auf der Startseite auf den ganzen Bildschirm, Titel wird gross
  cover.classList.add('is-in');
  Object.assign(cover.style, { top: '0px', left: '0px', width: '100%', height: '100%' });
  label.style.fontSize = '';

  setTimeout(() => {
    // verdeckt: ohne Übergänge das alte Projekt zu, das neue auf
    document.documentElement.classList.add('no-anim');
    if (current) {
      resetOpenPage();
      current.classList.remove('is-open', 'is-closing');
      pauseVideo(current);
    }
    activeIndex = allBars.indexOf(target);
    allBars.forEach((b) => b.classList.toggle('is-active', b === target));
    openBar(target);                         // Titel wandert danach wie gewohnt nach oben
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.documentElement.classList.remove('no-anim');
      cover.classList.add('is-out');         // Deckblatt weich weg, darunter dasselbe Bild
      setTimeout(() => cover.remove(), 450);
    }));
  }, 850);
}

function galleryFrame(now) {
  const dt = Math.min(0.05, (now - (galleryFrame.last || now)) / 1000);
  galleryFrame.last = now;

  // Scroll-Schwung weich abklingen lassen
  const boost = galleryBoost * GALLERY_SCROLL_FACTOR;
  galleryBoost *= 0.85;
  if (Math.abs(galleryBoost) < 0.1) galleryBoost = 0;

  galleryRows.forEach((row) => {
    if (!row.page.closest('.bar').classList.contains('is-open')) return;
    if (lightboxOpen) return;

    const setWidth = row.track.scrollWidth / GALLERY_COPIES;   // Breite einer Kopie
    if (!setWidth) return;

    if (!row.dragging) {
      // Nur die aktuelle Reihe (die die Bildschirmmitte abdeckt) läuft von alleine
      // und mit dem Scrollen. Reihen, die oben/unten raus- oder reinkommen, stehen still.
      // Scrollen gibt keinen zusätzlichen Schub mehr: die Galerie bewegt sich einfach langsam
      if (isCurrentRow(row)) {
        row.x -= GALLERY_SPEED * dt * row.speed;
      }
      // Schwung nach dem Ziehen weich auslaufen lassen
      row.x += row.vel * dt;
      row.vel *= 0.92;
      if (Math.abs(row.vel) < 5) row.vel = 0;
    }

    // endlos: nach einer Kopie wieder zurückspringen (unsichtbar)
    while (row.x <= -setWidth) row.x += setWidth;
    while (row.x > 0) row.x -= setWidth;

    row.track.style.transform = `translateX(${row.x}px)`;
  });

  requestAnimationFrame(galleryFrame);
}

function isCurrentRow(row) {
  const middle = window.innerHeight / 2;
  const rect = row.section.getBoundingClientRect();
  return rect.top <= middle && rect.bottom >= middle;
}

// Trackpad seitwärts: aktuelle Reihe direkt mitverschieben
function nudgeCurrentRow(dx) {
  const row = galleryRows.find((r) =>
    r.page.closest('.bar').classList.contains('is-open') && isCurrentRow(r));
  if (!row) return false;
  row.x += dx;
  row.vel = 0;
  return true;
}

// ---------- Galerie mit der Maus (oder dem Finger) seitwärts ziehen ----------
let drag = null;
let suppressClick = false;
const GALLERY_TOUCH_FACTOR = 2;   // Handy: so viel stärker folgt die Galerie dem Finger

document.addEventListener('pointerdown', (e) => {
  const track = e.target.closest('.gallery__track');
  if (!track || lightboxOpen) return;
  const row = galleryRows.find((r) => r.track === track);
  if (!row) return;

  drag = { row, lastX: e.clientX, lastT: performance.now(), moved: 0, vel: 0,
           startX: e.clientX, startY: e.clientY };
  // Finger: Reihe erst festhalten, wenn klar seitwärts gewischt wird – beim
  // Hoch-/Runterscrollen über die Galerie läuft sie einfach weiter
  if (e.pointerType === 'touch') {
    drag.pending = true;
    return;
  }
  row.dragging = true;
  row.vel = 0;
  track.classList.add('is-dragging');
});

window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (drag.pending) {
    const ax = Math.abs(e.clientX - drag.startX);
    const ay = Math.abs(e.clientY - drag.startY);
    if (ay > 6 && ay > ax) { drag = null; return; }   // senkrecht → Seite scrollen
    if (ax < 6) return;
    drag.pending = false;                             // seitwärts → Reihe ziehen
    drag.row.dragging = true;
    drag.row.vel = 0;
    drag.lastX = e.clientX;
    drag.row.track.classList.add('is-dragging');
    return;
  }
  const now = performance.now();
  const dx = e.clientX - drag.lastX;
  const dtime = Math.max(1, now - drag.lastT);

  // Finger: Galerie bewegt sich stärker als der Finger (reagiert direkter)
  drag.row.x += dx * (e.pointerType === 'touch' ? GALLERY_TOUCH_FACTOR : 1);
  drag.moved += Math.abs(dx);
  drag.vel = drag.vel * 0.7 + (dx / dtime) * 1000 * 0.3;   // geglättete Geschwindigkeit
  drag.lastX = e.clientX;
  drag.lastT = now;
});

// abgebrochene Berührung (z. B. weil der Browser senkrecht scrollt): Reihe wieder freigeben
window.addEventListener('pointercancel', () => {
  if (!drag) return;
  drag.row.dragging = false;
  drag.row.track.classList.remove('is-dragging');
  drag = null;
});

window.addEventListener('pointerup', () => {
  if (!drag) return;
  if (drag.pending) { drag = null; return; }   // nur angetippt
  drag.row.dragging = false;
  drag.row.vel = noHover() ? 0 : drag.vel; // Computer: mit Schwung loslassen; Handy: bleibt stehen
  drag.row.track.classList.remove('is-dragging');
  suppressClick = drag.moved > 5;          // gezogen statt geklickt → kein Bild öffnen
  drag = null;
});

requestAnimationFrame(galleryFrame);

// Seiteninhalt (Galerie usw.) erst aufbauen, wenn die Öffnen-Animation fertig ist:
// das Laden vieler grosser Bilder würde sonst die Animation ruckeln lassen
// (z. B. «fischerpatrick.ch» schien bei Analogue Archive kurz zu verschwinden).
document.addEventListener('animationend', (e) => {
  if (e.animationName !== 'title-to-top') return;
  const page = e.target.closest('.bar')?.querySelector('.bar__page[data-gallery]');
  if (page) buildGallery(page);
});

// ---------- Lightbox: Bild maximal gross, durch die Galerie scrollen ----------
// Klick auf ein Galerie-Bild zeigt es so gross wie der Bildschirm erlaubt.
// Scrollen (oder Pfeiltasten / Wischen) blättert durch alle Bilder der Galerie
// in der angezeigten Reihenfolge. Klick oder Escape schliesst.
let lightboxImages = [];        // Bilder der aktuell geöffneten Seite
let lightboxIndex = 0;
let lightboxOpen = false;
let lightboxScrollSum = 0;
let lightboxLastStep = 0;
let lightboxStart = null;       // Videos, die ab einer bestimmten Sekunde laufen
let lightboxScrub = null;       // Spul-Versionen der Videos, wenn die Seite Handtracking hat
let lightboxShapes = null;      // Form der Hand-Punkte pro Video
let lightboxReverse = null;     // Videos, die mit «Touch me» rückwärts gesteuert werden

const lightbox = document.createElement('div');
lightbox.className = 'lightbox';
lightbox.innerHTML = '<img class="lightbox__img" alt=""><img class="lightbox__img" alt="">' +
  '<video class="lightbox__img lightbox__video" muted loop playsinline></video>';
document.body.appendChild(lightbox);
const lightboxLayers = [...lightbox.querySelectorAll('img.lightbox__img')];
let lightboxFront = 0;

function showLightbox(index) {
  if (!lightboxImages.length) return;
  lightboxIndex = (index + lightboxImages.length) % lightboxImages.length;   // endlos

  const src = lightboxImages[lightboxIndex];
  const lbVideo = lightbox.querySelector('.lightbox__video');

  if (/\.(mp4|mov|webm)(#|$)/i.test(src)) {
    // Video: eigene Ebene, Bilder ausblenden
    lightboxLayers.forEach((l) => l.classList.remove('is-visible'));
    // Handtracking aktiv: Spul-Version zeigen, die Hand steuert das Video (kein Abspielen)
    lightbox.dataset.shape = (lightboxShapes && lightboxShapes[src]) || 'circle';
    lightbox.dataset.reverse = (lightboxReverse && lightboxReverse[src]) ? '1' : '';
    const touch = window.touchTracking && window.touchTracking.active && lightboxScrub && lightboxScrub[src];
    const videoSrc = touch || src;
    if (lbVideo.src !== videoSrc) {
      lbVideo.src = videoSrc;
      const start = (!touch && lightboxStart && lightboxStart[src]) || 0;
      lbVideo.dataset.start = start;
      if (start) lbVideo.currentTime = start;
    }
    lbVideo.controls = !lightboxScrub;                   // Steuerleiste (nicht bei Handtracking)
    if (touch) lbVideo.pause();
    else lbVideo.play().catch(() => {});
    lbVideo.classList.add('is-visible');
  } else {
    lbVideo.classList.remove('is-visible');
    lbVideo.pause();
    // Überblenden zwischen zwei Bild-Ebenen
    const next = lightboxLayers[1 - lightboxFront];
    const prev = lightboxLayers[lightboxFront];
    next.src = src;
    next.classList.add('is-visible');
    prev.classList.remove('is-visible');
    lightboxFront = 1 - lightboxFront;
  }

  lightboxOpen = true;
  lightbox.classList.add('is-open');
}

function closeLightbox() {
  if (!lightboxOpen) return;
  lightboxOpen = false;
  lightbox.classList.remove('is-open');
  lightboxLayers.forEach((l) => l.classList.remove('is-visible'));
  const lbVideo = lightbox.querySelector('.lightbox__video');
  lbVideo.classList.remove('is-visible');
  lbVideo.pause();
  document.dispatchEvent(new Event('lightbox:close'));   // beendet das Handtracking
}

// für handtracking.js: aktuelles Lightbox-Element neu zeigen (z. B. auf Spul-Version wechseln)
window.refreshLightbox = () => { if (lightboxOpen) showLightbox(lightboxIndex); };

// Pro Wisch genau ein Bild weiter: Nach einem Wechsel wird gesperrt, bis der
// Wisch (inkl. Nachrollen) vorbei ist – also wenn kurz nichts mehr kommt oder
// ein neuer Wisch erkennbar ist (Ausschlag wird plötzlich wieder grösser).
let lightboxLocked = false;
let lightboxLastDelta = 0;
let lightboxIdleTimer = null;

function handleLightboxScroll(delta) {
  const size = Math.abs(delta);

  clearTimeout(lightboxIdleTimer);
  lightboxIdleTimer = setTimeout(() => {
    lightboxLocked = false;
    lightboxScrollSum = 0;
  }, 180);

  if (lightboxLocked) {
    const newSwipe = size > lightboxLastDelta * 1.6 && size > 15 &&
                     Date.now() - lightboxLastStep > 250;
    lightboxLastDelta = size;
    if (!newSwipe) return;
    lightboxLocked = false;
    lightboxScrollSum = 0;
  }
  lightboxLastDelta = size;

  lightboxScrollSum += delta;
  if (Math.abs(lightboxScrollSum) < SCROLL_THRESHOLD) return;

  showLightbox(lightboxIndex + (lightboxScrollSum > 0 ? 1 : -1));
  lightboxScrollSum = 0;
  lightboxLastStep = Date.now();
  lightboxLocked = true;
}

// 3D-Plakat: Klick auf Vorder- oder Rückseite öffnet das Bild in der Lightbox
function openPosterLightbox(page, index) {
  lightboxImages = page.lightboxList || [];
  lightboxScrub = null;
  lightboxShapes = null;
  lightboxReverse = null;
  lightboxStart = null;
  lightbox.classList.remove('has-touch');
  showLightbox(index);
}

// Klick auf ein Galerie-Bild öffnet die Lightbox
document.addEventListener('click', (e) => {
  if (suppressClick) { suppressClick = false; return; }
  if (inVideoControls(e)) return;                  // Klick in die Steuerleiste → nur steuern
  const img = e.target.closest('.gallery__track img, .gallery__track video, .zoomable');
  if (!img) return;
  lightboxImages = img.closest('.bar__page').lightboxList || [];
  lightboxScrub = img.closest('.bar__page').scrubList || null;
  lightboxShapes = img.closest('.bar__page').shapeList || null;
  lightboxReverse = img.closest('.bar__page').reverseList || null;
  lightboxStart = img.closest('.bar__page').startList || null;
  lightbox.classList.toggle('has-touch', !!lightboxScrub);       // «Touch»-Knopf nur dort
  showLightbox(Number(img.dataset.lightboxIndex));
});

// Grossansicht: Videos mit Startpunkt springen beim Laden und nach dem Loop dorthin
{
  const lbVideo = lightbox.querySelector('.lightbox__video');
  const jump = () => {
    const start = Number(lbVideo.dataset.start) || 0;
    if (start && lbVideo.currentTime < start - 0.3) lbVideo.currentTime = start;
  };
  lbVideo.addEventListener('loadedmetadata', jump);
  lbVideo.addEventListener('timeupdate', jump);
}

lightbox.addEventListener('click', (e) => {
  if (inVideoControls(e)) return;                  // Steuerleiste bedienen, nicht schliessen
  closeLightbox();
});

// ---------- Mauszeiger: invertierter Punkt ----------
const cursorDot = document.createElement('div');
cursorDot.className = 'cursor-dot';
document.body.appendChild(cursorDot);

window.addEventListener('mousemove', (e) => {
  cursorDot.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  cursorDot.classList.add('is-visible');
});
document.documentElement.addEventListener('mouseleave', () => cursorDot.classList.remove('is-visible'));
document.documentElement.addEventListener('mouseenter', () => cursorDot.classList.add('is-visible'));

// ---------- Thumbnail-Videos mit eigenem Startpunkt (data-start in Sekunden) ----------
// Startet an dieser Stelle und springt am Ende wieder dorthin statt an den Anfang.
document.querySelectorAll('video[data-start]').forEach((video) => {
  const start = parseFloat(video.dataset.start) || 0;
  video.addEventListener('loadedmetadata', () => {
    if (video.currentTime < start) video.currentTime = start;
  });
  video.addEventListener('ended', () => {
    video.currentTime = start;
    video.play().catch(() => {});
  });
});

// ---------- Test: Landingpage im Raster (2 Spalten) ----------
// fischerpatrick.ch und die Projekte als Kästchen in 2 Spalten. Liest die Klassen
// (is-active, is-wave, is-open) und setzt daraus die Grössen der Zeilen und
// Spalten – dieselbe Zieharmonika-Logik in 2D. Mindestens 4 Zeilen füllen den
// Bildschirm; bei mehr Projekten wird die Seite länger und scrollbar.
const GRID_COLS = 2;
const GRID_MIN_ROWS = 4;

function updateGrid() {
  if (!accordion.classList.contains('accordion--grid')) return;
  const rootStyle = getComputedStyle(document.documentElement);
  const grow = parseFloat(rootStyle.getPropertyValue('--grow')) || 1;
  const colGrow = parseFloat(rootStyle.getPropertyValue('--grid-col-grow')) || 1;

  const rowCount = Math.max(GRID_MIN_ROWS, Math.ceil(allBars.length / GRID_COLS));
  const rows = new Array(rowCount).fill(1);
  const cols = new Array(GRID_COLS).fill(1);
  const hasOpen = accordion.classList.contains('has-open');
  const open = hasOpen && allBars.find((b) => b.classList.contains('is-open'));

  const intro = accordion.classList.contains('is-intro');
  if (open || intro) {
    // geöffnetes Projekt (bzw. beim Laden fischerpatrick.ch) füllt alles,
    // der Rest klappt auf 0 zusammen
    const i = intro ? 0 : allBars.indexOf(open);
    rows.fill(0);
    cols.fill(0);
    rows[Math.floor(i / GRID_COLS)] = 1;
    cols[i % GRID_COLS] = 1;
  } else {
    allBars.forEach((bar, i) => {
      if (!bar.classList.contains('is-active') && !bar.classList.contains('is-wave')) return;
      const r = Math.floor(i / GRID_COLS);
      const c = i % GRID_COLS;
      rows[r] = Math.max(rows[r], grow);
      cols[c] = Math.max(cols[c], colGrow);
    });
  }

  accordion.style.gridTemplateRows = rows.map((v) => `minmax(0, ${v}fr)`).join(' ');
  accordion.style.gridTemplateColumns = cols.map((v) => `minmax(0, ${v}fr)`).join(' ');

  // Höhe: je Zeile ein Viertel des Bildschirms (mehr Zeilen → Seite scrollt)
  accordion.style.height = hasOpen ? '' : `calc(${rowCount} * 100dvh / ${GRID_MIN_ROWS})`;
  document.documentElement.classList.toggle('can-scroll', !hasOpen);
}

// feste Zellen, damit nichts verrutscht, wenn der Name beim Öffnen frei schwebt
if (accordion.classList.contains('accordion--grid')) {
  allBars.forEach((bar, i) => {
    bar.style.gridRow = String(Math.floor(i / GRID_COLS) + 1);
    bar.style.gridColumn = String((i % GRID_COLS) + 1);
  });
}

new MutationObserver(updateGrid).observe(accordion, {
  attributes: true, attributeFilter: ['class'], subtree: true,
});
updateGrid();
fitTitles();

// ---------- Punkt im Namen: Ausschnitte aus den Projekten ----------
const DOT_IMAGES = Array.from({ length: 15 }, (_, i) =>
  `Media/_dot/${String(i + 1).padStart(2, '0')}.jpg`);
const DOT_SPEED = 160;                       // ms pro Ausschnitt
DOT_IMAGES.forEach((src) => { new Image().src = src; });   // vorladen

function startDot(dot) {
  stopDot(dot);
  let i = Math.floor(Math.random() * DOT_IMAGES.length);
  const show = () => {
    dot.style.backgroundImage = `url("${DOT_IMAGES[i]}")`;
    i = (i + 1) % DOT_IMAGES.length;
  };
  show();
  dot.dotTimer = setInterval(show, DOT_SPEED);
}

function stopDot(dot) {
  clearInterval(dot.dotTimer);
  dot.style.backgroundImage = '';
}

// ---------- Ladebildschirm ----------
// Mindestens LOADER_TIME sichtbar (und bis die Seite geladen ist), dann wird
// weich zur Rasteransicht gewechselt.
const LOADER_TIME = 2600;
const loader = document.querySelector('.loader');
if (loader) {
  const loaderDot = loader.querySelector('.name-dot');
  startDot(loaderDot);
  const minTime = new Promise((r) => setTimeout(r, LOADER_TIME));
  const loaded = new Promise((r) => {
    if (document.readyState === 'complete') r();
    else window.addEventListener('load', r, { once: true });
  });
  // erst schrumpft das grosse Quadrat zum Punkt, dann geht es ins Raster
  Promise.all([minTime, loaded]).then(() => {
    loader.classList.add('is-shrinking');
    stopDot(loaderDot);                           // ab hier nur noch der weisse Punkt
    setTimeout(introToGrid, 650);
  });

  function introToGrid() {
    stopDot(loaderDot);
    if (!accordion.classList.contains('accordion--grid')) {
      loader.classList.add('is-done');            // Balken-Modus: einfach ausblenden
      setTimeout(() => loader.remove(), 800);
      return;
    }
    // 1. ohne Animation: fischerpatrick.ch-Kästchen füllt den Bildschirm, Name gross
    const label = titleBar.querySelector('.bar__label');
    accordion.style.transition = 'none';
    label.style.transition = 'none';
    accordion.classList.add('is-intro');
    updateGrid();
    accordion.offsetHeight;
    loader.remove();                              // sieht identisch aus → kein Sprung

    // 2. wie beim Zurückkehren: Kästchen schrumpft, die anderen Projekte gehen auf
    requestAnimationFrame(() => requestAnimationFrame(() => {
      accordion.style.transition = '';
      label.style.transition = '';
      accordion.classList.remove('is-intro');
      updateGrid();
    }));
  }
}

// Hinweis: Beim Klick auf fischerpatrick.ch im Raster läuft bewusst keine
// Punkt-Animation – die gibt es nur im Ladebildschirm.

// ---------- fischerpatrick.ch-Seite: Reiter About / CV / Contact ----------
// Klick auf einen Reiter zeigt seinen Inhalt; nochmals klicken blendet ihn aus.
const tabButtons = [...titleBar.querySelectorAll('.tab')];

function setTab(name) {
  if (name) titleBar.dataset.tab = name;
  else delete titleBar.dataset.tab;
  tabButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
}

tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setTab(titleBar.dataset.tab === button.dataset.tab ? null : button.dataset.tab);
  });
});

// beim Schliessen der Seite zurücksetzen
new MutationObserver(() => {
  if (!titleBar.classList.contains('is-open') && titleBar.dataset.tab) setTab(null);
}).observe(titleBar, { attributes: true, attributeFilter: ['class'] });
