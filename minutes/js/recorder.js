// マイク音声の録音(MediaRecorder)と入力レベルの取得。
// 音声認識とは別に音声そのものも残しておき、あとから聞き返せるようにする。

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg;codecs=opus'
];

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of MIME_CANDIDATES) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* 次の候補へ */ }
  }
  return '';
}

export const isRecordingSupported = typeof MediaRecorder !== 'undefined'
  && Boolean(navigator.mediaDevices?.getUserMedia);

export function createRecorder() {
  let stream = null;
  let recorder = null;
  let chunks = [];
  let audioCtx = null;
  let analyser = null;
  let data = null;

  async function start() {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    setupMeter(stream);
    const mimeType = pickMime();
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    recorder.start(4000); // 4秒ごとに小分けして受け取る(長時間でも取りこぼしにくい)
    return recorder.mimeType || mimeType || 'audio/webm';
  }

  function setupMeter(mediaStream) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = new Ctx();
      const src = audioCtx.createMediaStreamSource(mediaStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.75;
      data = new Uint8Array(analyser.frequencyBinCount);
      src.connect(analyser);
    } catch {
      analyser = null; // レベル表示だけ諦める
    }
  }

  // 0〜1 の入力レベル
  function level() {
    if (!analyser || !data) return 0;
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i] - 128) / 128;
      if (v > peak) peak = v;
    }
    return Math.min(1, peak * 1.8);
  }

  function pause() {
    try { if (recorder?.state === 'recording') recorder.pause(); } catch { /* 未対応なら無視 */ }
  }

  function resume() {
    try { if (recorder?.state === 'paused') recorder.resume(); } catch { /* 未対応なら無視 */ }
  }

  function stop() {
    return new Promise((resolve) => {
      const finish = () => {
        cleanup();
        if (!chunks.length) { resolve(null); return; }
        const type = recorder?.mimeType || chunks[0]?.type || 'audio/webm';
        resolve(new Blob(chunks, { type }));
      };
      if (!recorder || recorder.state === 'inactive') { finish(); return; }
      recorder.onstop = finish;
      try { recorder.stop(); } catch { finish(); }
    });
  }

  function cleanup() {
    try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* 停止済み */ }
    try { audioCtx?.close(); } catch { /* 閉じ済み */ }
    stream = null;
    audioCtx = null;
    analyser = null;
  }

  return { start, stop, pause, resume, level, cleanup, get active() { return Boolean(recorder); } };
}

// 録音中に画面が消えないようにする(端末が対応していれば)
export function createWakeLock() {
  let lock = null;
  async function request() {
    try {
      if (!navigator.wakeLock?.request) return false;
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener?.('release', () => { lock = null; });
      return true;
    } catch {
      return false;
    }
  }
  function release() {
    try { lock?.release?.(); } catch { /* 解放済み */ }
    lock = null;
  }
  return { request, release, get held() { return Boolean(lock); } };
}

export function fmtBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
