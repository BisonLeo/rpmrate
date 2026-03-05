# BPM Engine Improvements - Implementation Summary

## Changes Made

### 1. Fixed Newton Step Condition (Critical Bug Fix)
**Problem**: The original code accepted `det < 0` for the Hessian, which means the Hessian is **indefinite**. This causes Newton steps to jump in the wrong direction and destabilize the filter.

**Fix**: Now only accepts Newton step when:
- `det > 0` AND `Hxx < 0` (negative definite Hessian)
- Otherwise falls back to gradient ascent

**Location**: `_updateState2D()` method, line ~350

### 2. Enforced maxDelta Threshold
**Problem**: `maxDelta` was defined but never used. Long gaps (e.g., user pauses without clicking pause button) would collapse BPM estimates.

**Fix**: In `addEvent()`, intervals longer than `maxDelta` (default 5s) now trigger `pauseGap = true`, preventing them from being used in BPM estimation.

**Location**: `addEvent()` method, line ~70

### 3. Adaptive k Estimation from Sliding Window
**Problem**: Estimating both k and θ online is underconstrained and causes parameter "wobble" even when BPM is stable.

**Solution**:
- Use a sliding window (default 25 intervals) to robustly estimate k using median and MAD (Median Absolute Deviation)
- CV = σ / μ, where σ = 1.4826 × MAD
- k = 1 / CV²
- Re-estimate k every 5 intervals
- Once k is estimated, fix it and only track θ (1D optimization)

**Benefits**:
- Much more stable BPM tracking
- Eliminates k-θ tradeoff that causes jitter
- Robust to outliers via median/MAD

**Location**: `_estimateK()` method, line ~140

### 4. 2nd-Order Smoothness Prior (C² Continuity)
**Problem**: Original random walk prior only enforces 0th-order continuity (no jumps). Derivatives can change abruptly.

**Solution**: Added second-difference penalty:
- Δ²x = x - 2x_{t-1} + x_{t-2}
- Δ²y = y - 2y_{t-1} + y_{t-2}
- Penalty: -λ₂ × (Δ²x² + Δ²y²)

This enforces smooth curvature (minimum acceleration), making the BPM curve visually smoother.

**Parameters**:
- `lambda2`: default 1.0 (adjustable via constructor options)
- Applied to both gradient and Hessian in Newton solver

**Location**: Both `_updateStateFixedK()` and `_updateState2D()` methods

### 5. Separate 1D and 2D Newton Solvers
**Implementation**:
- `_updateStateFixedK()`: 1D Newton on y only when k is fixed (simpler, faster, more stable)
- `_updateState2D()`: Full 2D Newton on both x and y (used during initial estimation phase)

## Configuration Options

```javascript
const engine = new BPMEngine({
  qx: 0.04,                    // Process noise for x (k parameter)
  qy: 0.04,                    // Process noise for y (θ parameter)
  lambda2: 1.0,                // 2nd-order smoothness penalty
  minDelta: 0.08,              // Min interval (seconds) - rejects faster taps
  maxDelta: 5.0,               // Max interval (seconds) - marks gaps
  kEstimationWindow: 25,       // Intervals to use for k estimation
  kEstimationInterval: 5,      // Re-estimate k every N intervals
});
```

## Algorithm Flow

1. **First interval**: Simple BPM = 60/Δ estimate
2. **Second interval**: Moment estimation to initialize k and θ
3. **Intervals 3-10**: 2D Newton optimization (estimate both k and θ)
4. **After 10 intervals**:
   - Estimate k from sliding window (robust CV calculation)
   - Fix k, switch to 1D Newton (only estimate θ)
   - Re-estimate k every 5 intervals to adapt to changing conditions
5. **All updates**: Apply 2nd-order smoothness penalty for C² continuity

## Expected Behavior

- **Startup**: BPM converges within 3-4 taps
- **Steady state**: Smooth, stable BPM tracking with minimal jitter
- **Tempo changes**: Tracks within 1-2 beats (adaptive process noise helps)
- **Visual**: BPM curve is smooth with continuous 2nd derivative
- **Robustness**: Handles outliers via robust k estimation and maxDelta gating

## Typical k Values

Based on CV (coefficient of variation):
- **Manual tapping**: CV ~20-40% → k = 6-25
- **Metronome/clean**: CV ~5-10% → k = 100-400
- **Irregular events**: CV ~40-80% → k = 1.6-6

The adaptive estimation automatically finds the right k for the user's tapping pattern.
