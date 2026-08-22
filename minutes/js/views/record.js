// 録音画面。
// このアプリの本体は「確実に録れること」。録音を最優先で開始し、
// ライブ文字起こしは設定で有効にしたときだけ、録音の邪魔をしない範囲で試す。
// (多くの Android 端末はマイクを1つの用途にしか渡せないため、
//  録音中は認識が動かないことがある。その場合も録音は止めない)
import {
  el, clear, fmtClock, fmtDate, toast, haptic, confirmDialog, openSheet, closeSheet, uid, copyText
} from '../util.js';
import { icon } from '../icons.js';
import { newMinute, putMinute, getMinute, putAudio, loadSettings, storageEstimate } from '../db.js';
import { buildBody, formatSegmentText } from '../format.js';
import { createRecognizer, isRecognitionSupported, messageFor } from '../recognizer.js';
import { createRecorder, createWakeLock, isRecordingSupported } from '../recorder.js';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

// 画面に残す行数の上限(長時間録音でも描画が重くならないように)
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
  let recorderActive = false;
  let liveOn = false;           // この録音でライブ文字起こしを試しているか

  const recorder = createRecorder();
  const wakeLock = createWakeLock();

  // 録音開始からの経過時間
  const now = () => elapsed + (tickFrom ? Date.now() - tickFrom : 0);

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
  const noticeBox = el('div', { class: 'trouble', role: 'status' });
  const noteList = el('div', { class: 'transcript', 'aria-live': 'polite' });
  const interimEl = el('p', { class: 'utt utt-interim' });
  const hint = el('p', { class: 'transcript-hint' });

  const primaryBtn = el('button', { class: 'rec-btn', type: 'button', onclick: onPrimary },
    el('span', { class: 'rec-btn-icon' }, icon('mic', { size: 30 })),
    el('span', { class: 'rec-btn-label' }, '録音開始')
  );
  const noteBtn = el('button', { class: 'btn btn-ghost', type: 'button', onclick: addTextSheet },
    icon('edit', { size: 18 }), el('span', {}, 'メモ'));
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
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'メモを追加', onclick: addTextSheet }, icon('edit'))
    ),
    el('main', { class: 'page page-record' },
      el('div', { class: 'rec-head' }, titleInput, kindSeg),
      el('div', { class: 'rec-stage' },
        statusChip,
        clock,
        el('div', { class: 'level' }, levelBar),
        micTip
      ),
      noticeBox,
      el('section', { class: 'transcript-wrap' }, hint, noteList, interimEl)
    ),
    el('div', { class: 'rec-bar' },
      el('div', { class: 'rec-bar-side' }, noteBtn),
      primaryBtn,
      el('div', { class: 'rec-bar-side' }, stopBtn)
    )
  );

  segments.forEach(paintSegment);
  updateHint();

  // ---- ライブ文字起こし(任意) ----
  const recognizer = createRecognizer({
    onFinal: (text, meta = {}) => {
      if (state !== 'recording' || !liveOn) return;
      addSegment({
        t: now(),
        text,
        c: meta.confidence ?? null,
        alts: meta.alternatives?.length ? meta.alternatives.slice(0, 2) : undefined
      });
    },
    onInterim: (text) => {
      interimEl.textContent = text;
      interimEl.classList.toggle('is-on', Boolean(text));
      if (text) scrollToEnd();
    },
    onStatus: () => { /* 録音の状態表示を上書きしない */ },
    onError: (code, message, opts = {}) => {
      // 文字起こしはあくまで補助。失敗しても録音は続ける
      if (opts.micBusy || opts.recoverable) return;
      showNotice(`ライブ文字起こしを停止しました(${message})。録音は続いています。`);
    }
  });

  // ---- 発言・メモの追加 ----
  function addSegment(seg) {
    const prev = segments[segments.length - 1];
    if (prev && !seg.manual && !prev.manual && seg.t - prev.t < 4000) {
      if (prev.text === seg.text || prev.text.includes(seg.text)) return;
    }
    segments.push(seg);
    paintSegment(seg);
    updateHint();
    autosave();
  }

  // ---- 操作 ----
  function onPrimary() {
    haptic(15);
    if (state === 'idle') return void start();
    if (state === 'recording') return onPause();
    if (state === 'paused') return resume();
    return undefined;
  }

  // 録音を最優先で開始する。文字起こしはそのあと
  async function start() {
    settings = loadSettings();
    clearNotice();

    if (!isRecordingSupported) {
      showNotice('このブラウザは録音に対応していません。メモの手入力はできます。', { fatal: true });
      beginTimekeeping();
      return;
    }

    try {
      audioMime = await recorder.start(settings.micMode);
      recorderActive = true;
    } catch {
      recorderActive = false;
      showNotice('マイクを使えませんでした。ブラウザの設定でマイクを許可してください。', { fatal: true });
      return;
    }

    beginTimekeeping();
    startMeter();
    startMicCheck();
    if (settings.keepAwake) wakeLock.request();
    void keepStorage();

    // ライブ文字起こしは任意。動かなくても録音は続く
    if (settings.liveTranscript) startLive();
  }

  function beginTimekeeping() {
    state = 'recording';
    tickFrom = Date.now();
    startTimer();
    setStatus('recording');
    syncButtons();
    if (!minute.startedAt || !existing) minute.startedAt = Date.now();
    autosave();
  }

  function startLive() {
    if (!isRecognitionSupported) {
      showNotice(`ライブ文字起こしは使えません(${messageFor('unsupported')})。録音は続きます。`);
      return;
    }
    liveOn = true;
    recognizer.start();
    // 動いていなければしばらくして知らせる(録音は止めない)
    setTimeout(() => {
      if (state !== 'recording' || !liveOn) return;
      const st = recognizer.stats;
      if (st.results === 0 && st.interims === 0) {
        showNotice('ライブ文字起こしは動いていません(この端末は録音中に認識できないようです)。録音は正常に続いています。');
      }
    }, 12000);
  }

  async function keepStorage() {
    try { await navigator.storage?.persist?.(); } catch { /* 対応していなくても続行 */ }
    storageEstimate().then((est) => {
      if (est?.quota && est.usage / est.quota > 0.9) {
        toast('端末の保存領域が少なくなっています。古い議事録の削除をおすすめします', { error: true });
      }
    }).catch(() => { /* 取得できなくても録音は続ける */ });
  }

  function onPause() {
    if (state !== 'recording') return;
    accumulate();
    state = 'paused';
    recognizer.stop();
    recorder.pause();
    stopTimer();
    stopMicCheck();
    setMicTip('');
    setStatus('paused');
    syncButtons();
    saveNow();
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'recording';
    tickFrom = Date.now();
    recorder.resume();
    startTimer();
    if (recorderActive) startMicCheck();
    if (liveOn) recognizer.start();
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

    if (!segments.length && !wasActive && !blob) {
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
        if (!silent) toast('音声の保存に失敗しました', { error: true });
      }
    }
    saved = true;
    state = 'idle';
    if (!silent) toast('録音を保存しました');
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
      durationMs: now(),
      hasAudio: minute.hasAudio || false,
      audioMime,
      draft: !final
    };
    Object.assign(minute, record);
    return putMinute(record);
  }

  // ---- 自動保存(件数が増えるほど間隔を伸ばす) ----
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
    if (segments.length && !saved) await finish(false);
    location.hash = '#/';
  }

  // ---- 表示 ----
  function uttNode(seg) {
    const text = seg.manual
      ? seg.text
      : formatSegmentText(seg.text, settings.lineLen, { terms: settings.terms, fillers: settings.fillers });
    if (!text) return null;
    const uncertain = settings.markUncertain && seg.c != null && seg.c > 0 && seg.c < LOW_CONFIDENCE;
    return el('p', { class: `utt ${seg.manual ? 'is-note' : ''} ${uncertain ? 'is-uncertain' : ''}` },
      el('span', { class: 'utt-time' }, fmtClock(seg.t)),
      el('span', { class: 'utt-text' }, text)
    );
  }

  function paintSegment(seg) {
    const node = uttNode(seg);
    if (!node) return;
    noteList.append(node);
    while (noteList.childElementCount > MAX_VISIBLE) {
      noteList.firstElementChild.remove();
      trimmedCount++;
    }
    scrollToEnd();
  }

  function scrollToEnd() {
    const wrap = noteList.parentElement;
    if (!wrap) return;
    const nearBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 120;
    if (nearBottom) wrap.scrollTop = wrap.scrollHeight;
  }

  function updateHint() {
    if (trimmedCount) {
      hint.textContent = `※ 画面には直近のぶんだけ表示しています(全${segments.length}件は保存済み)`;
      hint.style.display = '';
      return;
    }
    hint.style.display = segments.length ? 'none' : '';
    hint.textContent = settings.liveTranscript
      ? '録音した内容は端末内に保存されます。認識できた発言と、追加したメモがここに並びます。'
      : '録音した内容は端末内に保存されます。気づいたことは「メモ」で時刻つきに残せます。';
  }

  const STATUS = {
    idle: ['待機中', ''],
    recording: ['録音中', 'is-rec'],
    paused: ['一時停止', 'is-pause'],
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
    stopBtn.disabled = !(rec || paused);
  }

  function accumulate() {
    if (tickFrom) elapsed += Date.now() - tickFrom;
    tickFrom = 0;
  }

  function startTimer() {
    stopTimer();
    timerId = setInterval(() => { clock.textContent = fmtClock(now()); }, 250);
  }

  function stopTimer() {
    clearInterval(timerId);
    timerId = null;
    clock.textContent = fmtClock(now());
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

  // 入力音量を見て、うまく拾えていないときに置き方を案内する
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

  function showNotice(message, { fatal = false } = {}) {
    if (noticeBox.dataset.message === message) return;
    noticeBox.dataset.message = message;
    noticeBox.replaceChildren(el('span', {}, message));
    noticeBox.classList.add('is-on');
    noticeBox.classList.toggle('is-fatal', fatal);
  }

  function clearNotice() {
    noticeBox.classList.remove('is-on');
    noticeBox.replaceChildren();
    delete noticeBox.dataset.message;
  }

  // 録音中に気づいたことを、時刻つきのメモとして残す
  function addTextSheet() {
    const ta = el('textarea', { class: 'textarea', rows: 4, placeholder: '決まったこと、気づいたこと、発言のメモ' });
    const at = now();
    const add = () => {
      const text = ta.value.trim();
      if (!text) return;
      addSegment({ t: at, text, manual: true });
      closeSheet();
      toast('メモを追加しました');
    };
    openSheet(`メモを追加 (${fmtClock(at)})`,
      el('div', { class: 'sheet-body' },
        el('p', { class: 'field-help' }, '録音中のこの時刻に紐づけて保存します。あとから聞き返すときの目印になります。'),
        ta,
        el('div', { class: 'sheet-btns' },
          el('button', { class: 'btn btn-ghost', type: 'button', onclick: closeSheet }, 'キャンセル'),
          el('button', { class: 'btn btn-primary', type: 'button', onclick: add }, '追加')
        )
      )
    );
    setTimeout(() => ta.focus(), 80);
  }

  // 画面が戻ったときに認識が落ちていたら起こす(録音は影響を受けない)
  const onVisible = () => {
    if (document.visibilityState !== 'visible' || state !== 'recording') return;
    if (liveOn) recognizer.kick();
    if (settings.keepAwake) wakeLock.request();
  };
  document.addEventListener('visibilitychange', onVisible);

  const onBeforeUnload = (e) => {
    if (state === 'recording' || state === 'paused') { e.preventDefault(); e.returnValue = ''; }
  };
  window.addEventListener('beforeunload', onBeforeUnload);

  titleInput.addEventListener('input', () => { if (segments.length || recorderActive) autosave(); });
  syncButtons();

  // 画面を離れるときは録音を止めて保存する
  return async () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('beforeunload', onBeforeUnload);
    stopTimer();
    stopMeter();
    stopMicCheck();
    recognizer.stop();
    wakeLock.release();
    if (!saved && (state === 'recording' || state === 'paused' || segments.length || recorderActive)) {
      await finish(false, { silent: true });
    } else {
      recorder.cleanup();
    }
  };
}
