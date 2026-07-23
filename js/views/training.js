// 特訓部屋: レベルアップ演出つきのゲーム風To Doリスト
import { getAllTasks, putTask, deleteTask } from '../db.js';
import {
  el, uid, fmtDate, haptic, toast, confirmDialog,
  openSheet, closeSheet, rainConfetti, showBanner
} from '../util.js';
import { spriteSVG } from '../sprites.js';

const XP_PER_TASK = 15;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// ---- プレイヤー(レベル・経験値) ----
export function loadPlayer() {
  try { return JSON.parse(localStorage.getItem('qd-player')) || { xp: 0 }; }
  catch { return { xp: 0 }; }
}
function savePlayer(p) { localStorage.setItem('qd-player', JSON.stringify(p)); }

function needFor(level) { return 30 + (level - 1) * 15; } // Lv n → n+1 に必要なXP
export function levelFromXp(xp) {
  let level = 1, rest = xp;
  while (rest >= needFor(level)) { rest -= needFor(level); level++; }
  return { level, rest, need: needFor(level) };
}
export function titleFor(level) {
  if (level >= 20) return '神話の覇者';
  if (level >= 15) return '伝説の英雄';
  if (level >= 10) return '歴戦の勇者';
  if (level >= 6) return 'いっぱしの剣士';
  if (level >= 3) return 'かけだし戦士';
  return 'みならい冒険者';
}

// ---- 定期タスクの周期キー ----
function dkey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function periodKey(recur, now = new Date()) {
  if (!recur) return null;
  if (recur.type === 'daily') return 'd' + dkey(now);
  if (recur.type === 'weekly') {
    const x = new Date(now); x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() - recur.day + 7) % 7)); // 直近の指定曜日
    return 'w' + dkey(x);
  }
  return `m${now.getFullYear()}-${now.getMonth() + 1}`; // 月初リセット
}
function recurLabel(recur) {
  if (!recur) return '1回きり';
  if (recur.type === 'daily') return '毎日';
  if (recur.type === 'weekly') return `毎週${WEEKDAYS[recur.day]}曜`;
  return '毎月(月初〜)';
}
function nextLabel(recur) {
  if (!recur) return '';
  if (recur.type === 'daily') return 'あした ふたたび出現';
  if (recur.type === 'weekly') return `来週${WEEKDAYS[recur.day]}曜に ふたたび出現`;
  return '来月1日に ふたたび出現';
}
function isPending(task) {
  if (!task.recur) return !task.doneAt;
  return task.lastDoneKey !== periodKey(task.recur);
}

export async function renderTraining(root) {
  let tasks = await getAllTasks();

  const heroPanel = el('div', { class: 'dojo-hero pixel-panel' });
  const pendingList = el('div', { class: 'dojo-list' });
  const doneList = el('div', { class: 'dojo-done-list' });
  const doneWrap = el('details', { class: 'dojo-done' },
    el('summary', {}, 'クリアした特訓'),
    doneList
  );

  function paintHero(animateGain) {
    const p = loadPlayer();
    const { level, rest, need } = levelFromXp(p.xp);
    heroPanel.innerHTML = '';
    const blocks = 12;
    const filled = Math.min(blocks, Math.round((rest / need) * blocks));
    heroPanel.append(
      el('div', { class: 'dojo-hero-row' },
        el('div', { class: `dojo-hero-sprite ${animateGain ? 'gain' : ''}`, html: spriteSVG('hero', { size: 56 }) }),
        el('div', { class: 'dojo-hero-info' },
          el('div', { class: 'dojo-level' }, `Lv.${level} `, el('span', { class: 'dojo-title-tag' }, titleFor(level))),
          el('div', { class: 'pixbar xp-bar' },
            Array.from({ length: blocks }, (_, i) => el('span', { class: i < filled ? 'xp-on' : '' }))
          ),
          el('div', { class: 'dojo-xp-text' }, `EXP ${rest} / ${need}`)
        )
      )
    );
  }

  function paintLists() {
    const pending = tasks.filter(isPending);
    const done = tasks.filter((t) => !isPending(t));

    pendingList.innerHTML = '';
    if (pending.length === 0) {
      pendingList.append(el('div', { class: 'dojo-empty' },
        '特訓メニューは すべてクリア!', el('br'), 'ゆっくり休むのも 修行のうち…'));
    }
    for (const task of pending) pendingList.append(taskCard(task));

    doneList.innerHTML = '';
    if (done.length === 0) {
      doneList.append(el('div', { class: 'dojo-empty small' }, 'まだない'));
    }
    for (const task of done.slice().reverse()) doneList.append(doneCard(task));
    doneWrap.querySelector('summary').textContent = `クリアした特訓 (${done.length})`;
  }

  function taskCard(task) {
    const card = el('div', { class: 'dojo-task pixel-panel' },
      el('button', {
        class: 'dojo-task-body',
        onclick: () => openTaskSheet(task)
      },
        el('span', { class: 'dojo-task-icon', html: spriteSVG('rock', { size: 30 }) }),
        el('span', { class: 'dojo-task-name' }, task.name),
        el('span', { class: `dojo-recur ${task.recur ? 'on' : ''}` }, recurLabel(task.recur))
      ),
      el('button', {
        class: 'dojo-complete',
        'aria-label': 'クリアする',
        onclick: (e) => { e.stopPropagation(); completeTask(task, card); }
      }, '⚔')
    );
    return card;
  }

  function doneCard(task) {
    return el('div', { class: 'dojo-task done' },
      el('span', { class: 'dojo-task-icon', html: spriteSVG('starGold', { size: 22 }) }),
      el('div', { class: 'dojo-task-name' },
        task.name,
        el('div', { class: 'dojo-done-meta' },
          `✓ ${fmtDate(task.doneAt || Date.now())}` + (task.recur ? ` ・ ${nextLabel(task.recur)}` : '')
        )
      ),
      el('button', {
        class: 'dojo-undo',
        'aria-label': 'クリアを取り消す',
        onclick: async () => {
          if (task.recur) task.lastDoneKey = null; else task.doneAt = null;
          const p = loadPlayer();
          p.xp = Math.max(0, p.xp - XP_PER_TASK);
          savePlayer(p);
          await putTask(task);
          paintHero(false);
          paintLists();
        }
      }, '↩')
    );
  }

  async function completeTask(task, card) {
    const p = loadPlayer();
    const before = levelFromXp(p.xp).level;
    p.xp += XP_PER_TASK;
    savePlayer(p);
    const after = levelFromXp(p.xp).level;

    task.doneAt = Date.now();
    if (task.recur) task.lastDoneKey = periodKey(task.recur);
    task.doneCount = (task.doneCount || 0) + 1;
    await putTask(task);

    haptic([16, 40, 24]);
    // 斬撃エフェクト + EXPポップ
    card.classList.add('slashed');
    const pop = el('div', { class: 'exp-pop' }, `+${XP_PER_TASK} EXP`);
    card.append(el('div', { class: 'slash-fx' }), pop);

    setTimeout(() => {
      paintHero(true);
      paintLists();
      if (after > before) {
        haptic([30, 60, 30, 60, 60]);
        rainConfetti(['#ffcd75', '#73eff7', '#a7f070', '#f4f4f4', '#ff5d8f'], 70);
        showBanner({
          iconHtml: `<div class="levelup-hero">${spriteSVG('hero', { size: 100 })}</div>`,
          text: 'LEVEL UP!',
          sub: `Lv.${after} ${titleFor(after)} になった!`,
          duration: 2600
        });
      }
    }, 650);
  }

  // ---- タスク追加/編集シート ----
  function openTaskSheet(task = null) {
    const isNew = !task;
    const draft = task || { id: uid(), name: '', recur: null, createdAt: Date.now(), doneAt: null, lastDoneKey: null, doneCount: 0 };
    let recur = draft.recur ? { ...draft.recur } : null;

    const nameInput = el('input', { type: 'text', maxlength: 60, placeholder: 'れい: 腹筋30回 / 週報を書く', value: draft.name });
    const recurBox = el('div', { class: 'recur-box' });

    function paintRecur() {
      recurBox.innerHTML = '';
      const opts = [
        { key: null, label: '1回きり' },
        { key: 'daily', label: '毎日' },
        { key: 'weekly', label: '毎週' },
        { key: 'monthly', label: '月初' }
      ];
      recurBox.append(el('div', { class: 'recur-row' },
        opts.map((o) => el('button', {
          class: `seg ${(recur?.type ?? null) === o.key ? 'on' : ''}`,
          onclick: () => {
            recur = o.key === null ? null
              : o.key === 'weekly' ? { type: 'weekly', day: recur?.day ?? 1 }
              : { type: o.key };
            paintRecur();
          }
        }, o.label))
      ));
      if (recur?.type === 'weekly') {
        recurBox.append(el('div', { class: 'recur-row weekdays' },
          WEEKDAYS.map((w, i) => el('button', {
            class: `seg day ${recur.day === i ? 'on' : ''}`,
            onclick: () => { recur.day = i; paintRecur(); }
          }, w))
        ));
      }
      recurBox.append(el('div', { class: 'field-help' },
        recur ? `${recurLabel(recur)} にリストへ出現する。` : 'クリアすると完了済みへ移動する。'));
    }
    paintRecur();

    const body = [
      el('div', { class: 'sheet-head' },
        el('span', { html: spriteSVG('book', { size: 36 }) }),
        el('div', {}, el('div', { class: 'sheet-kind' }, isNew ? '特訓メニューを追加' : '特訓メニューを編集'))
      ),
      nameInput,
      el('div', { class: 'field-label', style: 'margin-top:4px' }, 'くりかえし'),
      recurBox,
      el('button', {
        class: 'btn btn-primary btn-big',
        onclick: async () => {
          const name = nameInput.value.trim();
          if (!name) { toast('メニュー名を入力してね'); nameInput.focus(); return; }
          draft.name = name;
          draft.recur = recur;
          await putTask(draft);
          if (isNew) tasks.push(draft);
          closeSheet();
          paintLists();
        }
      }, isNew ? '追加する' : '保存する')
    ];

    if (!isNew) {
      body.push(el('button', {
        class: 'undo-link danger',
        onclick: async () => {
          if (!(await confirmDialog(`「${draft.name}」を削除する?`, { okText: '削除する', danger: true }))) return;
          await deleteTask(draft.id);
          tasks = tasks.filter((t) => t.id !== draft.id);
          closeSheet();
          paintLists();
        }
      }, 'このメニューを削除'));
    }

    openSheet(body);
  }

  root.innerHTML = '';
  root.append(
    el('div', { class: 'dojo' },
      el('div', { class: 'wizard-top' },
        el('button', { class: 'icon-btn', 'aria-label': 'ホームへもどる', onclick: () => { location.hash = ''; } }, '◀'),
        el('h1', { class: 'wizard-title' }, '特訓部屋'),
      ),
      heroPanel,
      el('div', { class: 'dojo-section-title' }, '▼ 本日の特訓メニュー'),
      pendingList,
      el('button', { class: 'btn btn-gold btn-big dojo-add', onclick: () => openTaskSheet(null) }, '＋ 特訓メニューを追加'),
      doneWrap
    )
  );
  paintHero(false);
  paintLists();
}
