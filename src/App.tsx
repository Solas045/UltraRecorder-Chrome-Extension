/**
 * UltraRec - 4K 60FPS Chrome Screen Recorder
 * Web Simulator, In-Browser 4K Recording Studio, Code Inspector & Extension Packager.
 */

import React, { useState, useEffect, useRef } from 'react';
import JSZip from 'jszip';
// @ts-ignore
import fixWebmDuration from 'fix-webm-duration';
import {
  Monitor,
  Video,
  Mic,
  Volume2,
  Play,
  Pause,
  Square,
  Download,
  Copy,
  Check,
  FolderArchive,
  FileCode,
  ShieldCheck,
  Cpu,
  Eye,
  Sliders,
  Sparkles
} from 'lucide-react';

// Extension file registry
const EXTENSION_FILE_LIST = [
  { name: 'popup.html', path: 'popup.html', label: 'popup.html (UI)', lang: 'html' },
  { name: 'popup.js', path: 'popup.js', label: 'popup.js (Logic)', lang: 'javascript' },
  { name: 'manifest.json', path: 'manifest.json', label: 'manifest.json', lang: 'json' },
  { name: 'background.js', path: 'background.js', label: 'background.js (SW)', lang: 'javascript' },
  { name: 'offscreen.html', path: 'offscreen.html', label: 'offscreen.html', lang: 'html' },
  { name: 'offscreen.js', path: 'offscreen.js', label: 'offscreen.js (Engine)', lang: 'javascript' },
  { name: 'fix-webm-duration.js', path: 'fix-webm-duration.js', label: 'fix-webm-duration.js', lang: 'javascript' },
  { name: 'README.md', path: 'README.md', label: 'README.md', lang: 'markdown' }
];

interface RecordedVideo {
  id: string;
  url: string;
  filename: string;
  resolution: string;
  fps: number;
  duration: number;
  sizeBytes: number;
  timestamp: string;
}

export default function App() {
  // Navigation tabs: 'simulator' | 'code' | 'capabilities' | 'install'
  const [activeTab, setActiveTab] = useState<'simulator' | 'code' | 'capabilities' | 'install'>('simulator');
  const [selectedFileName, setSelectedFileName] = useState<string>('popup.html');
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [isExportingZip, setIsExportingZip] = useState(false);

  // In-Browser Screen Recorder State (Studio options)
  const [resolution, setResolution] = useState<'4k' | '1440p' | '1080p'>('4k');
  const [fps, setFps] = useState<number>(60);
  const [codec, setCodec] = useState<string>('video/webm;codecs=vp9,opus');
  const [countdownSetting, setCountdownSetting] = useState<number>(3);
  const [includeSystemAudio, setIncludeSystemAudio] = useState<boolean>(true);
  const [includeMicAudio, setIncludeMicAudio] = useState<boolean>(false);

  // Active recording execution state
  const [recordingStatus, setRecordingStatus] = useState<'idle' | 'countdown' | 'recording' | 'paused'>('idle');
  const [countdownValue, setCountdownValue] = useState<number>(3);
  const [recordingDuration, setRecordingDuration] = useState<number>(0);
  const [activeStreamInfo, setActiveStreamInfo] = useState<{
    width: number;
    height: number;
    fps: number;
    wasFallback: boolean;
    audioTracks: number;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'info' | 'error' | 'success' } | null>(null);

  // Audio VU meter state
  const [audioLevel, setAudioLevel] = useState<number>(0);

  // Recorded items gallery
  const [recordedVideos, setRecordedVideos] = useState<RecordedVideo[]>([]);
  const [selectedPreviewVideo, setSelectedPreviewVideo] = useState<RecordedVideo | null>(null);

  // Refs for media recording in simulator
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<any>(null);
  const countdownIntervalRef = useRef<any>(null);
  const startTimeRef = useRef<number>(0);
  const pausedDurationRef = useRef<number>(0);
  const pauseStartRef = useRef<number>(0);

  // Hardware capability check state
  const [systemCaps, setSystemCaps] = useState<{
    screenWidth: number;
    screenHeight: number;
    screenDpr: number;
    refreshRateHz: number;
    canCaptureDisplay: boolean;
    canCaptureMic: boolean;
    supportedCodecs: { name: string; supported: boolean }[];
  }>({
    screenWidth: typeof window !== 'undefined' ? window.screen.width : 1920,
    screenHeight: typeof window !== 'undefined' ? window.screen.height : 1080,
    screenDpr: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
    refreshRateHz: 60,
    canCaptureDisplay: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia,
    canCaptureMic: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
    supportedCodecs: []
  });

  // Load extension source files for the Code Inspector on mount
  useEffect(() => {
    EXTENSION_FILE_LIST.forEach(file => {
      fetch(`/extension/${file.path}`)
        .then(r => r.text())
        .then(text => {
          setFileContents(prev => ({ ...prev, [file.name]: text }));
        })
        .catch(err => console.warn(`Could not load /extension/${file.path}:`, err));
    });
  }, []);

  // Check hardware & codecs on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const testCodecs = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm'
    ];

    const codecResults = testCodecs.map(c => ({
      name: c,
      supported: typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)
    }));

    let frameCount = 0;
    let startTime = performance.now();
    const countFrames = (now: number) => {
      frameCount++;
      if (now - startTime < 500) {
        requestAnimationFrame(countFrames);
      } else {
        const measured = Math.round((frameCount * 1000) / (now - startTime));
        const estimatedHz = measured > 100 ? 120 : measured > 80 ? 90 : 60;
        setSystemCaps(prev => ({
          ...prev,
          refreshRateHz: estimatedHz,
          supportedCodecs: codecResults
        }));
      }
    };
    requestAnimationFrame(countFrames);
  }, []);

  const formatTime = (totalSec: number) => {
    const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const handleStartCapture = () => {
    setStatusMessage(null);
    if (countdownSetting > 0) {
      setRecordingStatus('countdown');
      setCountdownValue(countdownSetting);

      let current = countdownSetting;
      countdownIntervalRef.current = setInterval(() => {
        current -= 1;
        if (current <= 0) {
          clearInterval(countdownIntervalRef.current);
          setRecordingStatus('recording');
          executeLiveCapture();
        } else {
          setCountdownValue(current);
        }
      }, 1000);
    } else {
      setRecordingStatus('recording');
      executeLiveCapture();
    }
  };

  const handleCancelCountdown = () => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
    }
    setRecordingStatus('idle');
  };

  const executeLiveCapture = async () => {
    try {
      recordedChunksRef.current = [];
      const resMap = {
        '4k': { w: 3840, h: 2160, bitrate: 40_000_000, label: '4K UHD' },
        '1440p': { w: 2560, h: 1440, bitrate: 20_000_000, label: '1440p QHD' },
        '1080p': { w: 1920, h: 1080, bitrate: 10_000_000, label: '1080p FHD' }
      };
      const target = resMap[resolution];

      let displayStream: MediaStream;
      let wasFallback = false;

      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: target.w, max: target.w },
            height: { ideal: target.h, max: target.h },
            frameRate: { ideal: fps, max: fps }
          },
          audio: includeSystemAudio ? {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          } : false
        });
      } catch (err: any) {
        if (target.w > 1920) {
          wasFallback = true;
          displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              frameRate: { ideal: fps, max: fps }
            },
            audio: includeSystemAudio
          });
        } else {
          throw err;
        }
      }

      activeStreamRef.current = displayStream;

      const videoTrack = displayStream.getVideoTracks()[0];
      const actualSettings = videoTrack.getSettings ? videoTrack.getSettings() : {};
      const negotiatedWidth = actualSettings.width || target.w;
      const negotiatedHeight = actualSettings.height || target.h;
      const negotiatedFps = actualSettings.frameRate || fps;

      if (target.w >= 3840 && negotiatedWidth < 3840) {
        wasFallback = true;
      }

      videoTrack.addEventListener('ended', () => {
        handleStopCapture();
      });

      let mixedAudioTrack: MediaStreamTrack | null = null;
      const systemAudioTracks = displayStream.getAudioTracks();

      if (includeMicAudio) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          });
          micStreamRef.current = micStream;

          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          const audioCtx = new AudioContextClass();
          audioContextRef.current = audioCtx;

          const dest = audioCtx.createMediaStreamDestination();

          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 64;
          analyserRef.current = analyser;

          if (systemAudioTracks.length > 0) {
            const sysSource = audioCtx.createMediaStreamSource(new MediaStream([systemAudioTracks[0]]));
            sysSource.connect(dest);
            sysSource.connect(analyser);
          }

          const micSource = audioCtx.createMediaStreamSource(micStream);
          micSource.connect(dest);
          micSource.connect(analyser);

          mixedAudioTrack = dest.stream.getAudioTracks()[0];

          const pcmData = new Uint8Array(analyser.frequencyBinCount);
          const updateMeter = () => {
            if (!analyserRef.current) return;
            analyserRef.current.getByteFrequencyData(pcmData);
            let sum = 0;
            for (let i = 0; i < pcmData.length; i++) sum += pcmData[i];
            const average = sum / pcmData.length;
            setAudioLevel(Math.min(100, Math.round((average / 128) * 100)));
            animationFrameRef.current = requestAnimationFrame(updateMeter);
          };
          updateMeter();
        } catch (micErr) {
          console.warn('Microphone permission denied:', micErr);
        }
      } else if (systemAudioTracks.length > 0) {
        mixedAudioTrack = systemAudioTracks[0];
      }

      const tracksToRecord: MediaStreamTrack[] = [videoTrack];
      if (mixedAudioTrack) {
        tracksToRecord.push(mixedAudioTrack);
      }
      const combinedStream = new MediaStream(tracksToRecord);

      const chosenCodec = MediaRecorder.isTypeSupported(codec) ? codec : 'video/webm';
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(combinedStream, {
          mimeType: chosenCodec,
          videoBitsPerSecond: target.bitrate
        });
      } catch (e) {
        recorder = new MediaRecorder(combinedStream);
      }

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        finalizeRecording(chosenCodec, negotiatedWidth, negotiatedHeight, negotiatedFps);
      };

      recorder.start(1000);

      startTimeRef.current = Date.now();
      pausedDurationRef.current = 0;
      setRecordingDuration(0);
      setRecordingStatus('recording');

      setActiveStreamInfo({
        width: negotiatedWidth,
        height: negotiatedHeight,
        fps: Math.round(negotiatedFps),
        wasFallback: wasFallback,
        audioTracks: tracksToRecord.length - 1
      });

      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current - pausedDurationRef.current) / 1000);
        setRecordingDuration(Math.max(0, elapsed));
      }, 500);

      if (wasFallback) {
        setStatusMessage({
          text: `Screen recording active. Display bounds negotiated at ${negotiatedWidth}×${negotiatedHeight} (Fallback from requested 4K).`,
          type: 'info'
        });
      } else {
        setStatusMessage({
          text: `Recording in full 4K (${negotiatedWidth}×${negotiatedHeight}) @ ${Math.round(negotiatedFps)} FPS.`,
          type: 'success'
        });
      }
    } catch (err: any) {
      console.error('Capture initiation failed:', err);
      cleanUpMedia();
      setRecordingStatus('idle');
      setStatusMessage({
        text: err.name === 'NotAllowedError' ? 'Screen capture cancelled by user.' : (err.message || 'Failed to start screen capture.'),
        type: 'error'
      });
    }
  };

  const handlePauseCapture = () => {
    if (mediaRecorderRef.current && recordingStatus === 'recording') {
      mediaRecorderRef.current.pause();
      pauseStartRef.current = Date.now();
      setRecordingStatus('paused');
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
  };

  const handleResumeCapture = () => {
    if (mediaRecorderRef.current && recordingStatus === 'paused') {
      mediaRecorderRef.current.resume();
      pausedDurationRef.current += (Date.now() - pauseStartRef.current);
      setRecordingStatus('recording');
      timerIntervalRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current - pausedDurationRef.current) / 1000);
        setRecordingDuration(Math.max(0, elapsed));
      }, 500);
    }
  };

  const handleStopCapture = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.requestData();
      } catch (e) {}
      mediaRecorderRef.current.stop();
    }
    setRecordingStatus('idle');
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
  };

  const cleanUpMedia = () => {
    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach(t => {
        try { t.stop(); } catch (e) {}
      });
      activeStreamRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => {
        try { t.stop(); } catch (e) {}
      });
      micStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try { audioContextRef.current.close(); } catch (e) {}
      audioContextRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setAudioLevel(0);
  };

  const finalizeRecording = async (mimeType: string, width: number, height: number, streamFps: number) => {
    cleanUpMedia();
    const isMp4 = mimeType.includes('mp4');
    const ext = isMp4 ? 'mp4' : 'webm';
    const rawBlob = new Blob(recordedChunksRef.current, { type: mimeType });

    // Fix WebM Duration metadata
    let finalBlob = rawBlob;
    if (mimeType.includes('webm')) {
      try {
        const durationMs = Math.max(500, recordingDuration * 1000);
        finalBlob = await fixWebmDuration(rawBlob, durationMs);
      } catch (err) {
        console.warn('Duration fix error:', err);
      }
    }

    const url = URL.createObjectURL(finalBlob);
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `UltraRec_${width}x${height}_${dateStr}.${ext}`;

    const newVideo: RecordedVideo = {
      id: Math.random().toString(36).substring(2, 9),
      url: url,
      filename: filename,
      resolution: `${width}×${height}`,
      fps: Math.round(streamFps),
      duration: recordingDuration,
      sizeBytes: finalBlob.size,
      timestamp: new Date().toLocaleTimeString()
    };

    setRecordedVideos(prev => [newVideo, ...prev]);
    setSelectedPreviewVideo(newVideo);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setStatusMessage({
      text: `Recording saved (${formatBytes(finalBlob.size)})! File "${filename}" downloaded with valid duration metadata.`,
      type: 'success'
    });
  };

  const handleCopyCode = async () => {
    const code = fileContents[selectedFileName] || '';
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDownloadFile = () => {
    const code = fileContents[selectedFileName] || '';
    if (!code) return;
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = selectedFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadZip = async () => {
    setIsExportingZip(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder('ultrarec-extension') || zip;

      // Add all source files
      for (const file of EXTENSION_FILE_LIST) {
        let content = fileContents[file.name];
        if (!content) {
          content = await fetch(`/extension/${file.path}`).then(r => r.text());
        }
        folder.file(file.name, content);
      }

      // Add binary icons
      const iconsFolder = folder.folder('icons');
      try {
        const [res16, res48, res128] = await Promise.all([
          fetch('/extension/icons/icon16.png').then(r => r.blob()),
          fetch('/extension/icons/icon48.png').then(r => r.blob()),
          fetch('/extension/icons/icon128.png').then(r => r.blob())
        ]);
        if (iconsFolder) {
          iconsFolder.file('icon16.png', res16);
          iconsFolder.file('icon48.png', res48);
          iconsFolder.file('icon128.png', res128);
        }
      } catch (iconErr) {
        console.warn('Could not fetch icons:', iconErr);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ultrarec-extension-v1.0.0.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatusMessage({
        text: 'UltraRec extension packaged into ultrarec-extension-v1.0.0.zip successfully!',
        type: 'success'
      });
    } catch (err: any) {
      console.error('ZIP generation failed:', err);
    } finally {
      setIsExportingZip(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#060911] text-slate-100 font-sans flex flex-col selection:bg-red-500/30 selection:text-red-200">
      {/* Top Bar Contract: 3 zones separated by gap-8 (Brand wordmark, nav links, 1 primary action) */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-[#182032] bg-[#090d18]/90 backdrop-blur sticky top-0 z-40">
        {/* Zone 1: Brand wordmark */}
        <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500 via-red-600 to-red-800 flex items-center justify-center shadow-lg shadow-red-600/30">
            <Video className="w-4 h-4 text-white" />
          </div>
          <span className="text-base font-bold tracking-tight text-white">UltraRec</span>
          <span className="text-xs text-red-400 font-mono hidden sm:inline font-semibold">4K · 60FPS STUDIO</span>
        </div>

        {/* Zone 2: Navigation Links */}
        <nav className="flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            onClick={() => setActiveTab('simulator')}
            className={`whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'simulator' ? 'text-white font-semibold' : 'hover:text-slate-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            Live Recorder
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={`whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'code' ? 'text-white font-semibold' : 'hover:text-slate-200'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            Code Inspector
          </button>
          <button
            onClick={() => setActiveTab('capabilities')}
            className={`whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'capabilities' ? 'text-white font-semibold' : 'hover:text-slate-200'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            Hardware & 4K Checker
          </button>
          <button
            onClick={() => setActiveTab('install')}
            className={`whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'install' ? 'text-white font-semibold' : 'hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Chrome Setup
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action Button */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={handleDownloadZip}
            disabled={isExportingZip}
            className="px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 rounded-lg shadow-sm shadow-red-500/30 transition-all flex items-center gap-2 whitespace-nowrap active:scale-95 disabled:opacity-50"
          >
            <FolderArchive className="w-3.5 h-3.5" />
            {isExportingZip ? 'Packaging ZIP...' : 'Download Extension (.zip)'}
          </button>
        </div>
      </header>

      {/* Main Workspace Canvas */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col gap-6">
        {/* Status Alert Banner */}
        {statusMessage && (
          <div
            className={`px-4 py-3 rounded-lg border text-xs flex items-center justify-between ${
              statusMessage.type === 'error'
                ? 'bg-red-950/40 border-red-800/80 text-red-200'
                : statusMessage.type === 'success'
                ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-200'
                : 'bg-blue-950/40 border-blue-800/80 text-blue-200'
            }`}
          >
            <span>{statusMessage.text}</span>
            <button
              onClick={() => setStatusMessage(null)}
              className="text-slate-400 hover:text-white ml-4 text-xs font-mono"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* TAB 1: LIVE SIMULATOR & RECORDER STUDIO */}
        {activeTab === 'simulator' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column: Chrome Extension Popup Realistic Simulation Frame */}
            <div className="lg:col-span-5 flex flex-col items-center">
              <div className="w-full max-w-[400px]">
                {/* Browser Toolbar Emulation Bar */}
                <div className="bg-[#0b101b] border border-[#1c263c] rounded-t-xl px-4 py-2.5 flex items-center justify-between text-xs text-slate-400">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500/80"></span>
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80"></span>
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80"></span>
                    <span className="text-[11px] font-mono text-slate-400 ml-2">chrome-extension://ultrarec/popup.html</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-mono">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    Active
                  </div>
                </div>

                {/* The Extension Popup Window Styled to Match the Redesigned popup.html */}
                <div className="bg-[#070a11] border-x border-b border-[#1c263c] rounded-b-xl p-4 shadow-2xl relative select-none">
                  {/* Top Bar */}
                  <div className="flex items-center justify-between pb-3.5 border-b border-[#1c263c]">
                    <div className="flex items-center gap-2.5">
                      <div className="w-[30px] h-[30px] rounded-[9px] bg-gradient-to-br from-[#f43f5e] via-[#dc2626] to-[#991b1b] flex items-center justify-center shadow-lg shadow-red-500/40 shrink-0">
                        <Video className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <div className="text-[15px] font-bold text-white tracking-tight leading-tight">UltraRec</div>
                        <div className="text-[10px] font-semibold text-red-500 font-mono tracking-wider mt-0.5">4K · 60FPS STUDIO</div>
                      </div>
                    </div>
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-semibold border border-[#1c263c] bg-[#0f172a]/80 text-slate-300">
                      <span
                        className={`w-1.5 h-1.5 rounded-full transition-all ${
                          recordingStatus === 'recording'
                            ? 'bg-red-500 shadow-sm shadow-red-500 animate-pulse'
                            : recordingStatus === 'paused'
                            ? 'bg-amber-400 shadow-sm shadow-amber-400'
                            : 'bg-slate-500'
                        }`}
                      />
                      <span>
                        {recordingStatus === 'recording'
                          ? 'REC 4K 60FPS'
                          : recordingStatus === 'paused'
                          ? 'PAUSED'
                          : 'STANDBY'}
                      </span>
                    </div>
                  </div>

                  {/* Countdown Overlay */}
                  {recordingStatus === 'countdown' && (
                    <div className="absolute inset-0 bg-[#070a11]/95 rounded-b-xl z-30 flex flex-col items-center justify-center backdrop-blur-md">
                      <div className="text-7xl font-black text-red-500 font-mono animate-pulse drop-shadow-[0_0_25px_rgba(239,68,68,0.6)]">
                        {countdownValue}
                      </div>
                      <div className="text-xs text-slate-400 mt-2">Calibrating 4K capture...</div>
                      <button
                        onClick={handleCancelCountdown}
                        className="mt-4 px-3 py-1 rounded-md border border-[#1c263c] text-xs text-slate-300 hover:text-white transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {/* Stopwatch HUD Card */}
                  <div
                    className={`mt-3.5 bg-gradient-to-b from-[#101726]/70 to-[#0a0e18]/90 border rounded-2xl p-4 text-center transition-all ${
                      recordingStatus === 'recording'
                        ? 'border-red-500/40 shadow-[0_0_20px_rgba(239,68,68,0.15)]'
                        : 'border-[#1c263c]'
                    }`}
                  >
                    <div className="font-mono text-4xl font-extrabold tracking-wider text-white tabular-nums drop-shadow-md">
                      {formatTime(recordingDuration)}
                    </div>
                    <div className="flex items-center justify-center gap-2 text-[11px] font-medium text-slate-400 font-mono mt-2">
                      <span className="bg-white/5 px-2 py-0.5 rounded border border-white/5 text-slate-200">
                        {activeStreamInfo
                          ? `${activeStreamInfo.width}×${activeStreamInfo.height}`
                          : resolution === '4k'
                          ? '4K UHD'
                          : resolution === '1440p'
                          ? '1440p QHD'
                          : '1080p FHD'}
                      </span>
                      <span>·</span>
                      <span className="bg-white/5 px-2 py-0.5 rounded border border-white/5 text-slate-200">
                        {fps} FPS
                      </span>
                      <span>·</span>
                      <span className="bg-white/5 px-2 py-0.5 rounded border border-white/5 text-slate-200">
                        {resolution === '4k' ? '40 Mbps' : resolution === '1440p' ? '20 Mbps' : '10 Mbps'}
                      </span>
                    </div>

                    {/* Active VU Equalizer Bar */}
                    {(recordingStatus === 'recording' || recordingStatus === 'paused') && (
                      <div className="mt-2.5 flex items-center gap-2 bg-black/40 px-2.5 py-1.5 rounded-lg border border-[#1c263c]">
                        <Volume2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <div className="flex-1 h-1.5 bg-[#111827] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-emerald-500 via-amber-400 to-red-500 transition-all duration-75"
                            style={{ width: `${Math.max(8, audioLevel)}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-mono text-slate-400">{audioLevel}%</span>
                      </div>
                    )}
                  </div>

                  {/* Configuration Controls (Disabled during active recording) */}
                  <div
                    className={`mt-4 space-y-3 transition-opacity ${
                      recordingStatus === 'recording' || recordingStatus === 'paused'
                        ? 'opacity-35 pointer-events-none'
                        : 'opacity-100'
                    }`}
                  >
                    {/* Resolution Cards */}
                    <div className="flex items-center justify-between text-[11px] font-bold tracking-wider uppercase text-slate-400">
                      <span>Target Resolution</span>
                      <span className="text-[9.5px] text-red-400 font-mono">AUTO-FALLBACK ON</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div
                        onClick={() => setResolution('4k')}
                        className={`border rounded-xl p-2.5 text-center cursor-pointer transition-all relative ${
                          resolution === '4k'
                            ? 'bg-red-500/10 border-red-500/70 shadow-sm shadow-red-500/20'
                            : 'bg-[#0d121f] border-[#1c263c] hover:bg-[#131a2b]'
                        }`}
                      >
                        <span className="absolute -top-1.5 right-1.5 bg-red-500 text-white text-[8px] font-extrabold px-1 py-0.2 rounded font-mono">
                          4K
                        </span>
                        <div className={`text-xs font-bold ${resolution === '4k' ? 'text-red-300' : 'text-white'}`}>
                          3840×2160
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">40 Mbps</div>
                      </div>

                      <div
                        onClick={() => setResolution('1440p')}
                        className={`border rounded-xl p-2.5 text-center cursor-pointer transition-all ${
                          resolution === '1440p'
                            ? 'bg-red-500/10 border-red-500/70 shadow-sm shadow-red-500/20'
                            : 'bg-[#0d121f] border-[#1c263c] hover:bg-[#131a2b]'
                        }`}
                      >
                        <div className={`text-xs font-bold ${resolution === '1440p' ? 'text-red-300' : 'text-white'}`}>
                          1440p QHD
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">2560×1440</div>
                      </div>

                      <div
                        onClick={() => setResolution('1080p')}
                        className={`border rounded-xl p-2.5 text-center cursor-pointer transition-all ${
                          resolution === '1080p'
                            ? 'bg-red-500/10 border-red-500/70 shadow-sm shadow-red-500/20'
                            : 'bg-[#0d121f] border-[#1c263c] hover:bg-[#131a2b]'
                        }`}
                      >
                        <div className={`text-xs font-bold ${resolution === '1080p' ? 'text-red-300' : 'text-white'}`}>
                          1080p FHD
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">1920×1080</div>
                      </div>
                    </div>

                    {/* Framerate & Delay Segmented Controls */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-[#0d121f] border border-[#1c263c] rounded-xl p-2 flex flex-col gap-1.5">
                        <div className="text-[10.5px] font-semibold text-slate-400">Framerate (FPS)</div>
                        <div className="flex bg-black/40 p-0.5 rounded-lg gap-1">
                          <button
                            type="button"
                            onClick={() => setFps(60)}
                            className={`flex-1 text-[11px] font-semibold py-1 rounded transition-colors ${
                              fps === 60 ? 'bg-[#141c2e] text-white shadow-sm border border-white/10' : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            60 FPS
                          </button>
                          <button
                            type="button"
                            onClick={() => setFps(30)}
                            className={`flex-1 text-[11px] font-semibold py-1 rounded transition-colors ${
                              fps === 30 ? 'bg-[#141c2e] text-white shadow-sm border border-white/10' : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            30 FPS
                          </button>
                        </div>
                      </div>

                      <div className="bg-[#0d121f] border border-[#1c263c] rounded-xl p-2 flex flex-col gap-1.5">
                        <div className="text-[10.5px] font-semibold text-slate-400">Countdown Delay</div>
                        <div className="flex bg-black/40 p-0.5 rounded-lg gap-1">
                          {[3, 5, 0].map(s => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setCountdownSetting(s)}
                              className={`flex-1 text-[11px] font-semibold py-1 rounded transition-colors ${
                                countdownSetting === s ? 'bg-[#141c2e] text-white shadow-sm border border-white/10' : 'text-slate-400 hover:text-white'
                              }`}
                            >
                              {s === 0 ? 'Off' : `${s}s`}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Encoding Format Select */}
                    <div className="bg-[#0d121f] border border-[#1c263c] rounded-xl p-2">
                      <div className="text-[10.5px] font-semibold text-slate-400 mb-1">Video Encoding Engine</div>
                      <select
                        value={codec}
                        onChange={(e) => setCodec(e.target.value)}
                        className="w-full bg-black/40 border border-[#1c263c] rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-red-500 cursor-pointer"
                      >
                        <option value="video/webm;codecs=vp9,opus">WebM · VP9 Profile (Cinematic Fidelity)</option>
                        <option value="video/webm;codecs=vp8,opus">WebM · VP8 (Standard Compatibility)</option>
                        <option value="video/webm;codecs=h264,opus">WebM · H.264 / AVC</option>
                        <option value="video/mp4">MP4 · Universal Container</option>
                      </select>
                    </div>

                    {/* Audio Sources Console */}
                    <div className="text-[11px] font-bold tracking-wider uppercase text-slate-400 pt-1">
                      Audio Mixing Console
                    </div>
                    <div className="bg-[#0d121f] border border-[#1c263c] rounded-xl p-2.5 space-y-2.5">
                      <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                        <span className="flex items-center gap-2">
                          <Volume2 className="w-4 h-4 text-slate-400" />
                          System / Tab Audio
                        </span>
                        <input
                          type="checkbox"
                          checked={includeSystemAudio}
                          onChange={(e) => setIncludeSystemAudio(e.target.checked)}
                          className="accent-red-500 w-4 h-4 rounded cursor-pointer"
                        />
                      </label>

                      <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                        <span className="flex items-center gap-2">
                          <Mic className="w-4 h-4 text-slate-400" />
                          Microphone Input
                        </span>
                        <input
                          type="checkbox"
                          checked={includeMicAudio}
                          onChange={(e) => setIncludeMicAudio(e.target.checked)}
                          className="accent-red-500 w-4 h-4 rounded cursor-pointer"
                        />
                      </label>
                    </div>
                  </div>

                  {/* Primary Trigger Actions */}
                  <div className="mt-4">
                    {recordingStatus === 'idle' ? (
                      <button
                        onClick={handleStartCapture}
                        className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-rose-500 via-red-600 to-rose-700 hover:from-rose-400 hover:to-rose-600 text-white font-bold text-xs flex items-center justify-center gap-2.5 shadow-lg shadow-red-600/40 transition-all active:scale-[0.98]"
                      >
                        <div className="w-3.5 h-3.5 rounded-full bg-white shadow-[0_0_8px_white] relative">
                          <div className="absolute -inset-1 border border-white/60 rounded-full" />
                        </div>
                        <span>Start 4K 60FPS Recording</span>
                      </button>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {recordingStatus === 'recording' ? (
                          <button
                            onClick={handlePauseCapture}
                            className="py-2.5 px-3 rounded-lg bg-[#1e293b] hover:bg-[#334155] border border-[#334155] text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Pause className="w-3.5 h-3.5" />
                            Pause
                          </button>
                        ) : (
                          <button
                            onClick={handleResumeCapture}
                            className="py-2.5 px-3 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm shadow-amber-500/30"
                          >
                            <Play className="w-3.5 h-3.5 fill-white" />
                            Resume
                          </button>
                        )}
                        <button
                          onClick={handleStopCapture}
                          className="py-2.5 px-3 rounded-lg bg-gradient-to-r from-red-950 to-rose-950 hover:from-red-900 hover:to-rose-900 border border-red-800 text-red-200 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                        >
                          <Square className="w-3.5 h-3.5 fill-current" />
                          Finish & Save
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Footnote */}
                  <div className="mt-3.5 text-center text-[10.5px] text-slate-500 flex items-center justify-center gap-1 font-mono">
                    <span>Shortcut:</span>
                    <kbd className="bg-black/50 border border-slate-800 px-1 rounded text-slate-400">Ctrl+Shift+S</kbd>
                    <span>or</span>
                    <kbd className="bg-black/50 border border-slate-800 px-1 rounded text-slate-400">⌘+Shift+S</kbd>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Live Stream Telemetry & Recorded Videos Gallery */}
            <div className="lg:col-span-7 flex flex-col gap-6">
              {/* Telemetry & Constraints Card */}
              <div className="bg-[#0b101c] border border-slate-800 rounded-xl p-5">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
                  <div className="text-sm font-semibold text-white flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-red-400" />
                    Real-Time Stream Telemetry & Constraints
                  </div>
                  <span className="text-xs text-slate-400 font-mono">
                    {recordingStatus === 'recording' ? 'Negotiated Active' : 'Pre-flight Config'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                  <div className="bg-slate-900/60 border border-slate-800/60 rounded-lg p-3">
                    <div className="text-[11px] text-slate-400">Target Resolution</div>
                    <div className="text-sm font-bold text-white font-mono mt-0.5">
                      {resolution === '4k' ? '3840×2160' : resolution === '1440p' ? '2560×1440' : '1920×1080'}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">
                      {activeStreamInfo?.wasFallback ? 'Hardware Fallback' : 'Native 4K Supported'}
                    </div>
                  </div>

                  <div className="bg-slate-900/60 border border-slate-800/60 rounded-lg p-3">
                    <div className="text-[11px] text-slate-400">Target Framerate</div>
                    <div className="text-sm font-bold text-white font-mono mt-0.5">
                      {activeStreamInfo ? `${activeStreamInfo.fps} FPS` : `${fps} FPS`}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">MediaRecorder Constrained</div>
                  </div>

                  <div className="bg-slate-900/60 border border-slate-800/60 rounded-lg p-3">
                    <div className="text-[11px] text-slate-400">Target Bitrate</div>
                    <div className="text-sm font-bold text-white font-mono mt-0.5">
                      {resolution === '4k' ? '40 Mbps' : resolution === '1440p' ? '20 Mbps' : '10 Mbps'}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">High Bitrate Encoding</div>
                  </div>

                  <div className="bg-slate-900/60 border border-slate-800/60 rounded-lg p-3">
                    <div className="text-[11px] text-slate-400">Audio Channels</div>
                    <div className="text-sm font-bold text-white font-mono mt-0.5">
                      {includeSystemAudio && includeMicAudio
                        ? 'Dual Mix (Web Audio)'
                        : includeSystemAudio
                        ? 'System Only'
                        : includeMicAudio
                        ? 'Mic Only'
                        : 'Muted'}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">48 kHz Stereo / Mono</div>
                  </div>
                </div>

                <div className="mt-4 p-3 rounded-lg bg-slate-900/40 border border-slate-800/60 text-xs text-slate-300 leading-relaxed">
                  <span className="font-semibold text-slate-200">How UltraRec handles 4K 60FPS:</span> DisplayMedia constraints request ideal and maximum dimensions of 3840×2160 at 60fps. When run on higher DPI or 4K monitors, Chrome captures at true 4K resolution. If the host display has lower native bounds, UltraRec applies an automatic graceful fallback to the display's maximum resolution so capture never fails.
                </div>
              </div>

              {/* Recorded Videos Preview & Gallery */}
              <div className="bg-[#0b101c] border border-slate-800 rounded-xl p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
                  <div className="text-sm font-semibold text-white flex items-center gap-2">
                    <Video className="w-4 h-4 text-red-400" />
                    Recorded Video Gallery & Exported Files
                  </div>
                  <span className="text-xs text-slate-400 font-mono">
                    {recordedVideos.length} {recordedVideos.length === 1 ? 'file' : 'files'} recorded
                  </span>
                </div>

                {selectedPreviewVideo ? (
                  <div className="space-y-3">
                    <div className="aspect-video bg-black rounded-lg overflow-hidden border border-slate-800 relative">
                      <video
                        src={selectedPreviewVideo.url}
                        controls
                        className="w-full h-full object-contain"
                        autoPlay
                      />
                    </div>
                    <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                      <div className="font-mono text-slate-300">
                        {selectedPreviewVideo.filename} · {selectedPreviewVideo.resolution} @ {selectedPreviewVideo.fps}fps · {formatBytes(selectedPreviewVideo.sizeBytes)}
                      </div>
                      <a
                        href={selectedPreviewVideo.url}
                        download={selectedPreviewVideo.filename}
                        className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-medium text-xs flex items-center gap-1.5 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download Again
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="py-8 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-lg">
                    No recordings captured yet in this session. Click &quot;Start 4K 60FPS Recording&quot; in the extension simulator to record your screen!
                  </div>
                )}

                {/* History List */}
                {recordedVideos.length > 1 && (
                  <div className="space-y-2 mt-2">
                    <div className="text-xs font-medium text-slate-400">Previous Recordings</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {recordedVideos.map((v) => (
                        <div
                          key={v.id}
                          onClick={() => setSelectedPreviewVideo(v)}
                          className={`p-2.5 rounded-lg border cursor-pointer text-xs transition-colors flex items-center justify-between ${
                            selectedPreviewVideo?.id === v.id
                              ? 'bg-slate-800 border-red-500/50 text-white'
                              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 text-slate-300'
                          }`}
                        >
                          <div>
                            <div className="font-mono font-medium truncate max-w-[180px]">{v.filename}</div>
                            <div className="text-[11px] text-slate-500 font-mono">
                              {v.resolution} · {formatBytes(v.sizeBytes)} · {v.timestamp}
                            </div>
                          </div>
                          <Eye className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: CODE INSPECTOR */}
        {activeTab === 'code' && (
          <div className="bg-[#0b101c] border border-slate-800 rounded-xl overflow-hidden flex flex-col flex-1">
            {/* Code Inspector Header & File Tabs */}
            <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-3 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2 overflow-x-auto">
                {EXTENSION_FILE_LIST.map((file) => {
                  const isActive = selectedFileName === file.name;
                  return (
                    <button
                      key={file.name}
                      onClick={() => setSelectedFileName(file.name)}
                      className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                        isActive
                          ? 'bg-slate-800 text-white font-semibold border border-slate-700 shadow-sm'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                      }`}
                    >
                      <FileCode className="w-3.5 h-3.5 text-red-400" />
                      {file.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyCode}
                  className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 flex items-center gap-1.5 transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied!' : 'Copy File'}
                </button>
                <button
                  onClick={handleDownloadFile}
                  className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Save File
                </button>
              </div>
            </div>

            {/* Code Display Area */}
            <div className="p-4 bg-[#080d18] overflow-x-auto flex-1 font-mono text-xs leading-relaxed text-slate-300">
              <pre className="selection:bg-red-500/30">
                <code>{fileContents[selectedFileName] || 'Loading file content...'}</code>
              </pre>
            </div>
          </div>
        )}

        {/* TAB 3: HARDWARE & 4K CAPABILITY INSPECTOR */}
        {activeTab === 'capabilities' && (
          <div className="space-y-6">
            <div className="bg-[#0b101c] border border-slate-800 rounded-xl p-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <div>
                  <h2 className="text-base font-bold text-white">Browser & Hardware Capability Audit</h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Live check of this device&apos;s display resolution, estimated refresh rate, MediaRecorder codecs, and Web Audio support.
                  </p>
                </div>
                <div className="px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs font-semibold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  Diagnostics Active
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4">
                  <div className="text-xs text-slate-400">Current Display Resolution</div>
                  <div className="text-xl font-bold font-mono text-white mt-1">
                    {systemCaps.screenWidth * systemCaps.screenDpr} × {systemCaps.screenHeight * systemCaps.screenDpr}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Logical: {systemCaps.screenWidth}×{systemCaps.screenHeight} · DPR: {systemCaps.screenDpr}x
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-800 text-xs">
                    {systemCaps.screenWidth * systemCaps.screenDpr >= 3840 ? (
                      <span className="text-emerald-400 font-medium">True 4K Display Detected</span>
                    ) : (
                      <span className="text-amber-400 font-medium">Auto-Fallback Enabled for 4K</span>
                    )}
                  </div>
                </div>

                <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4">
                  <div className="text-xs text-slate-400">Display Refresh Rate</div>
                  <div className="text-xl font-bold font-mono text-white mt-1">
                    ~{systemCaps.refreshRateHz} Hz
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Target constraint: 60 FPS (ideal & max)
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-800 text-xs">
                    {systemCaps.refreshRateHz >= 60 ? (
                      <span className="text-emerald-400 font-medium">60 FPS Hardware Capable</span>
                    ) : (
                      <span className="text-slate-400 font-medium">Standard 30 FPS Recommended</span>
                    )}
                  </div>
                </div>

                <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4">
                  <div className="text-xs text-slate-400">Media Stream Permissions</div>
                  <div className="text-xl font-bold font-mono text-white mt-1">
                    {systemCaps.canCaptureDisplay ? 'Supported' : 'Unavailable'}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    getDisplayMedia & Web Audio API
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-800 text-xs">
                    <span className="text-emerald-400 font-medium">Ready for Tab & Screen Capture</span>
                  </div>
                </div>
              </div>

              {/* Supported Codecs Table */}
              <div className="mt-6">
                <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
                  Browser Codec Support Matrix
                </div>
                <div className="border border-slate-800 rounded-lg overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800 font-medium">
                      <tr>
                        <th className="px-4 py-2.5">Encoding MIME / Codec</th>
                        <th className="px-4 py-2.5">Compression Quality</th>
                        <th className="px-4 py-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                      {systemCaps.supportedCodecs.map((item) => (
                        <tr key={item.name} className="hover:bg-slate-900/40">
                          <td className="px-4 py-2.5 font-medium">{item.name}</td>
                          <td className="px-4 py-2.5 text-slate-400">
                            {item.name.includes('vp9')
                              ? 'Ultra High (VP9 Profile)'
                              : item.name.includes('vp8')
                              ? 'Standard (VP8)'
                              : item.name.includes('h264')
                              ? 'Universal H.264 / AVC'
                              : 'Default Container'}
                          </td>
                          <td className="px-4 py-2.5">
                            {item.supported ? (
                              <span className="text-emerald-400 flex items-center gap-1">
                                <Check className="w-3 h-3" /> Supported
                              </span>
                            ) : (
                              <span className="text-slate-500">Not Supported</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: CHROME SETUP & INSTALLATION GUIDE */}
        {activeTab === 'install' && (
          <div className="bg-[#0b101c] border border-slate-800 rounded-xl p-6 space-y-6">
            <div className="pb-4 border-b border-slate-800">
              <h2 className="text-base font-bold text-white">How to Install UltraRec in Google Chrome</h2>
              <p className="text-xs text-slate-400 mt-1">
                Install as an unpacked Manifest V3 extension in under 30 seconds.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <div className="w-7 h-7 rounded-full bg-red-950 border border-red-800 text-red-300 text-xs font-bold flex items-center justify-center font-mono">
                    01
                  </div>
                  <h3 className="text-sm font-semibold text-white mt-3">Download & Unzip</h3>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    Click the &quot;Download Extension (.zip)&quot; button in the top right. Extract the ZIP file onto your computer.
                  </p>
                </div>
                <button
                  onClick={handleDownloadZip}
                  className="mt-4 w-full py-1.5 px-3 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-white transition-colors"
                >
                  Download ZIP
                </button>
              </div>

              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-xs font-bold flex items-center justify-center font-mono">
                    02
                  </div>
                  <h3 className="text-sm font-semibold text-white mt-3">Open chrome://extensions</h3>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    Type <code className="text-red-400 font-mono">chrome://extensions</code> in your Chrome URL bar and press Enter.
                  </p>
                </div>
                <div className="mt-4 text-[11px] text-slate-500 font-mono">Chrome Extensions Manager</div>
              </div>

              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-xs font-bold flex items-center justify-center font-mono">
                    03
                  </div>
                  <h3 className="text-sm font-semibold text-white mt-3">Enable Developer Mode</h3>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    Toggle the &quot;Developer mode&quot; switch in the top-right corner of the extensions page.
                  </p>
                </div>
                <div className="mt-4 text-[11px] text-slate-500 font-mono">Developer mode = ON</div>
              </div>

              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-xs font-bold flex items-center justify-center font-mono">
                    04
                  </div>
                  <h3 className="text-sm font-semibold text-white mt-3">Load Unpacked</h3>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    Click &quot;Load unpacked&quot; in the top-left and select the extracted <code className="text-red-400 font-mono">ultrarec-extension</code> directory.
                  </p>
                </div>
                <div className="mt-4 text-[11px] text-emerald-400 font-medium">Ready to record!</div>
              </div>
            </div>

            {/* Permissions & Security Summary */}
            <div className="border border-slate-800/80 rounded-xl p-4 bg-slate-900/30">
              <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Manifest V3 Security & Permissions Breakdown
              </div>
              <ul className="text-xs text-slate-400 space-y-1.5 list-disc pl-4">
                <li><strong className="text-slate-200">desktopCapture & tabCapture</strong>: Enables capturing video and system audio from selected monitors, windows, or tabs.</li>
                <li><strong className="text-slate-200">offscreen</strong>: Chrome Manifest V3 standard for continuous background media recording, eliminating popup closure interruptions.</li>
                <li><strong className="text-slate-200">downloads</strong>: Directly saves the finalized high-bitrate WebM or MP4 video files into your Downloads directory.</li>
                <li><strong className="text-slate-200">storage</strong>: Preserves user preferences (4K/1440p/1080p, 60fps/30fps, audio toggles) across browser restarts.</li>
              </ul>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-4 px-6 text-center text-xs text-slate-500 font-mono">
        UltraRec · Chrome Extension Manifest V3 · 4K UHD 60FPS Screen Recording Suite
      </footer>
    </div>
  );
}
