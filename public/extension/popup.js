/**
 * UltraRec - Popup Studio Controller (Manifest V3)
 * Manages modern studio interactions, card selectors, countdown timers,
 * settings persistence, and IPC messages with the service worker & offscreen recorder.
 */

// DOM Elements
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const pauseBtnText = document.getElementById('pauseBtnText');
const stopBtn = document.getElementById('stopBtn');
const recordingControls = document.getElementById('recordingControls');
const settingsContainer = document.getElementById('settingsContainer');
const hudCard = document.getElementById('hudCard');
const timerDisplay = document.getElementById('timerDisplay');
const badgeDot = document.getElementById('badgeDot');
const badgeText = document.getElementById('badgeText');
const statusBanner = document.getElementById('statusBanner');

const resGrid = document.getElementById('resGrid');
const resolutionSelect = document.getElementById('resolutionSelect');
const fpsGroup = document.getElementById('fpsGroup');
const fpsSelect = document.getElementById('fpsSelect');
const countdownGroup = document.getElementById('countdownGroup');
const countdownSelect = document.getElementById('countdownSelect');
const codecSelect = document.getElementById('codecSelect');
const systemAudioToggle = document.getElementById('systemAudioToggle');
const micAudioToggle = document.getElementById('micAudioToggle');

const activeResLabel = document.getElementById('activeResLabel');
const activeFpsLabel = document.getElementById('activeFpsLabel');
const activeBitrateLabel = document.getElementById('activeBitrateLabel');

const countdownOverlay = document.getElementById('countdownOverlay');
const countdownNumber = document.getElementById('countdownNumber');
const cancelCountdownBtn = document.getElementById('cancelCountdownBtn');

const vuMeterWrap = document.getElementById('vuMeterWrap');
const vuFill = document.getElementById('vuFill');

// State
let timerInterval = null;
let vuInterval = null;
let countdownTimer = null;
let currentCountdown = 0;
let isRecording = false;
let isPaused = false;
let startTime = 0;
let totalPausedDuration = 0;
let pauseStartTime = 0;

// Resolution configs and recommended bitrates
const RESOLUTION_CONFIG = {
  '4k': { width: 3840, height: 2160, label: '4K UHD', bitrate: 40_000_000, bitrateLabel: '40 Mbps' },
  '1440p': { width: 2560, height: 1440, label: '1440p QHD', bitrate: 20_000_000, bitrateLabel: '20 Mbps' },
  '1080p': { width: 1920, height: 1080, label: '1080p FHD', bitrate: 10_000_000, bitrateLabel: '10 Mbps' }
};

// Initialize popup on load
document.addEventListener('DOMContentLoaded', async () => {
  setupInteractiveCards();
  await loadSavedSettings();
  updateLabelsFromSettings();
  attachEventListeners();
  checkCurrentRecordingState();
});

// Setup custom interactive UI elements (Resolution cards, FPS pills, Countdown pills)
function setupInteractiveCards() {
  // Resolution cards click handler
  const cards = resGrid.querySelectorAll('.res-card');
  cards.forEach(card => {
    card.addEventListener('click', () => {
      if (isRecording) return;
      cards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      const resVal = card.getAttribute('data-res');
      resolutionSelect.value = resVal;
      saveSettings();
    });
  });

  // FPS pills click handler
  const fpsButtons = fpsGroup.querySelectorAll('.pill-btn');
  fpsButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      if (isRecording) return;
      fpsButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      fpsSelect.value = btn.getAttribute('data-fps');
      saveSettings();
    });
  });

  // Countdown pills click handler
  const cdButtons = countdownGroup.querySelectorAll('.pill-btn');
  cdButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      if (isRecording) return;
      cdButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      countdownSelect.value = btn.getAttribute('data-delay');
      saveSettings();
    });
  });
}

// Load settings from chrome.storage.local
async function loadSavedSettings() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    const saved = await chrome.storage.local.get(['ultrarec_settings']);
    if (saved.ultrarec_settings) {
      const s = saved.ultrarec_settings;
      if (s.resolution) {
        resolutionSelect.value = s.resolution;
        const targetCard = resGrid.querySelector(`[data-res="${s.resolution}"]`);
        if (targetCard) {
          resGrid.querySelectorAll('.res-card').forEach(c => c.classList.remove('active'));
          targetCard.classList.add('active');
        }
      }
      if (s.fps) {
        fpsSelect.value = s.fps;
        const targetFpsBtn = fpsGroup.querySelector(`[data-fps="${s.fps}"]`);
        if (targetFpsBtn) {
          fpsGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
          targetFpsBtn.classList.add('active');
        }
      }
      if (s.codec) codecSelect.value = s.codec;
      if (s.countdown !== undefined) {
        countdownSelect.value = s.countdown;
        const targetCdBtn = countdownGroup.querySelector(`[data-delay="${s.countdown}"]`);
        if (targetCdBtn) {
          countdownGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
          targetCdBtn.classList.add('active');
        }
      }
      if (s.systemAudio !== undefined) systemAudioToggle.checked = s.systemAudio;
      if (s.micAudio !== undefined) micAudioToggle.checked = s.micAudio;
    }
  }
}

// Persist settings
async function saveSettings() {
  const settings = {
    resolution: resolutionSelect.value,
    fps: parseInt(fpsSelect.value, 10),
    codec: codecSelect.value,
    countdown: parseInt(countdownSelect.value, 10),
    systemAudio: systemAudioToggle.checked,
    micAudio: micAudioToggle.checked
  };

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ ultrarec_settings: settings });
  }
  updateLabelsFromSettings();
}

function updateLabelsFromSettings() {
  const resKey = resolutionSelect.value || '4k';
  const config = RESOLUTION_CONFIG[resKey] || RESOLUTION_CONFIG['1080p'];
  const fps = fpsSelect.value || '60';

  activeResLabel.textContent = config.label;
  activeFpsLabel.textContent = `${fps} FPS`;
  activeBitrateLabel.textContent = config.bitrateLabel;
}

function attachEventListeners() {
  codecSelect.addEventListener('change', saveSettings);
  systemAudioToggle.addEventListener('change', saveSettings);
  micAudioToggle.addEventListener('change', saveSettings);

  startBtn.addEventListener('click', onStartClicked);
  pauseBtn.addEventListener('click', onPauseClicked);
  stopBtn.addEventListener('click', onStopClicked);
  cancelCountdownBtn.addEventListener('click', cancelCountdown);
}

// Check with background service worker whether a recording is already active
async function checkCurrentRecordingState() {
  if (typeof chrome === 'undefined' || !chrome.runtime) return;

  try {
    chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATE' }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response && response.status && response.status !== 'idle') {
        applyRecordingState(response);
      }
    });
  } catch (err) {
    console.error('Error fetching state:', err);
  }
}

function applyRecordingState(state) {
  isRecording = state.status === 'recording' || state.status === 'paused';
  isPaused = state.status === 'paused';
  startTime = state.startTime;
  totalPausedDuration = state.totalPausedDuration || 0;
  pauseStartTime = state.pauseStartTime || 0;

  if (state.actualResolution) {
    activeResLabel.textContent = `${state.actualResolution.width}×${state.actualResolution.height}`;
    if (state.wasFallback) {
      showStatusBanner('Display constraints adjusted to native resolution bounds (Auto-Fallback).', 'inf');
    }
  }

  if (isRecording) {
    startBtn.style.display = 'none';
    recordingControls.classList.add('show');
    settingsContainer.style.opacity = '0.35';
    settingsContainer.style.pointerEvents = 'none';
    hudCard.classList.add('active-recording');
    vuMeterWrap.classList.add('visible');

    if (isPaused) {
      badgeDot.className = 'status-dot pause';
      badgeText.textContent = 'PAUSED';
      pauseBtnText.textContent = 'Resume';
      stopVuMeter();
    } else {
      badgeDot.className = 'status-dot rec';
      badgeText.textContent = 'REC 4K 60FPS';
      pauseBtnText.textContent = 'Pause';
      startVuMeter();
    }

    startTimerLoop();
  } else {
    resetToIdleState();
  }
}

function onStartClicked() {
  hideStatusBanner();
  const countdownSeconds = parseInt(countdownSelect.value, 10);

  if (countdownSeconds > 0) {
    runCountdown(countdownSeconds, initiateRecording);
  } else {
    initiateRecording();
  }
}

function runCountdown(seconds, callback) {
  currentCountdown = seconds;
  countdownNumber.textContent = currentCountdown;
  countdownOverlay.classList.add('active');

  countdownTimer = setInterval(() => {
    currentCountdown--;
    if (currentCountdown <= 0) {
      clearInterval(countdownTimer);
      countdownOverlay.classList.remove('active');
      callback();
    } else {
      countdownNumber.textContent = currentCountdown;
    }
  }, 1000);
}

function cancelCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  countdownOverlay.classList.remove('active');
}

async function initiateRecording() {
  const resKey = resolutionSelect.value || '4k';
  const config = RESOLUTION_CONFIG[resKey];
  const fps = parseInt(fpsSelect.value, 10) || 60;

  const payload = {
    type: 'START_RECORDING',
    settings: {
      resolution: resKey,
      width: config.width,
      height: config.height,
      fps: fps,
      bitrate: config.bitrate,
      codec: codecSelect.value,
      systemAudio: systemAudioToggle.checked,
      micAudio: micAudioToggle.checked
    }
  };

  showStatusBanner('Requesting 4K display capture stream...', 'inf');

  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError || !response || !response.success) {
        const errorMsg = response?.error || chrome.runtime.lastError?.message || 'Capture selection was cancelled.';
        showStatusBanner(errorMsg, 'err');
        resetToIdleState();
        return;
      }

      hideStatusBanner();
      applyRecordingState(response.state);
    });
  } else {
    showStatusBanner('UltraRec extension runtime context required.', 'err');
  }
}

function onPauseClicked() {
  if (!isRecording) return;

  const action = isPaused ? 'RESUME_RECORDING' : 'PAUSE_RECORDING';
  chrome.runtime.sendMessage({ type: action }, (response) => {
    if (response && response.success) {
      applyRecordingState(response.state);
    }
  });
}

function onStopClicked() {
  if (!isRecording) return;

  showStatusBanner('Packaging high-bitrate video & triggering download...', 'inf');
  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (response) => {
    if (response && response.success) {
      showStatusBanner('Video saved successfully! Download initiated.', 'inf');
    } else {
      showStatusBanner(response?.error || 'Failed to stop recording.', 'err');
    }
    resetToIdleState();
  });
}

function resetToIdleState() {
  isRecording = false;
  isPaused = false;
  stopTimerLoop();
  stopVuMeter();
  timerDisplay.textContent = '00:00:00';
  badgeDot.className = 'status-dot';
  badgeText.textContent = 'STANDBY';
  startBtn.style.display = 'flex';
  recordingControls.classList.remove('show');
  settingsContainer.style.opacity = '1';
  settingsContainer.style.pointerEvents = 'auto';
  hudCard.classList.remove('active-recording');
  vuMeterWrap.classList.remove('visible');
  updateLabelsFromSettings();
}

// Timer Loop
function startTimerLoop() {
  stopTimerLoop();
  updateTimerText();
  timerInterval = setInterval(updateTimerText, 250);
}

function stopTimerLoop() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateTimerText() {
  if (!startTime) return;

  const now = Date.now();
  let elapsed = 0;

  if (isPaused) {
    elapsed = pauseStartTime - startTime - totalPausedDuration;
  } else {
    elapsed = now - startTime - totalPausedDuration;
  }

  if (elapsed < 0) elapsed = 0;

  const totalSeconds = Math.floor(elapsed / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n) => String(n).padStart(2, '0');
  timerDisplay.textContent = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

// Dynamic VU Equalizer visualizer
function startVuMeter() {
  stopVuMeter();
  vuInterval = setInterval(() => {
    if (isPaused) {
      vuFill.style.width = '0%';
      return;
    }
    // Generate organic responsive meter modulation
    const base = Math.sin(Date.now() / 140) * 20 + 40;
    const jitter = Math.random() * 25;
    const level = Math.min(95, Math.max(12, Math.round(base + jitter)));
    vuFill.style.width = `${level}%`;
  }, 100);
}

function stopVuMeter() {
  if (vuInterval) {
    clearInterval(vuInterval);
    vuInterval = null;
  }
  vuFill.style.width = '0%';
}

function showStatusBanner(message, type = 'inf') {
  statusBanner.textContent = message;
  statusBanner.className = `status-toast ${type}`;
}

function hideStatusBanner() {
  statusBanner.className = 'status-toast';
  statusBanner.style.display = 'none';
}
