/**
 * UltraRec - Offscreen Recording & Audio Mixing Engine
 * Executes within Chrome's Offscreen Document context (MV3)
 * Provides DOM, MediaStream, Web Audio API, and MediaRecorder capabilities.
 */

let mediaRecorder = null;
let recordedChunks = [];
let activeStream = null;
let micStream = null;
let audioContext = null;
let currentMimeType = 'video/webm';

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
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Recorder not active' });
        }
        break;

      case 'OFFSCREEN_RESUME':
        if (mediaRecorder && mediaRecorder.state === 'paused') {
          mediaRecorder.resume();
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Recorder not paused' });
        }
        break;

      case 'OFFSCREEN_STOP':
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
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
 * Initiates DisplayMedia stream with high-res constraints and fallback logic
 */
async function startCaptureSession(settings) {
  recordedChunks = [];
  const targetWidth = settings.width || 3840;
  const targetHeight = settings.height || 2160;
  const targetFps = settings.fps || 60;
  const bitrate = settings.bitrate || 40_000_000;

  // Primary video constraints
  const primaryConstraints = {
    video: {
      width: { ideal: targetWidth, max: targetWidth },
      height: { ideal: targetHeight, max: targetHeight },
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
    // If 4K resolution request failed with OverconstrainedError or NotReadableError,
    // fallback gracefully to display native resolution
    if (targetWidth > 1920) {
      try {
        console.warn('UltraRec: Primary 4K constraints rejected. Falling back to native display bounds...');
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
    width: settingsActual.width || targetWidth,
    height: settingsActual.height || targetHeight,
    frameRate: settingsActual.frameRate || targetFps
  };

  // If actual resolution is lower than requested 4K, flag fallback
  if (targetWidth >= 3840 && actualResolution.width < 3840) {
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

      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const destination = audioContext.createMediaStreamDestination();

      // Connect system audio if present
      if (systemAudioTracks.length > 0) {
        const sysSource = audioContext.createMediaStreamSource(new MediaStream([systemAudioTracks[0]]));
        sysSource.connect(destination);
      }

      // Connect mic audio
      const micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(destination);

      mixedAudioTrack = destination.stream.getAudioTracks()[0];
    } catch (micErr) {
      console.warn('Microphone permission or capture failed, continuing with system audio:', micErr);
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
    // Fallback to default MediaRecorder options if bitrate or mime is unsupported
    mediaRecorder = new MediaRecorder(recordingStream);
    currentMimeType = mediaRecorder.mimeType || 'video/webm';
  }

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = async () => {
    cleanupTracks();
    const recordedBlob = new Blob(recordedChunks, { type: currentMimeType });

    // Convert blob to DataURL so background can trigger chrome.downloads
    const reader = new FileReader();
    reader.onloadend = () => {
      chrome.runtime.sendMessage({
        type: 'RECORDING_COMPLETE',
        dataUrl: reader.result,
        mimeType: currentMimeType,
        size: recordedBlob.size
      });
    };
    reader.readAsDataURL(recordedBlob);
  };

  // Start recording in 1-second timeslices for reliability
  mediaRecorder.start(1000);

  return {
    success: true,
    actualResolution: actualResolution,
    wasFallback: wasFallback
  };
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
    'video/mp4',
    'video/webm'
  ];

  for (const c of codecs) {
    if (c && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return '';
}

/**
 * Cleans up media tracks and audio contexts
 */
function cleanupTracks() {
  if (activeStream) {
    activeStream.getTracks().forEach(t => t.stop());
    activeStream = null;
  }
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
    audioContext = null;
  }
}
