# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**rpmrate** is a framework for estimating continuous, time-varying heart rate (BPM) from discrete event timestamps using renewal process theory. The theoretical foundation is documented in `THEORY.md`.

### Core Concept

- **Problem**: Convert sparse, intermittent R-peak detections (event timestamps) into a smooth, continuous BPM curve
- **Solution**: Model inter-event intervals as Gamma-distributed random variables; estimate shape (k) and scale (θ) parameters with temporal smoothing; map parameters to continuous BPM(t)
- **Key Innovation**: Use sliding windows with continuity constraints (regularization or state-space filtering) to handle sparse data, missing detections, and noise

### Two Implementation Routes

1. **Route A (Sliding Window MLE + Regularization)**: Direct, intuitive; optimize k and θ at each timestep with smoothness penalties
2. **Route B (State-Space Filtering)**: More robust; models parameters as hidden states with recursive estimation (Extended Kalman, unscented Kalman, or MAP)

## Development Guidance

### When Starting Implementation

- **Primary language**: Choose based on deployment context (Python for research/real-time; C++/Rust for embedded; Node.js if integrating into web app)
- **Core algorithm**: Implement method from THEORY.md §3 (whichever route chosen)
- **Input interface**: Expect event timestamp sequences or signal + event detection results
- **Output interface**: Continuous BPM(t) at configurable sampling rate (e.g., 10 Hz, 1 Hz)
- **Parameter tuning**: Start with ranges in THEORY.md §6; window length 5–15 sec, smoothing strength tuned to acceptable lag

### Key Implementation Details to Keep

- **Moment estimation** (THEORY.md §4.1): Use sample mean/variance for quick initial parameter values before optimization
- **Outlier handling** (THEORY.md §4.2): Implement percentile clipping or Winsorization before fitting
- **Continuous output** (THEORY.md §5): Decide on output frequency early; use linear interpolation or zero-order hold between updates
- **Smooth parameters**: Consider log-space representation (x=log k, y=log θ) for numerical stability

### Testing & Validation Strategy

- Synthetic data: Generate Gamma-distributed intervals with known parameters; verify recovery
- Edge cases: Sparse windows, missing detections, outliers, abrupt rhythm changes
- Real data: If available, validate against reference BPM measurements and visual inspection of smoothness

## Project Status

Currently **theory-only**. When implementation begins, refer back to THEORY.md for:
- Mathematical formulation (§1–2)
- Algorithm details (§3)
- Initialization tricks and robustness techniques (§4)
- Output and parameter guidance (§5–6)
