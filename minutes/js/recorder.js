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

// マイクの前処理。近くの声か、会場の遠い声かで最適な設定が違う
export const MIC_MODES = {
  // 端末を話者の近くに置く会議向け。雑音とエコーを抑える
  near: {
    label: '近くの声(会議)',
    hint: '雑音とエコーを抑えます。端末を話者の近くに置くとき向き',
    constraints: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  },
  // 講演会など、離れた話者の小さい声まで拾いたいとき。
  // ノイズ抑制は小さい声ごと削ってしまうことがあるため切る
  far: {
    label: '遠くの声(講演)',
    hint: 'ノイズ抑制を切り、離れた小さな声も削らず拾います',
    constraints: { echoCancellation: false, noiseSuppression: false, autoGainControl: true }
  }
};

export function createRecorder() {
  let stream = null;
  let recorder = null;
  let chunks = [];
  let audioCtx = null;
  let analyser = null;
  let data = null;
  let peakSum = 0;
  let peakCount = 0;
  let clipCount = 0;

  async function start(mode = 'near') {
    const preset = MIC_MODES[mode] || MIC_MODES.near;
    const audio = { ...preset.constraints, channelCount: 1, sampleRate: 48000 };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio });
    } catch {
      // 端末が細かい指定を受け付けない場合は既定の設定で開き直す
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    setupMeter(stream);
    const mimeType = pickMime();
    recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64000 } : undefined);
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    recorder.start(4000); // 4秒ごとに小分けして受け取る(長時間でも取りこぼしにくい)
    return recorder.mimeType || mimeType || 'audio/webm';
  }

  // 実際に適用された設定(端末が指定を無視することがあるため確認用)
  function appliedSettings() {
    try { return stream?.getAudioTracks()[0]?.getSettings?.() || null; } catch { return null; }
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

  // 0〜1 の入力レベル。同時に音量の傾向を貯めておく
  function level() {
    if (!analyser || !data) return 0;
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i] - 128) / 128;
      if (v > peak) peak = v;
    }
    peakSum += peak;
    peakCount++;
    if (peak > 0.97) clipCount++;
    return Math.min(1, peak * 1.8);
  }

  // 直近の入力音量の傾向を返して、貯めた統計をリセットする
  function takeStats() {
    if (!peakCount) return null;
    const stats = {
      samples: peakCount,
      avgPeak: peakSum / peakCount,
      clipRatio: clipCount / peakCount
    };
    peakSum = 0;
    peakCount = 0;
    clipCount = 0;
    return stats;
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

  return {
    start, stop, pause, resume, level, takeStats, cleanup, appliedSettings,
    get active() { return Boolean(recorder); }
  };
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
