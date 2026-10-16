/**
 * UltraRec - Background Service Worker (Manifest V3)
 * Coordinates recording state, offscreen media document lifecycle, badge indicators,
 * keyboard shortcuts, and file downloads.
 */

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

// In-memory recording state
let recordingState = {
  status: 'idle', // 'idle' | 'recording' | 'paused'
  startTime: 0,
  pauseStartTime: 0,
  totalPausedDuration: 0,
  settings: null,
  actualResolution: null,
  wasFallback: false
};

// Listen for messages from popup or offscreen document
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleIncomingMessage(message, sender, sendResponse);
  return true; // Keep channel open for async response
});

// Keyboard shortcut listener
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-recording') {
    if (recordingState.status === 'idle') {
      // Start recording with default/saved settings
      const saved = await chrome.storage.local.get(['ultrarec_settings']);
      const settings = saved.ultrarec_settings || {
        resolution: '4k',
        width: 3840,
        height: 2160,
        fps: 60,
        bitrate: 40_000_000,
        codec: 'video/webm;codecs=vp9,opus',
        systemAudio: true,
        micAudio: false
      };
      await startRecordingFlow(settings);
    } else {
      await stopRecordingFlow();
    }
  }
});

async function handleIncomingMessage(message, sender, sendResponse) {
  try {
    switch (message.type) {
      case 'GET_RECORDING_STATE':
        sendResponse(recordingState);
        break;

      case 'START_RECORDING':
        const startResult = await startRecordingFlow(message.settings);
        sendResponse(startResult);
        break;

      case 'PAUSE_RECORDING':
        if (recordingState.status === 'recording') {
          await forwardToOffscreen({ type: 'OFFSCREEN_PAUSE' });
          recordingState.status = 'paused';
          recordingState.pauseStartTime = Date.now();
          updateExtensionBadge('PAUSE', '#F59E0B');
          sendResponse({ success: true, state: recordingState });
        } else {
          sendResponse({ success: false, error: 'Not currently recording' });
        }
        break;

      case 'RESUME_RECORDING':
        if (recordingState.status === 'paused') {
          await forwardToOffscreen({ type: 'OFFSCREEN_RESUME' });
          recordingState.totalPausedDuration += (Date.now() - recordingState.pauseStartTime);
          recordingState.status = 'recording';
          recordingState.pauseStartTime = 0;
          updateExtensionBadge('REC', '#EF4444');
          sendResponse({ success: true, state: recordingState });
        } else {
          sendResponse({ success: false, error: 'Recording is not paused' });
        }
        break;

      case 'STOP_RECORDING':
        const stopResult = await stopRecordingFlow();
        sendResponse(stopResult);
        break;

      case 'STREAM_ENDED_BY_USER':
        // User clicked Chrome's native "Stop sharing" bar
        await stopRecordingFlow();
        break;

      case 'RECORDING_COMPLETE':
        // Received recorded video data url from offscreen document
        await handleRecordingDownload(message.dataUrl, message.mimeType);
        resetState();
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ error: 'Unknown message type' });
    }
  } catch (error) {
    console.error('UltraRec Background Error:', error);
    sendResponse({ success: false, error: error.message || 'Operation failed' });
  }
}

async function startRecordingFlow(settings) {
  try {
    await ensureOffscreenDocument();

    // Send start signal to offscreen document
    const response = await chrome.runtime.sendMessage({
      type: 'OFFSCREEN_START_CAPTURE',
      target: 'offscreen',
      settings: settings
    });

    if (response && response.success) {
      recordingState = {
        status: 'recording',
        startTime: Date.now(),
        pauseStartTime: 0,
        totalPausedDuration: 0,
        settings: settings,
        actualResolution: response.actualResolution,
        wasFallback: response.wasFallback || false
      };

      updateExtensionBadge('REC', '#EF4444');
      return { success: true, state: recordingState };
    } else {
      await closeOffscreenDocument();
      return { success: false, error: response?.error || 'Failed to start screen capture' };
    }
  } catch (err) {
    await closeOffscreenDocument();
    return { success: false, error: err.message || 'Failed to initialize capture' };
  }
}

async function stopRecordingFlow() {
  if (recordingState.status === 'idle') {
    return { success: false, error: 'No recording in progress' };
  }

  try {
    updateExtensionBadge('SAVING', '#3B82F6');
    await forwardToOffscreen({ type: 'OFFSCREEN_STOP' });
    return { success: true };
  } catch (err) {
    resetState();
    return { success: false, error: err.message };
  }
}

async function handleRecordingDownload(dataUrl, mimeType) {
  const isMp4 = mimeType && mimeType.includes('mp4');
  const ext = isMp4 ? 'mp4' : 'webm';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `UltraRec_${timestamp}.${ext}`;

  try {
    await chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: true
    });
  } catch (err) {
    console.error('UltraRec Download Error:', err);
  } finally {
    await closeOffscreenDocument();
  }
}

function updateExtensionBadge(text, color) {
  if (!chrome.action) return;
  chrome.action.setBadgeText({ text: text || '' });
  if (color) {
    chrome.action.setBadgeBackgroundColor({ color: color });
  }
}

function resetState() {
  recordingState = {
    status: 'idle',
    startTime: 0,
    pauseStartTime: 0,
    totalPausedDuration: 0,
    settings: null,
    actualResolution: null,
    wasFallback: false
  };
  updateExtensionBadge('', null);
}

// Manage Chrome Offscreen Document Lifecycle
async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [
      chrome.offscreen.Reason.USER_MEDIA || 'USER_MEDIA',
      chrome.offscreen.Reason.DISPLAY_MEDIA || 'DISPLAY_MEDIA'
    ],
    justification: 'High-performance screen recording and Web Audio mixing for UltraRec extension'
  });
}

async function hasOffscreenDocument() {
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    return contexts.length > 0;
  }
  // Fallback check
  return false;
}

async function closeOffscreenDocument() {
  try {
    if (await hasOffscreenDocument()) {
      await chrome.offscreen.closeDocument();
    }
  } catch (e) {
    // Document may have already closed
  }
}

async function forwardToOffscreen(message) {
  return chrome.runtime.sendMessage({
    ...message,
    target: 'offscreen'
  });
}
