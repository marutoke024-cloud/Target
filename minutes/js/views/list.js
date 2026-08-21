// 一覧画面: 保存済みの議事録を新しい順に表示する
import { el, clear, fmtRelative, fmtDuration, openSheet, closeSheet, toast, haptic, confirmDialog, copyText } from '../util.js';
import { icon } from '../icons.js';
import { listMinutes, loadSettings, saveSettings, storageEstimate } from '../db.js';
import { LINE_PRESETS, countChars } from '../format.js';
import { fmtBytes, isRecordingSupported, MIC_MODES } from '../recorder.js';
import { isRecognitionSupported, createRecognizer } from '../recognizer.js';
import { THEMES, loadTheme, saveTheme } from '../theme.js';

const LINE_OPTIONS = [
  { value: LINE_PRESETS.short, label: '短め', hint: `${LINE_PRESETS.short}文字` },
  { value: LINE_PRESETS.normal, label: '標準', hint: `${LINE_PRESETS.normal}文字` },
  { value: LINE_PRESETS.long, label: '長め', hint: `${LINE_PRESETS.long}文字` }
];

export async function renderList(root) {
  const minutes = await listMinutes();
  let keyword = '';

  const listBox = el('div', { class: 'list' });

  const search = el('input', {
    class: 'search-input',
    type: 'search',
    placeholder: 'タイトル・本文を検索',
    'aria-label': '検索',
    oninput: (e) => { keyword = e.target.value.trim(); paint(); }
  });

  const nodes = [
    el('header', { class: 'appbar' },
      el('div', { class: 'appbar-main' },
        el('h1', { class: 'appbar-title' }, '議事録'),
        el('p', { class: 'appbar-desc' }, '録音して、文字起こしして、Claudeへ')
      ),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': '設定', onclick: openSettings }, icon('settings'))
    ),
    el('div', { class: 'search-wrap' }, icon('search', { size: 18, cls: 'search-icon' }), search),
    supportNotice(),
    el('main', { class: 'page' }, listBox),
    el('a', { class: 'fab', href: '#/rec', onclick: () => haptic() }, icon('mic', { size: 24 }), el('span', {}, '録音を開始'))
  ];
  root.append(...nodes.filter(Boolean));

  function paint() {
    clear(listBox);
    const rows = keyword
      ? minutes.filter((m) => `${m.title} ${m.body} ${m.participants}`.toLowerCase().includes(keyword.toLowerCase()))
      : minutes;

    if (!rows.length) {
      listBox.append(keyword ? emptySearch(keyword) : emptyState());
      return;
    }
    listBox.append(el('p', { class: 'list-count' }, `${rows.length}件`));
    for (const m of rows) listBox.append(card(m));
  }

  paint();
  return null;
}

function card(m) {
  const preview = (m.body || '').split('\n').filter(Boolean).slice(0, 2).join(' ');
  return el('a', { class: 'card', href: `#/m/${m.id}` },
    el('div', { class: 'card-head' },
      el('h2', { class: 'card-title' }, m.title || '無題の議事録'),
      m.hasAudio ? el('span', { class: 'chip chip-audio', title: '音声あり' }, icon('wave', { size: 14 })) : null
    ),
    el('p', { class: 'card-meta' },
      el('span', {}, fmtRelative(m.startedAt)),
      m.durationMs ? el('span', { class: 'dot' }, '·') : null,
      m.durationMs ? el('span', {}, fmtDuration(m.durationMs)) : null,
      el('span', { class: 'dot' }, '·'),
      el('span', {}, `${countChars(m.body)}字`)
    ),
    preview ? el('p', { class: 'card-preview' }, preview) : el('p', { class: 'card-preview is-empty' }, '(本文なし)')
  );
}

function emptyState() {
  return el('div', { class: 'empty' },
    el('div', { class: 'empty-icon' }, icon('mic', { size: 30 })),
    el('h2', {}, 'まだ議事録がありません'),
    el('p', {}, '下の「録音を開始」を押すと、話した内容がその場で文字になります。'),
    el('ul', { class: 'empty-tips' },
      el('li', {}, 'マイクは端末に近いほど精度が上がります'),
      el('li', {}, '文字起こしはあとから自由に編集できます'),
      el('li', {}, '完成した議事録はワンタップで Claude に渡せます')
    )
  );
}

function emptySearch(keyword) {
  return el('div', { class: 'empty' },
    el('h2', {}, '見つかりませんでした'),
    el('p', {}, `「${keyword}」に一致する議事録はありません。`)
  );
}

function supportNotice() {
  if (isRecognitionSupported) return null;
  return el('div', { class: 'notice notice-warn' },
    el('strong', {}, 'このブラウザは音声認識に未対応です'),
    el('span', {}, 'Android は Chrome、iPhone は Safari でお試しください。手入力での議事録作成は可能です。')
  );
}

// 選択式の設定行(共通)
function segmented(options, current, onPick) {
  const row = el('div', { class: 'seg' });
  options.forEach((opt) => {
    const btn = el('button', {
      class: `seg-btn ${current === opt.value ? 'is-on' : ''}`,
      type: 'button',
      onclick: () => {
        row.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('is-on'));
        btn.classList.add('is-on');
        onPick(opt);
      }
    },
    el('span', { class: 'seg-label' }, opt.label),
    opt.hint ? el('span', { class: 'seg-hint' }, opt.hint) : null);
    row.append(btn);
  });
  return row;
}

async function openSettings() {
  const s = loadSettings();
  const est = await storageEstimate();

  const micOptions = Object.entries(MIC_MODES).map(([value, m]) => ({ value, label: m.label }));
  const micHelp = el('p', { class: 'field-help' }, MIC_MODES[s.micMode]?.hint || '');

  openSheet('設定',
    el('div', { class: 'sheet-body' },
      el('div', { class: 'field' },
        el('label', { class: 'field-label' }, '配色'),
        segmented(THEMES, loadTheme(), (opt) => { saveTheme(opt.value); })
      ),

      el('h3', { class: 'sheet-section' }, '聞き取りの精度'),
      el('div', { class: 'field' },
        el('label', { class: 'field-label' }, 'マイクの拾い方'),
        micHelp,
        segmented(micOptions, s.micMode, (opt) => {
          saveSettings({ micMode: opt.value });
          micHelp.textContent = MIC_MODES[opt.value].hint;
          toast(`マイクを「${opt.label}」に設定しました`);
        })
      ),
      sheetLink('文字起こしをテストする', '10秒話しかけて、この端末で認識が動くか確かめます', 'mic',
        () => openSelfTest()),
      sheetLink('用語辞書', '固有名詞や専門用語の聞き間違いを自動で直します', 'text',
        () => openTerms(), `${s.terms.length}件`),
      toggle('フィラーを取り除く', '「えー」「あのー」などの言いよどみを本文から省きます', s.fillers,
        (v) => saveSettings({ fillers: v })),
      toggle('自信のない認識に印をつける', '録音中、聞き取りがあやしい発言を薄く表示します', s.markUncertain,
        (v) => saveSettings({ markUncertain: v })),

      el('h3', { class: 'sheet-section' }, '本文と録音'),
      el('div', { class: 'field' },
        el('label', { class: 'field-label' }, '1行の長さ'),
        el('p', { class: 'field-help' }, '句点・読点のタイミングで、この文字数を目安に改行します'),
        segmented(LINE_OPTIONS, s.lineLen, (opt) => {
          saveSettings({ lineLen: opt.value });
          toast(`1行の長さを「${opt.label}」にしました`);
        })
      ),
      toggle('タイムスタンプを入れる', '発言のまとまりごとに [12:34] を挿入します', s.timestamps,
        (v) => saveSettings({ timestamps: v })),
      toggle('音声も保存する', s.audioBlocked
        ? 'この端末では録音中に文字起こしができないため、自動でオフにしました'
        : '音声を端末内に残します。ただし多くの端末はマイクを同時に使えず、文字起こしが止まることがあります',
      s.saveAudio && !s.audioBlocked,
      (v) => saveSettings({ saveAudio: v, audioBlocked: v ? false : s.audioBlocked }),
      !isRecordingSupported),
      toggle('録音中は画面を消さない', '長い会議でも画面ロックで認識が止まりにくくなります', s.keepAwake,
        (v) => saveSettings({ keepAwake: v })),

      el('div', { class: 'sheet-note' },
        el('p', {}, '録音時間に上限はありません。端末の保存領域が続くかぎり記録できます。'),
        el('p', {}, est
          ? `端末の使用量: ${fmtBytes(est.usage)}${est.quota ? ` / 約${fmtBytes(est.quota)}` : ''}`
          : '議事録と音声は、すべてこの端末の中だけに保存されます'),
        el('p', {}, 'データは端末内(IndexedDB)にのみ保存され、外部には送信されません。')
      ),
      el('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: closeSheet }, '閉じる')
    )
  );
}

function sheetLink(label, help, iconName, onClick, badge = '') {
  return el('button', { class: 'sheet-action', type: 'button', onclick: onClick },
    el('span', { class: 'sheet-action-icon' }, icon(iconName, { size: 18 })),
    el('span', { class: 'sheet-action-text' },
      el('span', { class: 'sheet-action-label' }, label),
      el('span', { class: 'sheet-action-help' }, help)
    ),
    badge ? el('span', { class: 'sheet-action-badge' }, badge) : null
  );
}

// 文字起こしの自己診断: 認識だけを10秒動かして、何が起きているかを見せる
function openSelfTest() {
  const TEST_MS = 10000;
  const statusLine = el('p', { class: 'field-label' }, 'マイクに向かって話しかけてください…');
  const heard = el('div', { class: 'test-heard' });
  const log = el('pre', { class: 'diag' }, '');
  let recognizer = null;
  let timer = null;
  let finished = false;
  const events = [];
  const note = (line) => {
    events.push(`${new Date().toLocaleTimeString('ja-JP')} ${line}`);
    log.textContent = events.join('\n');
  };

  const finish = (verdict) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    try { recognizer?.stop(); } catch { /* 停止済み */ }
    const st = recognizer?.stats || {};
    statusLine.textContent = verdict;
    note(`結果: 開始${st.started ?? 0}回 / 認識${st.results ?? 0}件 / 途中経過${st.interims ?? 0}回 / エラー ${st.lastError || 'なし'}`);
    note(`UA: ${navigator.userAgent}`);
  };

  const start = () => {
    if (!isRecognitionSupported) {
      statusLine.textContent = 'このブラウザは音声認識に対応していません';
      note('SpeechRecognition API がありません');
      return;
    }
    note('認識を開始します');
    recognizer = createRecognizer({
      onFinal: (text) => {
        heard.append(el('p', { class: 'test-line' }, text));
        note(`確定: ${text}`);
      },
      onInterim: (text) => { if (text) statusLine.textContent = `聞き取り中: ${text}`; },
      onStatus: (s) => note(`状態: ${s}`),
      onError: (code, message) => note(`エラー: ${code} — ${message}`)
    });
    recognizer.start();
    timer = setTimeout(() => {
      const st = recognizer.stats;
      if (st.results > 0) finish('文字起こしは正常に動いています');
      else if (st.started === 0) finish('認識を開始できませんでした(許可・通信・ブラウザの対応を確認してください)');
      else finish('認識は始まりましたが、言葉を拾えませんでした(マイクに近づけて、もう一度お試しください)');
    }, TEST_MS);
  };

  openSheet('文字起こしのテスト',
    el('div', { class: 'sheet-body' },
      el('p', { class: 'field-help' }, '音声の保存は行わず、文字起こしだけを10秒間試します。'),
      statusLine,
      heard,
      log,
      el('div', { class: 'sheet-btns' },
        el('button', {
          class: 'btn btn-ghost',
          type: 'button',
          onclick: () => { finish('テストを中止しました'); closeSheet(); openSettings(); }
        }, '閉じる'),
        el('button', {
          class: 'btn btn-primary',
          type: 'button',
          onclick: async () => {
            const ok = await copyText(events.join('\n'));
            toast(ok ? 'コピーしました' : 'コピーできませんでした', { error: !ok });
          }
        }, '結果をコピー')
      )
    )
  );
  start();
}

// 用語辞書: 「正しい表記」と「聞き間違えられる表記」を登録する
function openTerms() {
  const listBox = el('div', { class: 'term-list' });
  const rightInput = el('input', { class: 'meta-input', type: 'text', placeholder: '正しい表記(例: Anthropic)' });
  const wrongInput = el('input', { class: 'meta-input', type: 'text', placeholder: '認識されがちな表記(カンマ区切り)' });

  function paint() {
    const terms = loadSettings().terms;
    clear(listBox);
    if (!terms.length) {
      listBox.append(el('p', { class: 'field-help' }, 'まだ登録がありません。会社名・人名・製品名などを登録しておくと、文字起こしの誤変換が自動で直ります。'));
      return;
    }
    terms.forEach((t, i) => {
      listBox.append(el('div', { class: 'term-row' },
        el('span', { class: 'term-text' },
          el('span', { class: 'term-right' }, t.right),
          el('span', { class: 'term-wrong' }, (t.wrong || []).join('、'))
        ),
        el('button', {
          class: 'icon-btn term-del', type: 'button', 'aria-label': `${t.right} を削除`,
          onclick: async () => {
            const ok = await confirmDialog(`「${t.right}」を辞書から削除しますか?`, { okText: '削除', danger: true });
            if (!ok) return;
            const next = loadSettings().terms.slice();
            next.splice(i, 1);
            saveSettings({ terms: next });
            paint();
          }
        }, icon('trash', { size: 16 }))
      ));
    });
  }

  function add() {
    const right = rightInput.value.trim();
    const wrong = wrongInput.value.split(/[,、]/).map((w) => w.trim()).filter(Boolean);
    if (!right) { rightInput.focus(); return; }
    if (!wrong.length) { wrongInput.focus(); toast('聞き間違えられる表記も入れてください', { error: true }); return; }
    const next = loadSettings().terms.slice();
    const at = next.findIndex((t) => t.right === right);
    if (at >= 0) next[at] = { right, wrong: [...new Set([...(next[at].wrong || []), ...wrong])] };
    else next.push({ right, wrong });
    saveSettings({ terms: next });
    rightInput.value = '';
    wrongInput.value = '';
    paint();
    toast('用語を登録しました');
  }

  paint();
  openSheet('用語辞書',
    el('div', { class: 'sheet-body' },
      el('p', { class: 'field-help' }, '音声認識が苦手な固有名詞を登録すると、文字起こしの時点で自動的に置き換えます。'),
      listBox,
      el('div', { class: 'term-form' },
        rightInput,
        wrongInput,
        el('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: add },
          icon('plus', { size: 18 }), el('span', {}, '登録する'))
      ),
      el('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: () => openSettings() }, '設定にもどる')
    )
  );
}

function toggle(label, help, value, onChange, disabled = false) {
  const input = el('input', { type: 'checkbox', checked: value, disabled });
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: `switch-row ${disabled ? 'is-disabled' : ''}` },
    el('span', { class: 'switch-text' },
      el('span', { class: 'field-label' }, label),
      el('span', { class: 'field-help' }, help)
    ),
    el('span', { class: 'switch' }, input, el('span', { class: 'switch-track' }, el('span', { class: 'switch-knob' })))
  );
}
