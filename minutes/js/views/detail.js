// 詳細画面: 議事録のタイトル・本文を編集し、書き出したり Claude に渡したりする
import {
  el, fmtDateTime, fmtDuration, toast, confirmDialog, openSheet, closeSheet,
  copyText, downloadFile, downloadBlob, safeFileName, autoGrow, debounce, haptic
} from '../util.js';
import { icon } from '../icons.js';
import { getMinute, putMinute, deleteMinute, getAudio, deleteAudio, loadSettings } from '../db.js';
import { buildBody, reformat, reflow, countChars } from '../format.js';
import { TEMPLATES, buildPrompt, buildMarkdown, CLAUDE_URL } from '../prompt.js';
import { fmtBytes } from '../recorder.js';

export async function renderDetail(root, id) {
  const minute = await getMinute(id);
  if (!minute) {
    root.append(el('div', { class: 'error-view' },
      el('p', {}, 'この議事録は見つかりませんでした'),
      el('a', { class: 'btn btn-primary', href: '#/' }, '一覧にもどる')
    ));
    return null;
  }

  let audioUrl = null;

  const titleInput = el('input', {
    class: 'title-input',
    type: 'text',
    value: minute.title || '',
    placeholder: '無題の議事録',
    'aria-label': 'タイトル',
    maxlength: 80
  });

  const body = el('textarea', {
    class: 'body-input',
    spellcheck: 'false',
    'aria-label': '議事録の本文'
  });
  body.value = minute.body || '';

  const counter = el('span', { class: 'counter' }, `${countChars(minute.body)}字`);
  const savedMark = el('span', { class: 'saved-mark' }, '保存済み');

  const participants = el('input', {
    class: 'meta-input',
    type: 'text',
    value: minute.participants || '',
    placeholder: '参加者(例: 佐藤, 田中, 鈴木)',
    'aria-label': '参加者'
  });

  const memo = el('textarea', {
    class: 'meta-input meta-memo',
    rows: 2,
    placeholder: 'メモ(レポートに一緒に渡されます)',
    'aria-label': 'メモ'
  });
  memo.value = minute.memo || '';

  const audioBox = el('div', { class: 'audio-box' });

  root.append(
    el('header', { class: 'appbar appbar-sub' },
      el('a', { class: 'icon-btn', href: '#/', 'aria-label': 'もどる' }, icon('back')),
      el('div', { class: 'appbar-main' }, el('h1', { class: 'appbar-title sm' }, '議事録')),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'メニュー', onclick: openMenu }, icon('more'))
    ),
    el('main', { class: 'page page-detail' },
      titleInput,
      el('div', { class: 'meta-row' },
        el('span', {}, icon('clock', { size: 15 }), el('span', {}, fmtDateTime(minute.startedAt))),
        minute.durationMs ? el('span', {}, icon('wave', { size: 15 }), el('span', {}, fmtDuration(minute.durationMs))) : null,
        el('span', {}, icon('text', { size: 15 }), counter)
      ),
      el('div', { class: 'meta-fields' },
        el('label', { class: 'meta-field' }, icon('people', { size: 16 }), participants),
        memo
      ),
      audioBox,
      el('section', { class: 'body-section' },
        el('div', { class: 'body-head' },
          el('h2', { class: 'section-title' }, '文字起こし'),
          el('div', { class: 'body-head-right' },
            savedMark,
            el('button', { class: 'link-btn', type: 'button', onclick: () => applyFormat('reflow') },
              icon('reformat', { size: 16 }), el('span', {}, '改行を整える'))
          )
        ),
        el('p', { class: 'field-help' }, minute.body
          ? 'そのまま編集できます。誤変換の修正や、不要な発言の削除もここで。'
          : '録音を聞きながらここに書き起こせます。書き終えたら「Claudeでレポート」へ。'),
        body
      )
    ),
    el('div', { class: 'action-bar' },
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: onCopy }, icon('copy', { size: 18 }), el('span', {}, 'コピー')),
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: onExport }, icon('download', { size: 18 }), el('span', {}, '書き出し')),
      el('button', { class: 'btn btn-primary btn-claude', type: 'button', onclick: openClaudeSheet },
        icon('sparkle', { size: 18 }), el('span', {}, 'Claudeでレポート'))
    )
  );

  const fit = autoGrow(body);

  // ---- 保存 ----
  const save = debounce(async (patch = {}) => {
    Object.assign(minute, patch);
    await putMinute(minute);
    flashSaved();
  }, 600);

  function flashSaved() {
    savedMark.classList.add('is-on');
    setTimeout(() => savedMark.classList.remove('is-on'), 1200);
  }

  titleInput.addEventListener('input', () => save({ title: titleInput.value.trim() }));
  participants.addEventListener('input', () => save({ participants: participants.value }));
  memo.addEventListener('input', () => save({ memo: memo.value }));
  body.addEventListener('input', () => {
    counter.textContent = `${countChars(body.value)}字`;
    save({ body: body.value, bodyEdited: true });
  });

  // ---- 本文の整形 ----
  function applyFormat(mode) {
    const s = loadSettings();
    const max = s.lineLen;
    const next = mode === 'reformat'
      ? reformat(body.value, max, { terms: s.terms, fillers: s.fillers })
      : reflow(body.value, max);
    if (next === body.value) { toast('すでに整っています'); return; }
    body.value = next;
    counter.textContent = `${countChars(next)}字`;
    fit();
    save({ body: next, bodyEdited: true });
    toast(mode === 'reformat' ? '句読点と改行を整えました' : '改行を整えました');
    haptic();
  }

  // 認識結果から本文を作り直す(手編集は失われる)
  async function rebuild(timestamps) {
    if (!minute.segments?.length) { toast('元の認識結果が残っていません', { error: true }); return; }
    if (minute.bodyEdited) {
      const ok = await confirmDialog('編集した本文を、認識結果から作り直しますか?', {
        detail: '手で修正した内容は失われます。', okText: '作り直す', danger: true
      });
      if (!ok) return;
    }
    const s = loadSettings();
    const next = buildBody(minute.segments, {
      max: s.lineLen, timestamps, terms: s.terms, fillers: s.fillers
    });
    body.value = next;
    counter.textContent = `${countChars(next)}字`;
    fit();
    await putMinute(Object.assign(minute, { body: next, bodyEdited: false }));
    flashSaved();
    closeSheet();
    toast(timestamps ? 'タイムスタンプ付きで作り直しました' : '本文を作り直しました');
  }

  // ---- 書き出し ----
  async function onCopy() {
    const ok = await copyText(body.value);
    toast(ok ? '本文をコピーしました' : 'コピーできませんでした', { error: !ok });
    haptic();
  }

  function onExport() {
    const name = safeFileName(minute.title || '議事録');
    openSheet('書き出し',
      el('div', { class: 'sheet-body' },
        sheetAction('markdown', 'download', 'Markdown (.md)', '見出し・日時つきで書き出します', () => {
          downloadFile(`${name}.md`, buildMarkdown(minute), 'text/markdown;charset=utf-8');
          closeSheet();
        }),
        sheetAction('text', 'text', 'テキスト (.txt)', '本文だけを書き出します', () => {
          downloadFile(`${name}.txt`, body.value);
          closeSheet();
        }),
        minute.hasAudio ? sheetAction('audio', 'wave', '録音した音声 (' + audioExt(minute.audioMime) + ')',
          '文字起こしができなかったときに、音声そのものを取り出せます', async () => {
            const rec = await getAudio(minute.id);
            if (!rec?.blob) { toast('音声が見つかりませんでした', { error: true }); return; }
            downloadBlob(`${name}.${audioExt(minute.audioMime || rec.type)}`, rec.blob);
            closeSheet();
          }) : null,
        navigator.share ? sheetAction('share', 'share', '他のアプリに送る', 'メールやチャットに共有します', async () => {
          try {
            await navigator.share({ title: minute.title || '議事録', text: buildMarkdown(minute) });
          } catch { /* 共有をやめた場合は何もしない */ }
          closeSheet();
        }) : null,
        el('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: closeSheet }, '閉じる')
      )
    );
  }

  // ---- Claude へのレポート依頼 ----
  function openClaudeSheet() {
    let templateId = minute.kind === 'lecture' ? 'lecture' : 'minutes';
    const extra = el('textarea', {
      class: 'textarea', rows: 2,
      placeholder: '追加の指示(任意。例: 経営会議向けに、数字を中心に)'
    });
    const sizeNote = el('p', { class: 'field-help' });

    const chips = el('div', { class: 'chips' });
    TEMPLATES.forEach((t) => {
      const chip = el('button', {
        class: `chip-btn ${t.id === templateId ? 'is-on' : ''}`,
        type: 'button',
        onclick: () => {
          templateId = t.id;
          chips.querySelectorAll('.chip-btn').forEach((c) => c.classList.remove('is-on'));
          chip.classList.add('is-on');
          desc.textContent = t.desc;
          updateSize();
        }
      }, t.name);
      chips.append(chip);
    });
    const desc = el('p', { class: 'field-help' }, TEMPLATES.find((t) => t.id === templateId)?.desc || '');

    const current = () => buildPrompt({ ...minute, body: body.value }, templateId, extra.value);
    function updateSize() {
      sizeNote.textContent = `プロンプト全体で約${current().length}文字`;
    }
    extra.addEventListener('input', updateSize);
    updateSize();

    const copyAnd = async (open) => {
      const ok = await copyText(current());
      if (!ok) { toast('コピーできませんでした', { error: true }); return; }
      toast(open ? 'コピーしました。Claudeに貼り付けてください' : 'プロンプトをコピーしました');
      closeSheet();
      if (open) window.open(CLAUDE_URL, '_blank', 'noopener');
    };

    openSheet('Claudeでレポートを作る',
      el('div', { class: 'sheet-body' },
        el('p', { class: 'field-help' }, '議事録の本文に、レポートの指示を添えたプロンプトを作ります。'),
        chips,
        desc,
        extra,
        sizeNote,
        el('div', { class: 'sheet-btns col' },
          el('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => copyAnd(true) },
            icon('sparkle', { size: 18 }), el('span', {}, 'コピーして Claude を開く')),
          el('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: () => copyAnd(false) },
            icon('copy', { size: 18 }), el('span', {}, 'プロンプトだけコピー')),
          el('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: () => {
            downloadFile(`${safeFileName(minute.title || '議事録')}_prompt.md`, current(), 'text/markdown;charset=utf-8');
            closeSheet();
          } }, icon('download', { size: 18 }), el('span', {}, 'プロンプトを書き出す'))
        )
      )
    );
  }

  // ---- メニュー ----
  function openMenu() {
    const s = loadSettings();
    openSheet(null,
      el('div', { class: 'sheet-body' },
        sheetAction('reformat', 'reformat', '句読点と改行を整え直す', '本文全体に句読点を補い、改行し直します', () => {
          applyFormat('reformat');
          closeSheet();
        }),
        sheetAction('rebuild', 'text', '認識結果から作り直す', '編集前の状態に戻します', () => rebuild(false)),
        sheetAction('stamp', 'clock', s.timestamps ? 'タイムスタンプなしで作り直す' : 'タイムスタンプ付きで作り直す',
          '発言のまとまりごとに時刻を入れます', () => rebuild(!s.timestamps)),
        minute.hasAudio ? sheetAction('delaudio', 'trash', '音声だけ削除', '本文は残したまま録音データを消します', async () => {
          const ok = await confirmDialog('録音した音声を削除しますか?', { okText: '削除', danger: true });
          if (!ok) return;
          await deleteAudio(minute.id);
          await putMinute(Object.assign(minute, { hasAudio: false }));
          closeSheet();
          paintAudio();
          toast('音声を削除しました');
        }) : null,
        sheetAction('delete', 'trash', 'この議事録を削除', '元に戻せません', async () => {
          const ok = await confirmDialog('この議事録を削除しますか?', {
            detail: minute.title || '無題の議事録', okText: '削除する', danger: true
          });
          if (!ok) return;
          await deleteMinute(minute.id);
          closeSheet();
          toast('削除しました');
          location.hash = '#/';
        }, true),
        el('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: closeSheet }, '閉じる')
      )
    );
  }

  // ---- 音声 ----
  async function paintAudio() {
    audioBox.replaceChildren();
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
    if (!minute.hasAudio) return;
    const rec = await getAudio(minute.id);
    if (!rec?.blob) return;
    audioUrl = URL.createObjectURL(rec.blob);
    const player = el('audio', { controls: true, src: audioUrl, preload: 'metadata', class: 'audio-player' });

    // 聞き返しながら書き起こすための操作(早送り・巻き戻し・再生速度)
    const skip = (sec) => () => {
      player.currentTime = Math.max(0, Math.min(player.duration || Infinity, player.currentTime + sec));
    };
    const speeds = [0.75, 1, 1.25, 1.5, 2];
    const speedRow = el('div', { class: 'seg speed-seg' });
    speeds.forEach((v) => {
      const b = el('button', {
        class: `seg-btn ${v === 1 ? 'is-on' : ''}`,
        type: 'button',
        onclick: () => {
          player.playbackRate = v;
          speedRow.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('is-on'));
          b.classList.add('is-on');
        }
      }, `${v}x`);
      speedRow.append(b);
    });

    audioBox.append(
      el('div', { class: 'audio-head' },
        el('span', { class: 'audio-label' }, icon('wave', { size: 15 }), el('span', {}, '録音')),
        el('span', { class: 'audio-size' }, fmtBytes(rec.size || rec.blob.size))
      ),
      player,
      el('div', { class: 'audio-controls' },
        el('button', { class: 'btn btn-ghost', type: 'button', onclick: skip(-15) }, '⟲ 15秒'),
        el('button', { class: 'btn btn-ghost', type: 'button', onclick: skip(15) }, '15秒 ⟳'),
        speedRow
      )
    );
  }
  paintAudio();

  return () => {
    save.flush();
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
  };
}

// 音声の保存形式から拡張子を決める
function audioExt(mime = '') {
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('mpeg')) return 'mp3';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

function sheetAction(key, iconName, label, help, onClick, danger = false) {
  return el('button', {
    class: `sheet-action ${danger ? 'is-danger' : ''}`,
    type: 'button',
    dataset: { key },
    onclick: onClick
  },
  el('span', { class: 'sheet-action-icon' }, icon(iconName, { size: 18 })),
  el('span', { class: 'sheet-action-text' },
    el('span', { class: 'sheet-action-label' }, label),
    el('span', { class: 'sheet-action-help' }, help)
  ));
}
