import { BPMEngine } from './bpm-engine.js';
import { Renderer } from './renderer.js';
import { InputHandler } from './input.js';

// DOM elements
const canvas = document.getElementById('timeline');
const bpmDisplay = document.getElementById('bpm-display');
const kDisplay = document.getElementById('k-display');
const thetaDisplay = document.getElementById('theta-display');
const tapCount = document.getElementById('tap-count');
const statusText = document.getElementById('status-text');
const pauseBtn = document.getElementById('pause-btn');

// Core instances
const engine = new BPMEngine({ qx: 0.04, qy: 0.04 });
const renderer = new Renderer(canvas, engine);

let paused = false;

function togglePause() {
  paused = !paused;
  renderer.setPaused(paused);
  input.setPaused(paused);

  if (paused) {
    pauseBtn.textContent = '\u25B6'; // play triangle
    pauseBtn.classList.add('paused');
    statusText.textContent = 'Paused \u2014 drag to pan, pinch to zoom';
  } else {
    pauseBtn.innerHTML = '&#9646;&#9646;'; // pause bars
    pauseBtn.classList.remove('paused');
    statusText.textContent = 'Live';
    engine.markGap(); // don't count pause duration as interval
  }
}

const input = new InputHandler(canvas, engine, renderer, togglePause);

// Pause button
pauseBtn.addEventListener('pointerdown', (e) => {
  e.stopPropagation(); // don't register as tap on canvas
});
pauseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePause();
});

// Animation loop
function animate() {
  renderer.render();

  // Update displays
  const state = engine.getState();
  const bpm = state.bpm;

  if (bpm !== null) {
    bpmDisplay.textContent = bpm.toFixed(1);
    kDisplay.textContent = `k: ${state.k.toFixed(2)}`;
    thetaDisplay.textContent = `\u03B8: ${state.theta.toFixed(3)}`;
  }

  const n = state.events.length;
  tapCount.textContent = `${n} tap${n !== 1 ? 's' : ''}`;

  if (n === 0) {
    statusText.textContent = 'Tap anywhere to start';
  } else if (!paused && statusText.textContent === 'Tap anywhere to start') {
    statusText.textContent = 'Live';
  }

  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
