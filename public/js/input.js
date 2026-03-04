/**
 * Input handler for touch/mouse gestures.
 * - Single tap/click: immediate impulse event (no double-tap detection)
 * - Pan (1 finger drag when paused): scroll timeline
 * - Pinch (2 fingers when paused): zoom timeline
 * - Mouse wheel (when paused): zoom timeline
 * - Pause/resume: via UI button only
 */
export class InputHandler {
  constructor(canvas, engine, renderer, onPauseToggle) {
    this.canvas = canvas;
    this.engine = engine;
    this.renderer = renderer;
    this.onPauseToggle = onPauseToggle;

    this.paused = false;

    // Touch tracking
    this._touches = new Map(); // id -> {startX, startY, startTime, lastX, lastY}
    this._isPanning = false;
    this._isPinching = false;
    this._pinchStartDist = 0;
    this._pinchStartDuration = 0;
    this._pinchCenterX = 0;
    this._moved = false;

    // Bind events
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onWheel = this._onWheel.bind(this);

    canvas.addEventListener('pointerdown', this._onPointerDown);
    canvas.addEventListener('pointermove', this._onPointerMove);
    canvas.addEventListener('pointerup', this._onPointerUp);
    canvas.addEventListener('pointercancel', this._onPointerUp);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });

    // Prevent context menu on long press
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  setPaused(paused) {
    this.paused = paused;
  }

  _onPointerDown(e) {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);

    this._touches.set(e.pointerId, {
      startX: e.clientX,
      startY: e.clientY,
      startTime: performance.now(),
      lastX: e.clientX,
      lastY: e.clientY,
    });
    this._moved = false;

    if (this._touches.size === 2 && this.paused) {
      // Start pinch
      this._isPinching = true;
      this._isPanning = false;
      const pts = [...this._touches.values()];
      this._pinchStartDist = this._dist(pts[0], pts[1]);
      this._pinchStartDuration = this.renderer.visibleDurationMs;
      this._pinchCenterX = (pts[0].lastX + pts[1].lastX) / 2;
    }
  }

  _onPointerMove(e) {
    const touch = this._touches.get(e.pointerId);
    if (!touch) return;

    const dx = e.clientX - touch.lastX;
    const totalDx = e.clientX - touch.startX;
    const totalDy = e.clientY - touch.startY;

    // Detect if this is a move (not a tap)
    if (Math.abs(totalDx) > 8 || Math.abs(totalDy) > 8) {
      this._moved = true;
    }

    touch.lastX = e.clientX;
    touch.lastY = e.clientY;

    if (this._isPinching && this._touches.size === 2 && this.paused) {
      const pts = [...this._touches.values()];
      const currentDist = this._dist(pts[0], pts[1]);
      const scale = this._pinchStartDist / Math.max(currentDist, 1);
      const newDuration = this._pinchStartDuration * scale;
      const centerX = (pts[0].lastX + pts[1].lastX) / 2;

      this.renderer.zoom(newDuration / this.renderer.visibleDurationMs, centerX);
    } else if (this._touches.size === 1 && this.paused && this._moved) {
      // Pan
      this._isPanning = true;
      this.renderer.pan(dx);
    }
  }

  _onPointerUp(e) {
    const touch = this._touches.get(e.pointerId);
    this._touches.delete(e.pointerId);

    if (!touch) return;

    // If it was a tap (not a pan/pinch) and we're not paused, register event
    if (!this._moved && !this._isPanning && !this._isPinching) {
      if (!this.paused) {
        this.engine.addEvent(Date.now());
      }
    }

    if (this._touches.size === 0) {
      this._isPanning = false;
      this._isPinching = false;
    }
  }

  _onWheel(e) {
    if (!this.paused) return;
    e.preventDefault();

    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    this.renderer.zoom(factor, e.clientX);
  }

  _dist(a, b) {
    const dx = a.lastX - b.lastX;
    const dy = a.lastY - b.lastY;
    return Math.sqrt(dx * dx + dy * dy);
  }
}
