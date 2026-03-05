/**
 * Canvas timeline renderer for BPM visualization.
 * Draws time axis, event bars, BPM curve, and playhead.
 */
export class Renderer {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = engine;

    // View state
    this.visibleDurationMs = 10000; // 10 seconds default view
    this.minDurationMs = 1000;      // 1 second minimum zoom
    this.maxDurationMs = 300000;    // 5 minutes maximum zoom

    // Playhead at 80% from left in live mode
    this.playheadFraction = 0.8;
    this.wrapFraction = 0.2; // wrap target when resuming

    // View offset (ms) - 0 in live mode, negative to look at past
    this.viewOffset = 0;

    this.paused = false;
    this.pauseTime = 0;

    // Layout constants
    this.timeAxisHeight = 28;
    this.bpmAxisWidth = 0; // no left axis, keep it clean
    this.chartPadTop = 10;

    // BPM range (auto-adjusts)
    this.bpmMin = 40;
    this.bpmMax = 200;

    // Colors (read from CSS vars or hardcode)
    this.colors = {
      bg: '#0f0f1a',
      grid: 'rgba(255, 255, 255, 0.06)',
      tick: 'rgba(255, 255, 255, 0.15)',
      tickLabel: 'rgba(255, 255, 255, 0.4)',
      event: 'rgba(100, 149, 237, 0.65)',
      eventHighlight: 'rgba(100, 149, 237, 0.9)',
      curve: '#ff6b35',
      curveWidth: 2.5,
      playhead: '#00e5ff',
      playheadGlow: 'rgba(0, 229, 255, 0.2)',
      bpmRef: 'rgba(255, 255, 255, 0.04)',
      bpmLabel: 'rgba(255, 255, 255, 0.2)',
    };

    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(canvas);
    this._resize();
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Get CSS pixel dimensions */
  get chartLeft() { return this.bpmAxisWidth; }
  get chartRight() { return this.width; }
  get chartTop() { return this.chartPadTop; }
  get chartBottom() { return this.height - this.timeAxisHeight; }
  get chartWidth() { return this.chartRight - this.chartLeft; }
  get chartHeight() { return this.chartBottom - this.chartTop; }

  /** Convert time (ms) to x pixel */
  timeToX(timeMs) {
    const { startTime } = this._viewRange();
    return this.chartLeft + ((timeMs - startTime) / this.visibleDurationMs) * this.chartWidth;
  }

  /** Convert x pixel to time (ms) */
  xToTime(x) {
    const { startTime } = this._viewRange();
    return startTime + ((x - this.chartLeft) / this.chartWidth) * this.visibleDurationMs;
  }

  /** Convert BPM to y pixel */
  bpmToY(bpm) {
    const range = this.bpmMax - this.bpmMin;
    const frac = (bpm - this.bpmMin) / range;
    return this.chartBottom - frac * this.chartHeight;
  }

  /** Get the visible time range */
  _viewRange() {
    let anchorTime;
    if (this.paused) {
      anchorTime = this.pauseTime;
    } else {
      anchorTime = Date.now();
    }

    const anchorX = this.playheadFraction;
    const startTime = anchorTime - anchorX * this.visibleDurationMs + this.viewOffset;
    const endTime = startTime + this.visibleDurationMs;
    return { startTime, endTime, anchorTime };
  }

  /** Pan by pixel delta */
  pan(dxPixels) {
    const msPerPixel = this.visibleDurationMs / this.chartWidth;
    this.viewOffset -= dxPixels * msPerPixel;
  }

  /** Zoom centered on a screen x coordinate */
  zoom(factor, centerX) {
    const centerTime = this.xToTime(centerX);
    const newDuration = Math.max(this.minDurationMs,
      Math.min(this.maxDurationMs, this.visibleDurationMs * factor));

    // Adjust offset so centerTime stays at the same screen position
    const frac = (centerX - this.chartLeft) / this.chartWidth;
    const newStartTime = centerTime - frac * newDuration;
    const oldStartTime = this._viewRange().startTime;

    this.viewOffset += (oldStartTime - newStartTime) + (this.visibleDurationMs - newDuration) * this.playheadFraction;
    // Simpler: just recalculate offset
    const anchorTime = this.paused ? this.pauseTime : Date.now();
    this.viewOffset = (newStartTime + frac * newDuration - anchorTime) + (1 - this.playheadFraction) * newDuration - (1 - frac) * newDuration;
    // Let me simplify: startTime = anchorTime - playheadFraction * duration + offset
    // We want newStart = centerTime - frac * newDuration
    // So offset = newStart - anchorTime + playheadFraction * newDuration
    this.viewOffset = (centerTime - frac * newDuration) - anchorTime + this.playheadFraction * newDuration;

    this.visibleDurationMs = newDuration;
  }

  /** Set pause state */
  setPaused(paused) {
    if (paused && !this.paused) {
      this.paused = true;
      this.pauseTime = Date.now();
    } else if (!paused && this.paused) {
      this.paused = false;
      // Snap playhead to 20% so user sees current time with room to the right
      this.playheadFraction = this.wrapFraction;
      this.viewOffset = 0;
      // Gradually return to 80% (handled in render)
    }
  }

  /** Auto-adjust BPM range based on history */
  _updateBpmRange() {
    const history = this.engine.getState().bpmHistory;
    if (history.length === 0) return;

    let min = Infinity, max = -Infinity;
    for (const h of history) {
      if (h.bpm < min) min = h.bpm;
      if (h.bpm > max) max = h.bpm;
    }

    // Add 20% padding
    const range = max - min || 20;
    const padded = range * 0.2;
    this.bpmMin = Math.max(0, Math.floor((min - padded) / 10) * 10);
    this.bpmMax = Math.ceil((max + padded) / 10) * 10;

    // Minimum range of 40 BPM
    if (this.bpmMax - this.bpmMin < 40) {
      const mid = (this.bpmMin + this.bpmMax) / 2;
      this.bpmMin = mid - 20;
      this.bpmMax = mid + 20;
    }
  }

  /** Main render call */
  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // In live mode, gradually return playhead to 80%
    if (!this.paused && this.playheadFraction < 0.8) {
      this.playheadFraction += 0.005;
      if (this.playheadFraction > 0.8) this.playheadFraction = 0.8;
    }

    this._updateBpmRange();

    const { startTime, endTime, anchorTime } = this._viewRange();

    this._drawBpmRefLines(ctx);
    this._drawTimeAxis(ctx, startTime, endTime);
    this._drawEventBars(ctx, startTime, endTime);
    this._drawBpmCurve(ctx, startTime, endTime);
    this._drawPlayhead(ctx, anchorTime);
  }

  _drawBpmRefLines(ctx) {
    // Draw horizontal reference lines for BPM values
    const step = this._niceStep(this.bpmMax - this.bpmMin, 5);
    const start = Math.ceil(this.bpmMin / step) * step;

    ctx.font = '10px -apple-system, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';

    for (let bpm = start; bpm <= this.bpmMax; bpm += step) {
      const y = this.bpmToY(bpm);
      if (y < this.chartTop || y > this.chartBottom) continue;

      ctx.strokeStyle = this.colors.bpmRef;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(this.chartLeft, y);
      ctx.lineTo(this.chartRight, y);
      ctx.stroke();

      ctx.fillStyle = this.colors.bpmLabel;
      ctx.fillText(bpm.toString(), this.chartRight - 4, y);
    }
  }

  _drawTimeAxis(ctx, startTime, endTime) {
    const y = this.chartBottom;
    const duration = endTime - startTime;

    // Draw axis line
    ctx.strokeStyle = this.colors.tick;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.chartLeft, y);
    ctx.lineTo(this.chartRight, y);
    ctx.stroke();

    // Choose tick interval
    const targetTicks = 6;
    const msPerTick = this._niceTimeStep(duration / targetTicks);

    // Align ticks to round times
    const firstTick = Math.ceil(startTime / msPerTick) * msPerTick;

    ctx.font = '10px -apple-system, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    ctx.fillStyle = this.colors.tickLabel;

    for (let t = firstTick; t <= endTime; t += msPerTick) {
      const x = this.timeToX(t);
      if (x < this.chartLeft || x > this.chartRight) continue;

      // Tick mark
      ctx.strokeStyle = this.colors.tick;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 5);
      ctx.stroke();

      // Label
      const label = this._formatTime(t, msPerTick);
      ctx.fillText(label, x, y + 7);
    }
  }

  _drawEventBars(ctx, startTime, endTime) {
    const events = this.engine.getState().events;
    // Binary search for first visible event
    let lo = 0, hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (events[mid].time < startTime) lo = mid + 1;
      else hi = mid;
    }

    ctx.lineWidth = 1.5;

    for (let i = lo; i < events.length; i++) {
      const e = events[i];
      if (e.time > endTime) break;

      const x = this.timeToX(e.time);
      ctx.strokeStyle = this.colors.event;
      ctx.beginPath();
      ctx.moveTo(x, this.chartTop);
      ctx.lineTo(x, this.chartBottom);
      ctx.stroke();

      // Small dot at top
      ctx.fillStyle = this.colors.eventHighlight;
      ctx.beginPath();
      ctx.arc(x, this.chartTop + 4, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawBpmCurve(ctx, startTime, endTime) {
    const history = this.engine.getState().bpmHistory;
    if (history.length === 0) return;

    // Binary search for first visible entry
    let lo = 0, hi = history.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (history[mid].time < startTime) lo = mid + 1;
      else hi = mid;
    }
    // Include two before visible range for spline continuity
    if (lo > 1) lo -= 2;
    else if (lo > 0) lo -= 1;

    ctx.strokeStyle = this.colors.curve;
    ctx.lineWidth = this.colors.curveWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();

    if (history.length === 1) {
      // Single point: just draw a horizontal line
      const x = this.timeToX(history[0].time);
      const y = this.bpmToY(history[0].bpm);
      const clampedY = Math.max(this.chartTop, Math.min(this.chartBottom, y));
      ctx.moveTo(x, clampedY);
      const extendTo = Math.min(this.timeToX(Date.now()), this.chartRight);
      ctx.lineTo(extendTo, clampedY);
    } else if (history.length === 2) {
      // Two points: linear interpolation
      const x0 = this.timeToX(history[0].time);
      const y0 = this.bpmToY(history[0].bpm);
      const x1 = this.timeToX(history[1].time);
      const y1 = this.bpmToY(history[1].bpm);
      ctx.moveTo(x0, Math.max(this.chartTop, Math.min(this.chartBottom, y0)));
      ctx.lineTo(x1, Math.max(this.chartTop, Math.min(this.chartBottom, y1)));
      // Extend to current time
      const extendTo = Math.min(this.timeToX(Date.now()), this.chartRight);
      ctx.lineTo(extendTo, Math.max(this.chartTop, Math.min(this.chartBottom, y1)));
    } else {
      // Three or more points: use Catmull-Rom spline for smooth C¹ continuity
      this._drawCatmullRomSpline(ctx, history, lo, startTime, endTime);
    }

    ctx.stroke();

    // Draw glow effect (thick, transparent underneath)
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.strokeStyle = 'rgba(255, 107, 53, 0.15)';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw a smooth Catmull-Rom spline through BPM history points.
   * This provides C¹ continuity (continuous first derivative) which better
   * represents the smooth Gamma parameter dynamics with 2nd-order prior.
   */
  _drawCatmullRomSpline(ctx, history, startIdx, startTime, endTime) {
    const tension = 0.5; // 0.5 = standard Catmull-Rom, 0 = linear, 1 = tight curves
    const segments = 20; // subdivisions per interval for smooth curves

    let started = false;

    for (let i = Math.max(0, startIdx); i < history.length - 1; i++) {
      // Get four control points: P0, P1, P2, P3
      // We draw the curve segment from P1 to P2
      const p0 = i > 0 ? history[i - 1] : history[i]; // duplicate first point if at start
      const p1 = history[i];
      const p2 = history[i + 1];
      const p3 = i < history.length - 2 ? history[i + 2] : history[i + 1]; // duplicate last point if at end

      // Convert to screen coordinates
      const x0 = this.timeToX(p0.time);
      const y0 = this.bpmToY(p0.bpm);
      const x1 = this.timeToX(p1.time);
      const y1 = this.bpmToY(p1.bpm);
      const x2 = this.timeToX(p2.time);
      const y2 = this.bpmToY(p2.bpm);
      const x3 = this.timeToX(p3.time);
      const y3 = this.bpmToY(p3.bpm);

      // Skip if segment is entirely outside view
      if (x2 < this.chartLeft && x1 < this.chartLeft) continue;
      if (x1 > this.chartRight) break;

      // Start path at first point
      if (!started) {
        ctx.moveTo(x1, Math.max(this.chartTop, Math.min(this.chartBottom, y1)));
        started = true;
      }

      // Draw Catmull-Rom curve from P1 to P2
      for (let s = 1; s <= segments; s++) {
        const t = s / segments;
        const t2 = t * t;
        const t3 = t2 * t;

        // Catmull-Rom basis functions
        const b0 = -tension * t3 + 2 * tension * t2 - tension * t;
        const b1 = (2 - tension) * t3 + (tension - 3) * t2 + 1;
        const b2 = (tension - 2) * t3 + (3 - 2 * tension) * t2 + tension * t;
        const b3 = tension * t3 - tension * t2;

        const x = b0 * x0 + b1 * x1 + b2 * x2 + b3 * x3;
        const y = b0 * y0 + b1 * y1 + b2 * y2 + b3 * y3;

        const clampedY = Math.max(this.chartTop, Math.min(this.chartBottom, y));
        ctx.lineTo(x, clampedY);
      }
    }

    // Extend to current time with last BPM value
    if (history.length > 0) {
      const lastH = history[history.length - 1];
      const lastX = this.timeToX(lastH.time);
      const lastY = this.bpmToY(lastH.bpm);
      const clampedY = Math.max(this.chartTop, Math.min(this.chartBottom, lastY));

      const currentTime = this.paused ? this.pauseTime : Date.now();
      const extendTo = Math.min(this.timeToX(currentTime), this.chartRight);

      if (extendTo > lastX) {
        ctx.lineTo(extendTo, clampedY);
      }
    }
  }

  _drawPlayhead(ctx, anchorTime) {
    const x = this.timeToX(anchorTime);
    if (x < this.chartLeft || x > this.chartRight) return;

    // Glow
    ctx.strokeStyle = this.colors.playheadGlow;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x, this.chartTop);
    ctx.lineTo(x, this.chartBottom);
    ctx.stroke();

    // Line
    ctx.strokeStyle = this.colors.playhead;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, this.chartTop);
    ctx.lineTo(x, this.chartBottom);
    ctx.stroke();

    // Triangle at top
    ctx.fillStyle = this.colors.playhead;
    ctx.beginPath();
    ctx.moveTo(x, this.chartTop);
    ctx.lineTo(x - 5, this.chartTop - 6);
    ctx.lineTo(x + 5, this.chartTop - 6);
    ctx.closePath();
    ctx.fill();
  }

  /** Choose a nice step size for a range */
  _niceStep(range, targetSteps) {
    const rough = range / targetSteps;
    const pow = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / pow;
    let nice;
    if (norm < 1.5) nice = 1;
    else if (norm < 3.5) nice = 2;
    else if (norm < 7.5) nice = 5;
    else nice = 10;
    return nice * pow;
  }

  /** Choose a nice time step (ms) */
  _niceTimeStep(roughMs) {
    const steps = [100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000];
    for (const s of steps) {
      if (s >= roughMs * 0.7) return s;
    }
    return 300000;
  }

  /** Format a time for the axis label */
  _formatTime(timeMs, stepMs) {
    const d = new Date(timeMs);
    if (stepMs < 1000) {
      // Show seconds.tenths
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        + '.' + Math.floor(d.getMilliseconds() / 100);
    } else if (stepMs < 60000) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } else {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }
}
