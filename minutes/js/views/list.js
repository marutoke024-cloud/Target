// 一覧画面: 保存済みの議事録を新しい順に表示する
import { el, clear, fmtRelative, fmtDuration, openSheet, closeSheet, toast, haptic } from '../util.js';
import { icon } from '../icons.js';
import { listMinutes, loadSettings, saveSettings, storageEstimate } from '../db.js';
import { LINE_PRESETS, countChars } from '../format.js';
import { fmtBytes, isRecordingSupported } from '../recorder.js';
import { isRecognitionSupported } from '../recognizer.js';

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

async function openSettings() {
  const s = loadSettings();
  const est = await storageEstimate();

  const lineRow = el('div', { class: 'seg' });
  LINE_OPTIONS.forEach((opt) => {
    const btn = el('button', {
      class: `seg-btn ${s.lineLen === opt.value ? 'is-on' : ''}`,
      type: 'button',
      onclick: () => {
        saveSettings({ lineLen: opt.value });
        lineRow.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('is-on'));
        btn.classList.add('is-on');
        toast(`1行の長さを「${opt.label}」にしました`);
      }
    }, el('span', { class: 'seg-label' }, opt.label), el('span', { class: 'seg-hint' }, opt.hint));
    lineRow.append(btn);
  });

  openSheet('設定',
    el('div', { class: 'sheet-body' },
      el('div', { class: 'field' },
        el('label', { class: 'field-label' }, '1行の長さ'),
        el('p', { class: 'field-help' }, '句点・読点のタイミングで、この文字数を目安に改行します'),
        lineRow
      ),
      toggle('タイムスタンプを入れる', '発言のまとまりごとに [12:34] を挿入します', s.timestamps,
        (v) => saveSettings({ timestamps: v })),
      toggle('音声も保存する', '録音した音声を端末内に残し、あとから聞き返せます', s.saveAudio,
        (v) => saveSettings({ saveAudio: v }), !isRecordingSupported),
      toggle('録音中は画面を消さない', '長い会議でも画面ロックで認識が止まりにくくなります', s.keepAwake,
        (v) => saveSettings({ keepAwake: v })),
      el('div', { class: 'sheet-note' },
        el('p', {}, est
          ? `端末の使用量: ${fmtBytes(est.usage)}${est.quota ? ` / 約${fmtBytes(est.quota)}` : ''}`
          : '議事録と音声は、すべてこの端末の中だけに保存されます'),
        el('p', {}, 'データは端末内(IndexedDB)にのみ保存され、外部には送信されません。')
      ),
      el('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: closeSheet }, '閉じる')
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
