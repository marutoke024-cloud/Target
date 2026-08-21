// Web Speech API のラッパー。
// ブラウザの音声認識は数十秒〜数分で勝手に終了するため、録音中は自動で再開し続けて
// 長時間の講演・会議に耐えられるようにする。
// 取りこぼしを減らすため、
//   - 再開の待ち時間をできるだけ短くする
//   - 確定しないまま終了した認識中テキストを拾い上げる
//   - 候補(alternatives)と確信度を残し、あとで確認・補正できるようにする

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

export const isRecognitionSupported = Boolean(SR);

// 復帰不能なエラー(ユーザーに知らせて停止する)
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'language-not-supported']);

// 再開までの最短待ち時間。短いほど取りこぼしが減る
const QUICK_RESTART_MS = 80;
// 確定しなかった認識中テキストを救う下限の長さ
const MIN_RECOVER_LEN = 3;

export function createRecognizer({
  lang = 'ja-JP',
  alternatives = 3,
  onFinal = () => {},
  onInterim = () => {},
  onError = () => {},
  onStatus = () => {}
} = {}) {
  let rec = null;
  let wanted = false;
  let starting = false;
  let restartTimer = null;
  let backoff = QUICK_RESTART_MS;
  let lastResultAt = 0;
  let pendingInterim = '';

  function build() {
    const r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = Math.max(1, alternatives);

    r.onstart = () => {
      starting = false;
      backoff = QUICK_RESTART_MS;
      onStatus('listening');
    };

    r.onresult = (event) => {
      lastResultAt = Date.now();
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const best = result[0];
        const text = (best?.transcript || '').trim();
        if (result.isFinal) {
          pendingInterim = '';
          if (text) {
            onFinal(text, {
              confidence: typeof best?.confidence === 'number' ? best.confidence : null,
              alternatives: collectAlternatives(result)
            });
          }
        } else {
          interim += best?.transcript || '';
        }
      }
      pendingInterim = interim.trim();
      onInterim(pendingInterim);
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
      if (code === 'audio-capture') {
        // マイクが掴めない。呼び出し側で録音を止めるなどして復帰できる場合がある
        onError(code, messageFor(code), { micBusy: true });
        backoff = Math.min(Math.max(backoff, 500) * 2, 8000);
        return;
      }
      // network など一時的な失敗は間隔を空けて再開する
      backoff = Math.min(Math.max(backoff, 500) * 2, 8000);
      onError(code, messageFor(code), { recoverable: true });
    };

    r.onend = () => {
      starting = false;
      // 確定しないまま切れた分を取りこぼさない
      const leftover = pendingInterim.trim();
      pendingInterim = '';
      if (leftover.length >= MIN_RECOVER_LEN) {
        onFinal(leftover, { confidence: 0, alternatives: [], recovered: true });
      }
      onInterim('');
      if (!wanted) { onStatus('stopped'); return; }
      onStatus('restarting');
      scheduleStart();
    };

    return r;
  }

  function collectAlternatives(result) {
    const out = [];
    for (let i = 1; i < result.length && i < 4; i++) {
      const t = (result[i]?.transcript || '').trim();
      if (t && !out.includes(t)) out.push(t);
    }
    return out;
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
        backoff = Math.min(Math.max(backoff, 300) * 2, 8000);
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
      backoff = QUICK_RESTART_MS;
      startNow();
      return true;
    },
    stop() {
      wanted = false;
      clearTimeout(restartTimer);
      try { rec?.stop(); } catch { /* すでに停止している */ }
      pendingInterim = '';
      onInterim('');
      onStatus('stopped');
    },
    // 端末がスリープ等で認識を落としたまま戻らないときの復帰用
    kick() {
      if (!wanted) return;
      if (Date.now() - lastResultAt < 5000) return;
      try { rec?.stop(); } catch { /* onend 側で再開する */ }
    },
    // 認識器を作り直して即座に再開する(マイクを掴み直したいとき)
    restart() {
      if (!wanted) return;
      try { rec?.abort?.(); } catch { /* 破棄済み */ }
      rec = null;
      starting = false;
      backoff = QUICK_RESTART_MS;
      scheduleStart();
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
      return 'マイクを取得できませんでした。他のアプリが使用していないか確認してください';
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
