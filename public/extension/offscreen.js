/**
 * UltraRec - Offscreen Recording & Audio Mixing Engine (Manifest V3)
 * Executes within Chrome's Offscreen Document context.
 * Features:
 * - Direct Blob URL downloads (No Base64 Data URL truncation / IPC memory crashes)
 * - Automatic EBML duration injection for WebM files (VLC/QuickTime/WMP seekable)
 * - AudioContext auto-resume to prevent audio/video clock desynchronization
 * - Safe track cleanup only after mediaRecorder.onstop has flushed all buffers
 */

let mediaRecorder = null;
let recordedChunks = [];
let activeStream = null;
let micStream = null;
let audioContext = null;
let currentMimeType = 'video/webm';
let sessionStartTime = 0;
let pauseStartTime = 0;
let totalPausedDuration = 0;
let isPaused = false;
let configuredTargetWidth = 3840;
let configuredTargetHeight = 2160;

// Listen for commands forwarded by background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;

  handleOffscreenMessage(message, sendResponse);
  return true; // Keep message channel open for async responses
});

async function handleOffscreenMessage(message, sendResponse) {
  try {
    switch (message.type) {
      case 'OFFSCREEN_START_CAPTURE':
        const startResult = await startCaptureSession(message.settings);
        sendResponse(startResult);
        break;

      case 'OFFSCREEN_PAUSE':
        if (mediaRecorder && mediaRecorder.state === 'recording') {
          mediaRecorder.pause();
          isPaused = true;
          pauseStartTime = Date.now();
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Recorder not active' });
        }
        break;

      case 'OFFSCREEN_RESUME':
        if (mediaRecorder && mediaRecorder.state === 'paused') {
          mediaRecorder.resume();
          if (isPaused) {
            totalPausedDuration += (Date.now() - pauseStartTime);
            isPaused = false;
          }
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Recorder not paused' });
        }
        break;

      case 'OFFSCREEN_STOP':
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
          // Flush pending data before stopping
          try {
            mediaRecorder.requestData();
          } catch (e) {
            // Some states ignore requestData
          }
          mediaRecorder.stop();
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Recorder already stopped' });
        }
        break;

      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Initiates DisplayMedia stream with high-res constraints, audio mixing, and fallback logic
 */
async function startCaptureSession(settings) {
  recordedChunks = [];
  sessionStartTime = Date.now();
  totalPausedDuration = 0;
  isPaused = false;

  configuredTargetWidth = settings.width || 3840;
  configuredTargetHeight = settings.height || 2160;
  const targetFps = settings.fps || 60;
  const bitrate = settings.bitrate || 40_000_000;

  // Primary video constraints
  const primaryConstraints = {
    video: {
      width: { ideal: configuredTargetWidth, max: configuredTargetWidth },
      height: { ideal: configuredTargetHeight, max: configuredTargetHeight },
      frameRate: { ideal: targetFps, max: targetFps }
    },
    audio: settings.systemAudio ? {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    } : false
  };

  let displayStream = null;
  let wasFallback = false;

  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia(primaryConstraints);
  } catch (err) {
    // If 4K resolution request failed with OverconstrainedError,
    // fallback gracefully to display native resolution
    if (configuredTargetWidth > 1920) {
      try {
        console.warn('[UltraRec] 4K constraints rejected by hardware. Falling back to native display bounds...');
        wasFallback = true;
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: targetFps, max: targetFps }
          },
          audio: settings.systemAudio
        });
      } catch (fallbackErr) {
        throw new Error(fallbackErr.message || 'Permission denied or capture aborted.');
      }
    } else {
      throw new Error(err.message || 'Permission denied or capture aborted.');
    }
  }

  activeStream = displayStream;

  // Extract video track and measure actual negotiated dimensions
  const videoTrack = displayStream.getVideoTracks()[0];
  const settingsActual = videoTrack.getSettings ? videoTrack.getSettings() : {};
  const actualResolution = {
    width: settingsActual.width || configuredTargetWidth,
    height: settingsActual.height || configuredTargetHeight,
    frameRate: settingsActual.frameRate || targetFps
  };

  configuredTargetWidth = actualResolution.width;
  configuredTargetHeight = actualResolution.height;

  if (settings.width >= 3840 && actualResolution.width < 3840) {
    wasFallback = true;
  }

  // Handle stream stop by user clicking Chrome's "Stop sharing" bar
  videoTrack.addEventListener('ended', () => {
    chrome.runtime.sendMessage({ type: 'STREAM_ENDED_BY_USER' });
  });

  // Audio Mixing with Web Audio API (if microphone is requested)
  let mixedAudioTrack = null;
  const systemAudioTracks = displayStream.getAudioTracks();

  if (settings.micAudio) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioCtxClass();

      // Crucial: AudioContext must be explicitly resumed in offscreen documents
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const destination = audioContext.createMediaStreamDestination();

      if (systemAudioTracks.length > 0) {
        const sysSource = audioContext.createMediaStreamSource(new MediaStream([systemAudioTracks[0]]));
        sysSource.connect(destination);
      }

      const micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(destination);

      mixedAudioTrack = destination.stream.getAudioTracks()[0];
    } catch (micErr) {
      console.warn('[UltraRec] Microphone access failed, continuing with system audio:', micErr);
    }
  } else if (systemAudioTracks.length > 0) {
    mixedAudioTrack = systemAudioTracks[0];
  }

  // Combine video and audio tracks
  const combinedTracks = [videoTrack];
  if (mixedAudioTrack) {
    combinedTracks.push(mixedAudioTrack);
  }
  const recordingStream = new MediaStream(combinedTracks);

  // Determine best supported codec
  const chosenMimeType = selectSupportedCodec(settings.codec);
  currentMimeType = chosenMimeType;

  // Initialize MediaRecorder
  const recorderOptions = {
    mimeType: chosenMimeType,
    videoBitsPerSecond: bitrate
  };

  try {
    mediaRecorder = new MediaRecorder(recordingStream, recorderOptions);
  } catch (recErr) {
    mediaRecorder = new MediaRecorder(recordingStream);
    currentMimeType = mediaRecorder.mimeType || 'video/webm';
  }

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = async () => {
    await handleMediaRecorderStop();
  };

  // Start recording in 1-second timeslices
  mediaRecorder.start(1000);

  return {
    success: true,
    actualResolution: actualResolution,
    wasFallback: wasFallback
  };
}

/**
 * Handles recorder shutdown, duration injection, and reliable download
 */
async function handleMediaRecorderStop() {
  try {
    // 1. Calculate duration in milliseconds
    const now = Date.now();
    let durationMs = now - sessionStartTime - totalPausedDuration;
    if (isPaused) {
      durationMs -= (now - pauseStartTime);
    }
    if (durationMs < 500) durationMs = 500;

    // 2. Assemble raw blob from flushed chunks
    const rawBlob = new Blob(recordedChunks, { type: currentMimeType });

    // 3. Clean up tracks safely only AFTER chunks are completely assembled
    cleanupTracks();

    // 4. Inject EBML Duration header for WebM files to eliminate corruption
    let finalBlob = rawBlob;
    if (currentMimeType.includes('webm') && typeof window.ysFixWebmDuration === 'function') {
      try {
        finalBlob = await window.ysFixWebmDuration(rawBlob, durationMs);
      } catch (durationErr) {
        console.warn('[UltraRec] Duration injection error, using raw blob:', durationErr);
      }
    }

    // 5. Generate appropriate filename
    const isMp4 = currentMimeType.includes('mp4');
    const ext = isMp4 ? 'mp4' : 'webm';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `UltraRec_${configuredTargetWidth}x${configuredTargetHeight}_${timestamp}.${ext}`;

    // 6. Create Blob URL directly in offscreen document
    const blobUrl = URL.createObjectURL(finalBlob);

    // 7. Initiate download and maintain document alive until download finishes
    if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({
        url: blobUrl,
        filename: filename,
        saveAs: true
      }, (downloadId) => {
        if (chrome.runtime.lastError || !downloadId) {
          // Fallback to DOM anchor click
          triggerDomDownload(blobUrl, filename);
          return;
        }

        // Keep blobUrl alive until Chrome download manager finishes writing to disk
        const onDownloadChanged = (delta) => {
          if (delta.id === downloadId && delta.state) {
            if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
              chrome.downloads.onChanged.removeListener(onDownloadChanged);
              setTimeout(() => {
                URL.revokeObjectURL(blobUrl);
                chrome.runtime.sendMessage({
                  type: 'RECORDING_COMPLETE',
                  success: delta.state.current === 'complete',
                  filename: filename
                });
              }, 1500);
            }
          }
        };
        chrome.downloads.onChanged.addListener(onDownloadChanged);
      });
    } else {
      triggerDomDownload(blobUrl, filename);
    }
  } catch (err) {
    console.error('[UltraRec] Finalization error:', err);
    cleanupTracks();
    chrome.runtime.sendMessage({ type: 'RECORDING_COMPLETE', success: false, error: err.message });
  }
}

function triggerDomDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    chrome.runtime.sendMessage({ type: 'RECORDING_COMPLETE', success: true, filename: filename });
  }, 10000);
}

/**
 * Checks browser codec support and falls back to supported options
 */
function selectSupportedCodec(requestedCodec) {
  const codecs = [
    requestedCodec,
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm'
  ];

  for (const c of codecs) {
    if (c && typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return 'video/webm';
}

/**
 * Cleans up media tracks and audio contexts
 */
function cleanupTracks() {
  if (activeStream) {
    activeStream.getTracks().forEach(t => {
      try { t.stop(); } catch (e) {}
    });
    activeStream = null;
  }
  if (micStream) {
    micStream.getTracks().forEach(t => {
      try { t.stop(); } catch (e) {}
    });
    micStream = null;
  }
  if (audioContext && audioContext.state !== 'closed') {
    try { audioContext.close(); } catch (e) {}
    audioContext = null;
  }
}
