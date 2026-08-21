// 録音画面: マイクの音声をその場で文字にして貯めていく。
// 録音時間に上限はない。長時間でも重くならないよう、表示の行数と自動保存の頻度を調整する。
import {
  el, clear, fmtClock, fmtDate, toast, haptic, confirmDialog, openSheet, closeSheet, uid, copyText
} from '../util.js';
import { icon } from '../icons.js';
import { newMinute, putMinute, getMinute, putAudio, loadSettings, storageEstimate } from '../db.js';
import { buildBody, formatSegmentText } from '../format.js';
import { createRecognizer, isRecognitionSupported, messageFor } from '../recognizer.js';
import { createRecorder, createWakeLock, isRecordingSupported } from '../recorder.js';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

// 画面に残す発言の最大数(長時間録音でも描画が重くならないように)
const MAX_VISIBLE = 300;
// 入力音量を見直す間隔
const MIC_CHECK_MS = 15000;
// この確信度を下回る認識結果には印をつける
const LOW_CONFIDENCE = 0.6;

function defaultTitle(kind) {
  const d = new Date();
  return `${fmtDate(d.getTime())}(${WEEK[d.getDay()]}) の${kind === 'lecture' ? '講演' : '会議'}`;
}

export async function renderRecord(root, draftId) {
  let settings = loadSettings();
  const existing = draftId ? await getMinute(draftId) : null;

  const minute = existing || newMinute({ id: uid(), title: '' });
  const segments = minute.segments ? [...minute.segments] : [];

  let state = 'idle';           // idle | recording | paused | saving
  let elapsed = minute.durationMs || 0;
  let tickFrom = 0;
  let timerId = null;
  let meterId = null;
  let micCheckId = null;
  let saved = false;
  let audioMime = minute.audioMime || '';
  let trimmedCount = 0;
  let watchdogId = null;
  let recStartedAt = 0;
  let fallbackTried = false;

  const recorder = createRecorder();
  const wakeLock = createWakeLock();
  let recorderActive = false;
  let micRetried = false;

  // ---- DOM ----
  const titleInput = el('input', {
    class: 'title-input',
    type: 'text',
    value: minute.title || '',
    placeholder: defaultTitle(minute.kind),
    'aria-label': 'タイトル',
    maxlength: 80
  });

  const clock = el('div', { class: 'clock' }, fmtClock(elapsed));
  const statusChip = el('div', { class: 'status-chip' }, el('span', { class: 'status-dot' }), el('span', { class: 'status-text' }, '待機中'));
  const levelBar = el('span', { class: 'level-fill' });
  const micTip = el('p', { class: 'mic-tip' });
  const troubleBox = el('div', { class: 'trouble', role: 'status' });
  const transcript = el('div', { class: 'transcript', 'aria-live': 'polite' });
  const interimEl = el('p', { class: 'utt utt-interim' });
  const hint = el('p', { class: 'transcript-hint' }, isRecognitionSupported
    ? '「録音開始」を押して話しはじめてください。認識した内容がここに流れます。'
    : 'このブラウザは音声認識に未対応です。「テキストを追加」から手入力できます。');

  const primaryBtn = el('button', { class: 'rec-btn', type: 'button', onclick: onPrimary },
    el('span', { class: 'rec-btn-icon' }, icon('mic', { size: 30 })),
    el('span', { class: 'rec-btn-label' }, '録音開始')
  );
  const pauseBtn = el('button', { class: 'btn btn-ghost', type: 'button', disabled: true, onclick: onPause },
    icon('pause', { size: 18 }), el('span', {}, '一時停止'));
  const stopBtn = el('button', { class: 'btn btn-primary', type: 'button', disabled: true, onclick: () => finish(true) },
    icon('stop', { size: 18 }), el('span', {}, '終了して保存'));

  const kindSeg = el('div', { class: 'seg seg-kind' });
  [['meeting', '会議'], ['lecture', '講演']].forEach(([value, label]) => {
    const b = el('button', {
      class: `seg-btn ${minute.kind === value ? 'is-on' : ''}`,
      type: 'button',
      onclick: () => {
        minute.kind = value;
        kindSeg.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('is-on'));
        b.classList.add('is-on');
        titleInput.placeholder = defaultTitle(value);
      }
    }, label);
    kindSeg.append(b);
  });

  root.append(
    el('header', { class: 'appbar appbar-sub' },
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'もどる', onclick: back }, icon('back')),
      el('div', { class: 'appbar-main' }, el('h1', { class: 'appbar-title sm' }, '録音')),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'テキストを追加', onclick: addTextSheet }, icon('edit'))
    ),
    el('main', { class: 'page page-record' },
      el('div', { class: 'rec-head' }, titleInput, kindSeg),
      el('div', { class: 'rec-stage' },
        statusChip,
        clock,
        el('div', { class: 'level' }, levelBar),
        micTip
      ),
      troubleBox,
      el('section', { class: 'transcript-wrap' }, hint, transcript, interimEl)
    ),
    el('div', { class: 'rec-bar' },
      el('div', { class: 'rec-bar-side' }, pauseBtn),
      primaryBtn,
      el('div', { class: 'rec-bar-side' }, stopBtn)
    )
  );

  segments.forEach(paintSegment);
  updateHint();

  // ---- 音声認識 ----
  const recognizer = createRecognizer({
    onFinal: (text, meta = {}) => {
      if (state !== 'recording') return;
      addSegment({
        t: elapsed + (tickFrom ? Date.now() - tickFrom : 0),
        text,
        c: meta.confidence ?? null,
        alts: meta.alternatives?.length ? meta.alternatives.slice(0, 2) : undefined,
        r: meta.recovered || undefined
      });
    },
    onInterim: (text) => {
      interimEl.textContent = text;
      interimEl.classList.toggle('is-on', Boolean(text));
      if (text) scrollToEnd();
    },
    onStatus: (s) => {
      if (state === 'recording') setStatus(s === 'listening' ? 'recording' : 'reconnecting');
    },
    onError: (code, message, opts = {}) => {
      // マイクが掴めない場合は、録音より文字起こしを優先して録音側を手放す
      if (opts.micBusy) {
        if (recorderActive && !micRetried) {
          micRetried = true;
          recorderActive = false;
          recorder.cleanup();
          stopMeter();
          toast('マイクを認識側にゆずりました(音声の保存は中止します)', { error: true });
          recognizer.restart();
          return;
        }
        toast(message, { error: true });
        return;
      }
      if (opts.recoverable) { toast(message, { error: true }); return; }
      toast(message, { error: true });
      if (state === 'recording' || state === 'paused') finish(false, { silent: true });
    }
  });

  // ---- 発言の追加 ----
  // 認識の再開をまたぐと同じ言葉が二重に届くことがあるので、重なりを畳んでから積む
  function addSegment(seg) {
    const prev = segments[segments.length - 1];
    if (prev && seg.t - prev.t < 4000) {
      if (prev.text === seg.text) return;
      if (seg.text.startsWith(prev.text) && prev.r) {
        // 取りこぼし救済ぶんが、あとから正式な認識結果で置き換わった
        Object.assign(prev, seg, { t: prev.t });
        repaintLast(prev);
        autosave();
        return;
      }
      if (prev.text.includes(seg.text)) return;
    }
    segments.push(seg);
    paintSegment(seg);
    updateHint();
    autosave();
  }

  // ---- 操作 ----
  function onPrimary() {
    haptic(15);
    if (state === 'idle') return start();
    if (state === 'recording') return onPause();
    if (state === 'paused') return resume();
    return undefined;
  }

  // 重要: 音声認識の開始は「ユーザーが押した操作と同じ実行の流れ」で呼ぶ。
  // await をひとつでもはさむとブラウザがユーザー操作と認めず、
  // 許可も求めないまま無言で失敗する(録音だけ成功して文字起こしが空になる)。
  function start() {
    settings = loadSettings();
    recStartedAt = Date.now();
    fallbackTried = false;
    clearTrouble();

    if (isRecognitionSupported) {
      recognizer.start();
    } else {
      showTrouble(messageFor('unsupported'), { fatal: true });
    }

    state = 'recording';
    tickFrom = Date.now();
    startTimer();
    startWatchdog();
    setStatus('recording');
    syncButtons();
    if (!minute.startedAt || !existing) minute.startedAt = Date.now();
    autosave();

    // 録音・画面ロック・保存領域の確認は、認識を始めたあとで進める
    void startAudio();
  }

  async function startAudio() {
    if (settings.keepAwake) wakeLock.request();
    try { await navigator.storage?.persist?.(); } catch { /* 対応していなくても続行 */ }
    warnIfStorageTight();
    if (!settings.saveAudio || !isRecordingSupported) return;
    if (state !== 'recording') return;
    try {
      audioMime = await recorder.start(settings.micMode);
      recorderActive = true;
      startMeter();
      startMicCheck();
    } catch {
      recorderActive = false;
      toast('音声の保存は使えません(文字起こしは続けます)', { error: true });
    }
  }

  function onPause() {
    if (state !== 'recording') return;
    accumulate();
    state = 'paused';
    recognizer.stop();
    recorder.pause();
    stopTimer();
    stopWatchdog();
    stopMicCheck();
    micTip.textContent = '';
    setStatus('paused');
    syncButtons();
    saveNow();
  }

  function resume() {
    if (state !== 'paused') return;
    // ここでも認識の開始を最初に(ユーザー操作と同じ流れで)行う
    if (isRecognitionSupported) recognizer.start();
    state = 'recording';
    tickFrom = Date.now();
    recStartedAt = Date.now();
    recorder.resume();
    startTimer();
    startWatchdog();
    if (recorderActive) startMicCheck();
    setStatus('recording');
    syncButtons();
  }

  // 録音を終えて保存する
  async function finish(goDetail, { silent = false } = {}) {
    if (state === 'saving') return;
    if (state === 'recording') accumulate();
    const wasActive = state !== 'idle';
    state = 'saving';
    syncButtons();
    setStatus('saving');
    stopTimer();
    stopMeter();
    stopMicCheck();
    stopWatchdog();
    recognizer.stop();
    wakeLock.release();
    cancelAutosave();

    let blob = null;
    if (recorderActive) {
      try { blob = await recorder.stop(); } catch { blob = null; }
      recorderActive = false;
    } else {
      recorder.cleanup();
    }

    if (!segments.length && !wasActive) {
      // 何も録れていないので保存しない
      saved = true;
      if (goDetail) location.hash = '#/';
      return;
    }

    const record = await persist({ final: true });
    if (blob && blob.size > 0) {
      try {
        await putAudio(record.id, blob);
        await putMinute({ ...record, hasAudio: true, audioMime: blob.type || audioMime });
      } catch {
        if (!silent) toast('音声の保存に失敗しました(本文は保存済みです)', { error: true });
      }
    }
    saved = true;
    state = 'idle';
    if (!silent) toast('議事録を保存しました');
    if (goDetail) location.hash = `#/m/${record.id}`;
  }

  async function persist({ final = false } = {}) {
    const s = loadSettings();
    const body = buildBody(segments, {
      max: s.lineLen, timestamps: s.timestamps, terms: s.terms, fillers: s.fillers
    });
    const record = {
      ...minute,
      title: titleInput.value.trim() || defaultTitle(minute.kind),
      segments,
      body,
      durationMs: elapsed + (tickFrom ? Date.now() - tickFrom : 0),
      hasAudio: minute.hasAudio || false,
      audioMime,
      draft: !final
    };
    Object.assign(minute, record);
    return putMinute(record);
  }

  // ---- 自動保存 ----
  // 発言が増えるほど1回の保存が重くなるので、間隔を伸ばしていく
  let saveTimer = null;
  let lastSaveAt = 0;

  function saveInterval() {
    if (segments.length > 400) return 30000;
    if (segments.length > 150) return 15000;
    return 5000;
  }

  function autosave() {
    if (saveTimer) return;
    const wait = Math.max(0, saveInterval() - (Date.now() - lastSaveAt));
    saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, wait);
  }

  function saveNow() {
    lastSaveAt = Date.now();
    persist().catch(() => { /* 次の保存で取り返す */ });
  }

  function cancelAutosave() {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  async function back() {
    if (state === 'recording' || state === 'paused') {
      const ok = await confirmDialog('録音を終了して保存しますか?', {
        okText: '終了して保存', cancelText: '録音を続ける'
      });
      if (!ok) return;
      await finish(false);
      location.hash = '#/';
      return;
    }
    if (segments.length && !saved) { await finish(false); }
    location.hash = '#/';
  }

  // ---- 表示の更新 ----
  function uttNode(seg) {
    const text = formatSegmentText(seg.text, settings.lineLen, {
      terms: settings.terms, fillers: settings.fillers
    });
    if (!text) return null;
    const uncertain = settings.markUncertain && seg.c != null && seg.c > 0 && seg.c < LOW_CONFIDENCE;
    return el('p', { class: `utt ${uncertain || seg.r ? 'is-uncertain' : ''}` },
      settings.timestamps ? el('span', { class: 'utt-time' }, fmtClock(seg.t)) : null,
      el('span', { class: 'utt-text' }, text)
    );
  }

  function paintSegment(seg) {
    const node = uttNode(seg);
    if (!node) return;
    transcript.append(node);
    // 古い行は画面から外す(データは残る)
    while (transcript.childElementCount > MAX_VISIBLE) {
      transcript.firstElementChild.remove();
      trimmedCount++;
    }
    if (trimmedCount) hint.textContent = `※ 画面には直近の発言のみ表示しています(全${segments.length}件は保存済み)`;
    hint.style.display = trimmedCount ? '' : 'none';
    scrollToEnd();
  }

  function repaintLast(seg) {
    const node = uttNode(seg);
    if (!node) return;
    if (transcript.lastElementChild) transcript.lastElementChild.replaceWith(node);
    else transcript.append(node);
    scrollToEnd();
  }

  function scrollToEnd() {
    const wrap = transcript.parentElement;
    if (!wrap) return;
    const nearBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 120;
    if (nearBottom) wrap.scrollTop = wrap.scrollHeight;
  }

  function updateHint() {
    if (trimmedCount) return;
    hint.style.display = segments.length ? 'none' : '';
  }

  const STATUS = {
    idle: ['待機中', ''],
    recording: ['録音中', 'is-rec'],
    paused: ['一時停止', 'is-pause'],
    reconnecting: ['認識を再開しています', 'is-wait'],
    saving: ['保存中', 'is-wait']
  };

  function setStatus(key) {
    const [text, cls] = STATUS[key] || STATUS.idle;
    statusChip.className = `status-chip ${cls}`;
    statusChip.querySelector('.status-text').textContent = text;
  }

  function syncButtons() {
    const rec = state === 'recording';
    const paused = state === 'paused';
    primaryBtn.classList.toggle('is-rec', rec);
    clear(primaryBtn).append(
      el('span', { class: 'rec-btn-icon' }, icon(rec ? 'pause' : 'mic', { size: 30 })),
      el('span', { class: 'rec-btn-label' }, rec ? '一時停止' : paused ? '再開' : '録音開始')
    );
    primaryBtn.disabled = state === 'saving';
    pauseBtn.disabled = !rec;
    stopBtn.disabled = !(rec || paused);
  }

  function accumulate() {
    if (tickFrom) elapsed += Date.now() - tickFrom;
    tickFrom = 0;
  }

  function startTimer() {
    stopTimer();
    timerId = setInterval(() => {
      const now = elapsed + (tickFrom ? Date.now() - tickFrom : 0);
      clock.textContent = fmtClock(now);
    }, 250);
  }

  function stopTimer() {
    clearInterval(timerId);
    timerId = null;
    clock.textContent = fmtClock(elapsed + (tickFrom ? Date.now() - tickFrom : 0));
  }

  function startMeter() {
    stopMeter();
    const loop = () => {
      const v = state === 'recording' ? recorder.level() : 0;
      levelBar.style.width = `${Math.round(v * 100)}%`;
      meterId = requestAnimationFrame(loop);
    };
    meterId = requestAnimationFrame(loop);
  }

  function stopMeter() {
    if (meterId) cancelAnimationFrame(meterId);
    meterId = null;
    levelBar.style.width = '0%';
  }

  // ---- 文字起こしが動いていないときの検知 ----
  // 録音はできているのに認識結果が1つも来ない場合を拾って、原因と対処を出す
  function startWatchdog() {
    stopWatchdog();
    watchdogId = setInterval(() => {
      if (state !== 'recording') return;
      const st = recognizer.stats;
      if (st.results > 0 || st.interims > 0) { clearTrouble(); return; }

      const waited = Date.now() - recStartedAt;

      // 認識が一度も始まっていない = 開始を拒否されている
      if (waited > 5000 && st.started === 0) {
        showTrouble(isStandaloneIOS()
          ? 'ホーム画面から開いたアプリでは、iPhone の音声認識が動かないことがあります。Safari で開き直してお試しください。'
          : '音声認識が開始できていません。マイクの許可と通信状態を確認して、録音を一度止めてから始め直してください。');
        return;
      }
      // 録音がマイクを占有しているせいで認識できていない可能性 → 録音側を手放す
      if (waited > 10000 && recorderActive && !fallbackTried) {
        fallbackTried = true;
        dropRecorder();
        recognizer.restart();
        showTrouble('文字起こしが始まらないため、音声の保存を止めて認識をやり直しています…');
        return;
      }
      if (waited > 22000) {
        showTrouble('音声は録れていますが、文字起こしができていません。通信状態を確認するか、設定の「音声も保存する」をオフにしてお試しください。');
      }
    }, 2000);
  }

  function stopWatchdog() {
    clearInterval(watchdogId);
    watchdogId = null;
  }

  // 録音(マイクの占有)だけをやめて、文字起こしを優先する
  function dropRecorder() {
    recorderActive = false;
    stopMeter();
    stopMicCheck();
    setMicTip('');
    try { recorder.cleanup(); } catch { /* 停止済み */ }
  }

  function isStandaloneIOS() {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone = navigator.standalone === true
      || window.matchMedia?.('(display-mode: standalone)').matches;
    return ios && standalone;
  }

  function showTrouble(message, { fatal = false } = {}) {
    if (troubleBox.dataset.message === message) return;
    troubleBox.dataset.message = message;
    troubleBox.replaceChildren(
      el('span', {}, message),
      el('button', { class: 'link-btn', type: 'button', onclick: openDiagnostics }, '認識の状態を見る')
    );
    troubleBox.classList.add('is-on');
    troubleBox.classList.toggle('is-fatal', fatal);
  }

  function clearTrouble() {
    if (!troubleBox.classList.contains('is-on')) return;
    troubleBox.classList.remove('is-on');
    troubleBox.replaceChildren();
    delete troubleBox.dataset.message;
  }

  // 端末側の状況をまとめて表示する(うまくいかないときの切り分け用)
  function diagnosticsText() {
    const st = recognizer.stats;
    const track = recorder.appliedSettings();
    return [
      `音声認識API: ${isRecognitionSupported ? 'あり' : 'なし'}`,
      `録音API: ${isRecordingSupported ? 'あり' : 'なし'}`,
      `開始要求: ${st.startCalls} / 実際に開始: ${st.started} / 終了: ${st.ends}`,
      `確定した認識: ${st.results} / 認識中テキスト: ${st.interims} / 無音終了: ${st.noSpeech}`,
      `直近のエラー: ${st.lastError || 'なし'}`,
      `音声の保存: ${recorderActive ? '実行中' : (settings.saveAudio ? '停止' : 'オフ')}`,
      `マイク設定: ${track ? JSON.stringify({ ec: track.echoCancellation, ns: track.noiseSuppression, agc: track.autoGainControl }) : '不明'}`,
      `通信: ${navigator.onLine ? 'オンライン' : 'オフライン'} / 安全な接続: ${window.isSecureContext ? 'はい' : 'いいえ'}`,
      `表示: ${isStandaloneIOS() ? 'ホーム画面のアプリ(iOS)' : 'ブラウザ'}`,
      `UA: ${navigator.userAgent}`
    ].join('\n');
  }

  async function openDiagnostics() {
    let mic = '不明';
    try { mic = (await navigator.permissions?.query?.({ name: 'microphone' }))?.state || '不明'; } catch { /* 未対応 */ }
    const text = `${diagnosticsText()}\nマイク許可: ${mic}`;
    openSheet('認識の状態',
      el('div', { class: 'sheet-body' },
        el('p', { class: 'field-help' }, '文字起こしがうまくいかないときは、この内容をそのまま伝えてください。'),
        el('pre', { class: 'diag' }, text),
        el('div', { class: 'sheet-btns' },
          el('button', { class: 'btn btn-ghost', type: 'button', onclick: closeSheet }, '閉じる'),
          el('button', {
            class: 'btn btn-primary',
            type: 'button',
            onclick: async () => {
              const ok = await copyText(text);
              toast(ok ? 'コピーしました' : 'コピーできませんでした', { error: !ok });
            }
          }, 'コピー')
        )
      )
    );
  }

  // 入力音量を見て、拾えていないときに置き方を案内する
  function startMicCheck() {
    stopMicCheck();
    if (!recorderActive) return;
    recorder.takeStats();
    micCheckId = setInterval(() => {
      if (state !== 'recording') return;
      const stats = recorder.takeStats();
      if (!stats || stats.samples < 30) return;
      if (stats.clipRatio > 0.2) {
        setMicTip('音が大きすぎます。端末を話者から少し離してください');
      } else if (stats.avgPeak < 0.035) {
        setMicTip(settings.micMode === 'far'
          ? '音が小さいようです。端末を話者に近づけてください'
          : '音が小さいようです。設定の「マイクの拾い方」を「遠くの声」にすると改善することがあります');
      } else {
        setMicTip('');
      }
    }, MIC_CHECK_MS);
  }

  function stopMicCheck() {
    clearInterval(micCheckId);
    micCheckId = null;
  }

  function setMicTip(text) {
    micTip.textContent = text;
    micTip.classList.toggle('is-on', Boolean(text));
  }

  function warnIfStorageTight() {
    storageEstimate().then((est) => {
      if (!est?.quota) return;
      if (est.usage / est.quota > 0.9) {
        toast('端末の保存領域が少なくなっています。古い議事録の削除をおすすめします', { error: true });
      }
    }).catch(() => { /* 取得できなくても録音は続ける */ });
  }

  // 手入力で発言を足す(認識できなかった部分の補完・未対応ブラウザ用)
  function addTextSheet() {
    const ta = el('textarea', { class: 'textarea', rows: 5, placeholder: '発言や補足を入力' });
    const add = () => {
      const text = ta.value.trim();
      if (!text) return;
      const seg = { t: elapsed + (tickFrom ? Date.now() - tickFrom : 0), text };
      segments.push(seg);
      paintSegment(seg);
      updateHint();
      autosave();
      closeSheet();
      toast('追加しました');
    };
    openSheet('テキストを追加',
      el('div', { class: 'sheet-body' },
        el('p', { class: 'field-help' }, '入力した内容も、句読点のタイミングで自動的に改行されます'),
        ta,
        el('div', { class: 'sheet-btns' },
          el('button', { class: 'btn btn-ghost', type: 'button', onclick: closeSheet }, 'キャンセル'),
          el('button', { class: 'btn btn-primary', type: 'button', onclick: add }, '追加')
        )
      )
    );
    setTimeout(() => ta.focus(), 80);
  }

  // 端末がスリープから戻ったときに認識が死んでいたら起こす
  const onVisible = () => {
    if (document.visibilityState === 'visible' && state === 'recording') {
      recognizer.kick();
      if (settings.keepAwake) wakeLock.request();
    }
  };
  document.addEventListener('visibilitychange', onVisible);

  const onBeforeUnload = (e) => {
    if (state === 'recording' || state === 'paused') { e.preventDefault(); e.returnValue = ''; }
  };
  window.addEventListener('beforeunload', onBeforeUnload);

  titleInput.addEventListener('input', () => { if (segments.length) autosave(); });
  syncButtons();

  // 画面を離れるときは録音を止めて保存する
  return async () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('beforeunload', onBeforeUnload);
    stopTimer();
    stopMeter();
    stopMicCheck();
    stopWatchdog();
    recognizer.stop();
    wakeLock.release();
    if (!saved && (state === 'recording' || state === 'paused' || segments.length)) {
      await finish(false, { silent: true });
    } else {
      recorder.cleanup();
    }
  };
}
