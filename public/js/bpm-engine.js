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
    this.lambda2 = options.lambda2 ?? 1.0; // 2nd-order smoothness penalty

    // Outlier thresholds
    this.minDelta = options.minDelta ?? 0.08;  // seconds (~750 BPM ceiling)
    this.maxDelta = options.maxDelta ?? 5.0;   // seconds (~12 BPM floor)

    // Adaptive k estimation
    this.kEstimationWindow = options.kEstimationWindow ?? 25; // intervals to use for k estimation
    this.kEstimationInterval = options.kEstimationInterval ?? 5; // re-estimate k every N intervals
    this.minKEstimationSamples = 10; // minimum samples before fixing k
    this.fixedK = null; // will be estimated adaptively
    this.kEstimationCounter = 0;

    // Newton solver settings
    this.maxIter = 8;
    this.tolerance = 1e-8;
    this.maxStep = 2.0;

    // State (log-space)
    this.x = 0; // log(k)
    this.y = 0; // log(theta)
    this.xPrev = 0; // x one step back
    this.yPrev = 0; // y one step back
    this.xPrev2 = 0; // x two steps back (for 2nd-order smoothness)
    this.yPrev2 = 0; // y two steps back

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

    // Discard or mark gap for too-long intervals
    if (delta > this.maxDelta) {
      this.pauseGap = true; // next interval won't use this event as previous
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
      // Periodically re-estimate k from long window
      this.kEstimationCounter++;
      if (this.kEstimationCounter >= this.kEstimationInterval) {
        this._estimateK();
        this.kEstimationCounter = 0;
      }

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

  /**
   * Estimate k from a sliding window using robust CV estimation.
   * Sets this.fixedK once enough samples are available.
   */
  _estimateK() {
    const n = this.intervals.length;
    if (n < this.minKEstimationSamples) return;

    // Use last kEstimationWindow intervals
    const windowSize = Math.min(this.kEstimationWindow, n);
    const recentDeltas = this.intervals.slice(-windowSize).map(i => i.delta);

    // Robust CV estimation using median and MAD
    const sorted = [...recentDeltas].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    // MAD (median absolute deviation)
    const absDevs = recentDeltas.map(d => Math.abs(d - median));
    absDevs.sort((a, b) => a - b);
    const mad = absDevs[Math.floor(absDevs.length / 2)];

    // Convert MAD to std estimate: σ ≈ 1.4826 * MAD
    const sigma = 1.4826 * mad;

    // CV = σ / μ
    const cv = sigma / Math.max(median, 0.01);

    // k = 1 / CV²
    let k = 1 / (cv * cv);

    // Clamp to reasonable range
    // Lower bound: k >= 2 (CV <= 70%)
    // Upper bound: k <= 100 (CV >= 10%) - reduced from 200 to avoid theta underflow
    k = Math.max(2, Math.min(100, k));

    this.fixedK = k;
    this.x = Math.log(k);
  }

  _initFromSingleInterval(delta, timeMs) {
    // BPM = 60/delta, set k=1 (exponential) as starting point
    const bpm = 60 / delta;
    this.x = 0;           // log(1) = 0
    this.y = Math.log(delta); // theta = delta when k=1
    this.xPrev = this.x;
    this.yPrev = this.y;
    this.xPrev2 = this.x;
    this.yPrev2 = this.y;
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
    this.xPrev = this.x;
    this.yPrev = this.y;
    this.xPrev2 = this.x;
    this.yPrev2 = this.y;
    this.initialized = true;

    const bpm = 60 / (k * theta);
    this.bpmHistory.push({ time: timeMs, bpm });
  }

  _updateState(delta, timeMs) {
    // Save previous states for 2nd-order smoothness
    this.xPrev2 = this.xPrev;
    this.yPrev2 = this.yPrev;
    this.xPrev = this.x;
    this.yPrev = this.y;

    // Compute adaptive process noise
    const expectedDelta = Math.exp(this.xPrev + this.yPrev); // k * theta
    const innovation = Math.abs(delta - expectedDelta) / Math.max(expectedDelta, 0.01);
    const adaptiveFactor = 1 + 10 * innovation * innovation;

    // Also scale by time ratio (more change budget for longer intervals)
    const timeRatio = Math.max(0.1, Math.min(10, delta / Math.max(expectedDelta, 0.01)));

    const qx = this.qxBase * adaptiveFactor * timeRatio;
    const qy = this.qyBase * adaptiveFactor * timeRatio;

    // Check if k is fixed
    if (this.fixedK !== null) {
      // 1D Newton on y only
      this._updateStateFixedK(delta, timeMs, qy);
    } else {
      // 2D Newton on both x and y
      this._updateState2D(delta, timeMs, qx, qy);
    }

    const bpm = 60 * Math.exp(-(this.x + this.y));
    // Clamp BPM to reasonable range
    const clampedBpm = Math.max(1, Math.min(600, bpm));
    this.bpmHistory.push({ time: timeMs, bpm: clampedBpm });
  }

  _updateStateFixedK(delta, timeMs, qy) {
    // k is fixed, only update y (theta)
    const k = this.fixedK;
    this.x = Math.log(k); // keep x constant

    let y = this.yPrev;

    for (let iter = 0; iter < this.maxIter; iter++) {
      const theta = Math.exp(y);

      // Gradient of L w.r.t. y
      // ℓ_y = δ/θ - k
      // Prior: -1/(2qy) * (y - yPrev)² for 1st order
      // 2nd order: -λ₂ * (y - 2*yPrev + yPrev2)²
      let gy = delta / theta - k - (y - this.yPrev) / qy;

      // Add 2nd-order smoothness gradient
      if (this.intervals.length > 2) {
        const d2y = y - 2 * this.yPrev + this.yPrev2;
        gy -= 2 * this.lambda2 * d2y;
      }

      // Check convergence
      if (Math.abs(gy) < this.tolerance) break;

      // Hessian of L w.r.t. y
      // ℓ_yy = -δ/θ
      let Hyy = -delta / theta - 1 / qy;

      // Add 2nd-order smoothness Hessian
      if (this.intervals.length > 2) {
        Hyy -= 2 * this.lambda2;
      }

      // Newton step: dy = -gy / Hyy
      // For maximization, Hyy should be negative
      if (Hyy >= 0) {
        // Hessian not negative, use gradient ascent
        const stepSize = 0.01;
        y += stepSize * gy;
      } else {
        const dy = -gy / Hyy;
        // Damped step
        const dampedDy = Math.max(-this.maxStep, Math.min(this.maxStep, dy));
        y += dampedDy;
      }

      // Clamp theta to reasonable range based on k
      // For BPM range [20, 600]: μ = k*θ ∈ [0.1, 3]
      // So θ ∈ [0.1/k, 3/k]
      const thetaMin = 0.1 / k;
      const thetaMax = 3.0 / k;
      const thetaNew = Math.exp(y);
      if (thetaNew < thetaMin) y = Math.log(thetaMin);
      if (thetaNew > thetaMax) y = Math.log(thetaMax);
    }

    this.y = y;
  }

  _updateState2D(delta, timeMs, qx, qy) {
    // 2D Newton on both x and y
    let x = this.xPrev;
    let y = this.yPrev;

    for (let iter = 0; iter < this.maxIter; iter++) {
      const k = Math.exp(x);
      const theta = Math.exp(y);
      const psi = digamma(k);
      const psi1 = trigamma(k);
      const logDelta = Math.log(delta);

      // Gradient of L = ell(x,y;delta) - prior
      let gx = k * (logDelta - y - psi) - (x - this.xPrev) / qx;
      let gy = delta / theta - k - (y - this.yPrev) / qy;

      // Add 2nd-order smoothness gradient
      if (this.intervals.length > 2) {
        const d2x = x - 2 * this.xPrev + this.xPrev2;
        const d2y = y - 2 * this.yPrev + this.yPrev2;
        gx -= 2 * this.lambda2 * d2x;
        gy -= 2 * this.lambda2 * d2y;
      }

      // Check convergence
      const gradNorm = Math.sqrt(gx * gx + gy * gy);
      if (gradNorm < this.tolerance) break;

      // Hessian of L
      let Hxx = k * (logDelta - y - psi) - k * k * psi1 - 1 / qx;
      let Hyy = -delta / theta - 1 / qy;
      const Hxy = -k;

      // Add 2nd-order smoothness Hessian
      if (this.intervals.length > 2) {
        Hxx -= 2 * this.lambda2;
        Hyy -= 2 * this.lambda2;
      }

      // Solve 2x2: H * [dx, dy] = -[gx, gy]
      const det = Hxx * Hyy - Hxy * Hxy;

      let dx, dy;
      // For maximization, Hessian should be negative definite:
      // Hxx < 0 and det > 0
      if (det > 0 && Hxx < 0) {
        // Negative definite, use Newton step
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
      // k ∈ [0.5, 100], theta adjusted based on k to keep BPM ∈ [20, 600]
      const kNew = Math.exp(x);
      const thetaNew = Math.exp(y);

      if (kNew < 0.5) x = Math.log(0.5);
      if (kNew > 100) x = Math.log(100);

      // For BPM range [20, 600]: μ = k*θ ∈ [0.1, 3]
      const mu = kNew * thetaNew;
      if (mu < 0.1) {
        // BPM too high, increase theta
        y = Math.log(0.1 / kNew);
      } else if (mu > 3.0) {
        // BPM too low, decrease theta
        y = Math.log(3.0 / kNew);
      }
    }

    this.x = x;
    this.y = y;
  }
}
