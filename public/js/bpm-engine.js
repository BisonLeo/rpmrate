import { logGamma, digamma, trigamma } from './special-fn.js';

/**
 * Real-time BPM estimator using Gamma distribution state-space filtering (Route B).
 *
 * Models inter-event intervals as Gamma(k, θ) with log-parameters x=log(k), y=log(θ)
 * evolving as a random walk. Each new interval triggers a recursive MAP update via
 * Newton's method, giving continuous BPM(t) = 60·exp(-(x+y)).
 */
export class BPMEngine {
  constructor(options = {}) {
    // Process noise (controls smoothness vs responsiveness tradeoff)
    this.qxBase = options.qx ?? 0.04;
    this.qyBase = options.qy ?? 0.04;

    // Outlier thresholds
    this.minDelta = options.minDelta ?? 0.08;  // seconds (~750 BPM ceiling)
    this.maxDelta = options.maxDelta ?? 5.0;   // seconds (~12 BPM floor)

    // Newton solver settings
    this.maxIter = 8;
    this.tolerance = 1e-8;
    this.maxStep = 2.0;

    // State (log-space)
    this.x = 0; // log(k)
    this.y = 0; // log(theta)

    // Data storage
    this.events = [];       // [{time: ms}]
    this.intervals = [];    // [{time: ms, delta: seconds}]
    this.bpmHistory = [];   // [{time: ms, bpm: number}]

    this.initialized = false;
    this.pauseGap = false; // flag: next event should not form interval with previous
  }

  /**
   * Mark that the next event should not form an interval with the previous one
   * (e.g., after pause/resume).
   */
  markGap() {
    this.pauseGap = true;
  }

  /**
   * Register a tap/click event. Returns current BPM estimate or null.
   * @param {number} timeMs - timestamp in milliseconds (Date.now())
   */
  addEvent(timeMs) {
    const event = { time: timeMs };
    this.events.push(event);

    // Need at least 2 events to form an interval
    if (this.events.length < 2 || this.pauseGap) {
      this.pauseGap = false;
      return this.getBPM();
    }

    const prevEvent = this.events[this.events.length - 2];
    const delta = (timeMs - prevEvent.time) / 1000; // seconds

    // Discard too-fast taps (accidental)
    if (delta < this.minDelta) {
      this.events.pop(); // remove this event
      return this.getBPM();
    }

    this.intervals.push({ time: timeMs, delta });

    if (this.intervals.length === 1) {
      // First interval: simple estimate
      this._initFromSingleInterval(delta, timeMs);
    } else if (this.intervals.length === 2) {
      // Two intervals: moment estimation to initialize Gamma params
      this._initFromMoments(timeMs);
    } else {
      // Run state-space update
      this._updateState(delta, timeMs);
    }

    return this.getBPM();
  }

  /**
   * Get current BPM estimate.
   */
  getBPM() {
    if (this.bpmHistory.length === 0) return null;
    return this.bpmHistory[this.bpmHistory.length - 1].bpm;
  }

  /**
   * Get full state for renderer.
   */
  getState() {
    return {
      x: this.x,
      y: this.y,
      k: Math.exp(this.x),
      theta: Math.exp(this.y),
      bpm: this.getBPM(),
      events: this.events,
      intervals: this.intervals,
      bpmHistory: this.bpmHistory,
    };
  }

  // --- Private methods ---

  _initFromSingleInterval(delta, timeMs) {
    // BPM = 60/delta, set k=1 (exponential) as starting point
    const bpm = 60 / delta;
    this.x = 0;           // log(1) = 0
    this.y = Math.log(delta); // theta = delta when k=1
    this.initialized = true;
    this.bpmHistory.push({ time: timeMs, bpm });
  }

  _initFromMoments(timeMs) {
    // Moment estimation: k = mean²/var, theta = var/mean
    const deltas = this.intervals.map(i => i.delta);
    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    let variance = 0;
    for (const d of deltas) variance += (d - mean) * (d - mean);
    variance /= deltas.length;

    let k, theta;
    if (variance < 1e-10 || variance / (mean * mean) < 0.001) {
      // Very low variance: use high k (peaked distribution)
      k = 100;
      theta = mean / k;
    } else {
      k = (mean * mean) / variance;
      theta = variance / mean;
    }

    // Clamp
    k = Math.max(0.1, Math.min(100, k));
    theta = Math.max(0.01, Math.min(10, theta));

    this.x = Math.log(k);
    this.y = Math.log(theta);
    this.initialized = true;

    const bpm = 60 / (k * theta);
    this.bpmHistory.push({ time: timeMs, bpm });
  }

  _updateState(delta, timeMs) {
    const xPrev = this.x;
    const yPrev = this.y;

    // Compute adaptive process noise
    const expectedDelta = Math.exp(xPrev + yPrev); // k * theta
    const innovation = Math.abs(delta - expectedDelta) / Math.max(expectedDelta, 0.01);
    const adaptiveFactor = 1 + 10 * innovation * innovation;

    // Also scale by time ratio (more change budget for longer intervals)
    const timeRatio = Math.max(0.1, Math.min(10, delta / Math.max(expectedDelta, 0.01)));

    const qx = this.qxBase * adaptiveFactor * timeRatio;
    const qy = this.qyBase * adaptiveFactor * timeRatio;

    // Newton's method to solve recursive MAP
    let x = xPrev;
    let y = yPrev;

    for (let iter = 0; iter < this.maxIter; iter++) {
      const k = Math.exp(x);
      const theta = Math.exp(y);
      const psi = digamma(k);
      const psi1 = trigamma(k);
      const logDelta = Math.log(delta);

      // Gradient of L = ell(x,y;delta) - prior
      const gx = k * (logDelta - y - psi) - (x - xPrev) / qx;
      const gy = delta / theta - k - (y - yPrev) / qy;

      // Check convergence
      const gradNorm = Math.sqrt(gx * gx + gy * gy);
      if (gradNorm < this.tolerance) break;

      // Hessian of L
      const Hxx = k * (logDelta - y - psi) - k * k * psi1 - 1 / qx;
      const Hyy = -delta / theta - 1 / qy;
      const Hxy = -k;

      // Solve 2x2: H * [dx, dy] = -[gx, gy]
      const det = Hxx * Hyy - Hxy * Hxy;

      let dx, dy;
      if (Math.abs(det) > 1e-20 && det < 0) {
        // Hessian is negative definite (det of negative-definite 2x2 > 0, but det itself < 0 since Hxx < 0)
        // Actually for neg-def: Hxx < 0 and det > 0. Let me fix:
        // We need -H positive definite. -Hxx > 0 and (-Hxx)(-Hyy) - (-Hxy)^2 > 0 => det > 0
        // So det > 0 means H is negative definite.
        dx = -(Hyy * gx - Hxy * gy) / det;
        dy = -(Hxx * gy - Hxy * gx) / det;
      } else if (Math.abs(det) > 1e-20 && det > 0 && Hxx < 0) {
        // Negative definite case
        dx = -(Hyy * gx - Hxy * gy) / det;
        dy = -(Hxx * gy - Hxy * gx) / det;
      } else {
        // Hessian not negative definite, use gradient ascent
        const stepSize = 0.01;
        dx = stepSize * gx;
        dy = stepSize * gy;
      }

      // Damped Newton: limit step size
      const stepNorm = Math.sqrt(dx * dx + dy * dy);
      if (stepNorm > this.maxStep) {
        const scale = this.maxStep / stepNorm;
        dx *= scale;
        dy *= scale;
      }

      x += dx;
      y += dy;

      // Clamp parameters to reasonable range
      const kNew = Math.exp(x);
      const thetaNew = Math.exp(y);
      if (kNew < 0.1) x = Math.log(0.1);
      if (kNew > 100) x = Math.log(100);
      if (thetaNew < 0.005) y = Math.log(0.005);
      if (thetaNew > 10) y = Math.log(10);
    }

    this.x = x;
    this.y = y;

    const bpm = 60 * Math.exp(-(x + y));
    // Clamp BPM to reasonable range
    const clampedBpm = Math.max(1, Math.min(600, bpm));
    this.bpmHistory.push({ time: timeMs, bpm: clampedBpm });
  }
}
