// Web Speech API のラッパー。
// ブラウザの音声認識は数十秒〜数分で勝手に終了するため、
// 録音中は自動で再開し続けて長時間の講演・会議に耐えられるようにする。

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

export const isRecognitionSupported = Boolean(SR);

// 復帰不能なエラー(ユーザーに知らせて停止する)
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']);

export function createRecognizer({
  lang = 'ja-JP',
  onFinal = () => {},
  onInterim = () => {},
  onError = () => {},
  onStatus = () => {}
} = {}) {
  let rec = null;
  let wanted = false;       // 動かし続けたい状態か
  let starting = false;
  let restartTimer = null;
  let backoff = 300;
  let lastResultAt = 0;

  function build() {
    const r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onstart = () => {
      starting = false;
      backoff = 300;
      onStatus('listening');
    };

    r.onresult = (event) => {
      lastResultAt = Date.now();
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript || '';
        if (result.isFinal) {
          const trimmed = text.trim();
          if (trimmed) onFinal(trimmed, result[0]?.confidence ?? null);
        } else {
          interim += text;
        }
      }
      onInterim(interim.trim());
    };

    r.onerror = (event) => {
      const code = event.error;
      if (code === 'no-speech' || code === 'aborted') return; // 無音・自動停止は通常運転
      if (FATAL.has(code)) {
        wanted = false;
        onStatus('stopped');
        onError(code, messageFor(code));
        return;
      }
      // network など一時的な失敗は間隔を空けて再開する
      backoff = Math.min(backoff * 2, 8000);
      onError(code, messageFor(code), { recoverable: true });
    };

    r.onend = () => {
      starting = false;
      onInterim('');
      if (!wanted) { onStatus('stopped'); return; }
      onStatus('restarting');
      scheduleStart();
    };

    return r;
  }

  function scheduleStart() {
    clearTimeout(restartTimer);
    restartTimer = setTimeout(startNow, backoff);
  }

  function startNow() {
    if (!wanted || starting) return;
    starting = true;
    try {
      rec = rec || build();
      rec.start();
    } catch (err) {
      starting = false;
      // すでに開始済みの場合は InvalidStateError が飛ぶので、少し待って再試行
      if (String(err?.name) === 'InvalidStateError') {
        backoff = Math.min(backoff * 2, 8000);
        scheduleStart();
      } else {
        wanted = false;
        onError('start-failed', '音声認識を開始できませんでした');
      }
    }
  }

  return {
    start() {
      if (!SR) { onError('unsupported', messageFor('unsupported')); return false; }
      wanted = true;
      backoff = 300;
      startNow();
      return true;
    },
    stop() {
      wanted = false;
      clearTimeout(restartTimer);
      try { rec?.stop(); } catch { /* すでに停止している */ }
      onInterim('');
      onStatus('stopped');
    },
    // 端末がスリープ等で認識を落としたまま戻らないときの復帰用
    kick() {
      if (!wanted) return;
      if (Date.now() - lastResultAt < 5000) return;
      try { rec?.stop(); } catch { /* onend 側で再開する */ }
    },
    get running() { return wanted; }
  };
}

export function messageFor(code) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'マイクの使用が許可されていません。ブラウザの設定でマイクを許可してください';
    case 'audio-capture':
      return 'マイクが見つかりません。他のアプリが使用していないか確認してください';
    case 'network':
      return 'ネットワークエラーで認識が中断しました。通信状況を確認してください';
    case 'language-not-supported':
      return 'この端末では日本語の音声認識に対応していません';
    case 'unsupported':
      return 'このブラウザは音声認識に対応していません。Android は Chrome、iPhone は Safari をお試しください';
    default:
      return `音声認識でエラーが発生しました (${code})`;
  }
}
