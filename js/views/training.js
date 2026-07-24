// 特訓部屋: レベルアップ演出つきのゲーム風To Do。定期タスクは敵のHPを削って討伐する
import { getAllTasks, putTask, deleteTask } from '../db.js';
import {
  el, uid, fmtDate, haptic, toast, confirmDialog,
  openSheet, closeSheet, rainConfetti, showBanner
} from '../util.js';
import { spriteSVG } from '../sprites.js';
import { avatarSVG } from '../avatar.js';

const XP_PER_TASK = 15;   // 1回達成ごとに得るEXP
const HP_HEAL = 10;       // 週/月の目標達成で回復するHP%
const HP_DMG = 20;        // 週/月の目標未達成で受けるダメージHP%
const NO_DMG_GOAL_DAYS = 182; // 約半年ノーダメージで金の宝箱
const DAY_MS = 86400000;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// ---- プレイヤー(レベル・経験値・HP・無傷継続) ----
export function loadPlayer() {
  let p;
  try { p = JSON.parse(localStorage.getItem('qd-player')) || {}; } catch { p = {}; }
  if (typeof p.xp !== 'number') p.xp = 0;
  if (typeof p.hp !== 'number') p.hp = 100;
  if (typeof p.goldChests !== 'number') p.goldChests = 0;
  if (typeof p.noDmgSince !== 'number') p.noDmgSince = Date.now();
  if (!p.equip || typeof p.equip !== 'object') p.equip = { weapon: null, head: null, body: null, shield: null };
  return p;
}
export function savePlayerState(p) { localStorage.setItem('qd-player', JSON.stringify(p)); }
function savePlayer(p) { localStorage.setItem('qd-player', JSON.stringify(p)); }
function clampHp(v) { return Math.max(0, Math.min(100, v)); }

function needFor(level) { return 30 + (level - 1) * 15; }
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
// 週の起点は月曜(週明けの月曜が更新日)
function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // 月曜まで戻す
  return x;
}
function weekKey(now = new Date()) { return 'W' + dkey(startOfWeek(now)); }
function monthKey(now = new Date()) { return `N${now.getFullYear()}-${now.getMonth() + 1}`; }
// HP精算の周期キー(毎日/週にn回は週=月曜、月にn回は月)
function hpPeriodKey(recur, now = new Date()) {
  return recur.type === 'monthN' ? monthKey(now) : weekKey(now);
}
function isHpRecur(recur) { return !!recur && (recur.type === 'daily' || recur.type === 'weekN' || recur.type === 'monthN'); }

// 回数タイプ(週にn回/月にn回)か?
function isCountRecur(recur) { return !!recur && (recur.type === 'weekN' || recur.type === 'monthN'); }

function periodKey(recur, now = new Date()) {
  if (!recur) return null;
  if (recur.type === 'daily') return 'd' + dkey(now);
  if (recur.type === 'weekly') {
    const x = new Date(now); x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() - recur.day + 7) % 7));
    return 'w' + dkey(x);
  }
  if (recur.type === 'weekN') return weekKey(now);                      // 今週(月曜始まり)
  if (recur.type === 'monthN') return monthKey(now);                    // 今月
  return `m${now.getFullYear()}-${now.getMonth() + 1}`;                  // 月初リセット
}

// いまの周期における達成回数
function currentCount(task) {
  const key = periodKey(task.recur);
  if (!task.progress || task.progress.key !== key) return 0;
  return task.progress.count;
}

function recurLabel(recur) {
  if (!recur) return '1回きり';
  if (recur.type === 'daily') return '毎日';
  if (recur.type === 'weekly') return `毎週${WEEKDAYS[recur.day]}曜`;
  if (recur.type === 'weekN') return `週に${recur.target}回`;
  if (recur.type === 'monthN') return `月に${recur.target}回`;
  return '毎月(月初〜)';
}
function nextLabel(recur) {
  if (!recur) return '';
  if (recur.type === 'daily') return 'あした ふたたび出現';
  if (recur.type === 'weekly') return `来週${WEEKDAYS[recur.day]}曜に ふたたび出現`;
  if (recur.type === 'weekN') return '来週リセットして再出現';
  if (recur.type === 'monthN') return '来月リセットして再出現';
  return '来月1日に ふたたび出現';
}

export function isPending(task) {
  const r = task.recur;
  if (!r) return !task.doneAt;
  if (isCountRecur(r)) return currentCount(task) < r.target;
  return task.lastDoneKey !== periodKey(r);
}

// 週明けの月曜(月にn回は月初)に周期を精算する。
// - 毎日 : その週を7日クリアで達成(回復/ダメージは半減: +5 / -10)
// - 週/月にn回 : 目標回数で達成(+10 / -20)
// 達成でHP回復、未達成でダメージ。あわせて各タスクの継続ストリークを更新する。
export async function evaluateHp(tasks) {
  const p = loadPlayer();
  let hp = p.hp;
  let hpChanged = false, dmgOccurred = false;
  const dmgEvents = [], healEvents = [];

  for (const task of tasks) {
    const r = task.recur;
    if (!r) continue; // 1回きりは対象外
    let changed = false;

    if (isHpRecur(r)) {
      const isDaily = r.type === 'daily';
      const store = isDaily ? 'hpWeek' : 'progress';
      const curKey = hpPeriodKey(r);
      if (!task[store]) { task[store] = isDaily ? { key: curKey, days: [] } : { key: curKey, count: 0 }; changed = true; }
      if (task.hpSettledKey == null) { task.hpSettledKey = task[store].key; changed = true; }

      if (task[store].key !== curKey) {
        const prev = task[store];
        // 作成直後の中途半端な周期はさかのぼって精算しない
        if (prev.key !== task.hpSettledKey) {
          const achieved = isDaily ? (prev.days ? prev.days.length : 0) >= 7 : (prev.count || 0) >= r.target;
          const heal = isDaily ? Math.round(HP_HEAL / 2) : HP_HEAL;
          const dmg = isDaily ? Math.round(HP_DMG / 2) : HP_DMG;
          if (achieved) {
            if (hp < 100) { hp = clampHp(hp + heal); hpChanged = true; healEvents.push({ name: task.name, delta: heal }); }
            task.streak = (task.streak || 0) + 1;
          } else {
            hp = clampHp(hp - dmg); hpChanged = true; dmgOccurred = true;
            dmgEvents.push({ name: task.name, delta: dmg });
            task.streak = 0;
          }
        }
        task.hpSettledKey = prev.key;
        task[store] = isDaily ? { key: curKey, days: [] } : { key: curKey, count: 0 };
        changed = true;
      }
    } else {
      // 毎週(曜日)/月初: HPは無し、ストリークのみ更新
      const curKey = periodKey(r);
      if (task.streakKey == null) { task.streakKey = curKey; changed = true; }
      if (task.streakKey !== curKey) {
        const achieved = task.lastDoneKey === task.streakKey;
        task.streak = achieved ? (task.streak || 0) + 1 : 0;
        task.streakKey = curKey;
        changed = true;
      }
    }

    if (changed) await putTask(task);
  }

  if (hpChanged) {
    p.hp = hp;
    if (dmgOccurred) p.noDmgSince = Date.now(); // ダメージで無傷継続はリセット
    savePlayer(p);
  }
  return { dmgEvents, healEvents };
}

// 半年ノーダメージ達成で金の宝箱を付与する
export function checkGoldChest(tasks) {
  const p = loadPlayer();
  const hasHpTask = tasks.some((t) => isHpRecur(t.recur));
  if (!hasHpTask) return false;
  if (Date.now() - p.noDmgSince >= NO_DMG_GOAL_DAYS * DAY_MS) {
    p.goldChests += 1;
    p.noDmgSince = Date.now(); // 次の半年へ
    savePlayer(p);
    return true;
  }
  return false;
}

export async function renderTraining(root) {
  let tasks = await getAllTasks();
  savePlayer(loadPlayer()); // 無傷継続などの初期フィールドを永続化
  const { dmgEvents, healEvents } = await evaluateHp(tasks); // 月曜チェックでHP精算
  const goldWin = checkGoldChest(tasks);     // 半年ノーダメージ達成判定

  const heroPanel = el('div', { class: 'dojo-hero pixel-panel' });
  const pendingList = el('div', { class: 'dojo-list' });
  const doneList = el('div', { class: 'dojo-done-list' });
  const doneWrap = el('details', { class: 'dojo-done' },
    el('summary', {}, 'クリアした特訓'),
    doneList
  );

  function addXp(delta) {
    const p = loadPlayer();
    const before = levelFromXp(p.xp).level;
    p.xp = Math.max(0, p.xp + delta);
    savePlayer(p);
    return { before, after: levelFromXp(p.xp).level };
  }

  function paintHero(animateGain, hpFx) {
    const p = loadPlayer();
    const { level, rest, need } = levelFromXp(p.xp);
    const hp = p.hp;
    heroPanel.innerHTML = '';
    const blocks = 12;
    const filled = Math.min(blocks, Math.round((rest / need) * blocks));
    const hpBlocks = 10;
    const hpFilled = Math.round(hp / 10);
    const hpCls = hp <= 20 ? 'crit' : hp <= 40 ? 'low' : '';
    heroPanel.append(
      el('div', { class: 'dojo-hero-row' },
        el('div', { class: `dojo-hero-sprite ${animateGain ? 'gain' : ''} ${hp <= 20 ? 'weak' : ''}`, html: avatarSVG(p.equip, 56) }),
        el('div', { class: 'dojo-hero-info' },
          el('div', { class: 'dojo-level' }, `Lv.${level} `, el('span', { class: 'dojo-title-tag' }, titleFor(level))),
          el('div', { class: 'pixbar xp-bar' },
            Array.from({ length: blocks }, (_, i) => el('span', { class: i < filled ? 'xp-on' : '' }))
          ),
          el('div', { class: 'dojo-xp-text' }, `EXP ${rest} / ${need}`),
          el('div', { class: 'dojo-hp-row' },
            el('span', { class: 'dojo-hp-icon', html: spriteSVG('heart', { size: 14 }) }),
            el('span', { class: 'dojo-hp-tag' }, 'HP'),
            el('div', { class: `pixbar hp-gauge ${hpCls} ${hpFx || ''}` },
              Array.from({ length: hpBlocks }, (_, i) => el('span', { class: i < hpFilled ? 'hp-on' : '' }))
            ),
            el('span', { class: `dojo-hp-pct ${hpCls}` }, `${hp}%`)
          )
        )
      )
    );
    const sr = streakRow(p);
    if (sr) heroPanel.append(sr);
  }

  // 無傷継続 → 金の宝箱 の進捗
  function streakRow(p) {
    const hasCount = tasks.some((t) => isCountRecur(t.recur));
    if (!hasCount && p.goldChests === 0) return null;
    const days = Math.floor((Date.now() - p.noDmgSince) / DAY_MS);
    const blocks = 12;
    const filled = Math.min(blocks, Math.round((days / NO_DMG_GOAL_DAYS) * blocks));
    return el('div', { class: 'streak-row' },
      el('div', { class: 'streak-head' },
        el('span', { html: spriteSVG('chestClosed', { size: 20 }) }),
        el('span', { class: 'streak-title' }, '半年ノーダメージで金の宝箱'),
        p.goldChests > 0 ? el('span', { class: 'streak-count' }, `獲得 ×${p.goldChests}`) : null
      ),
      el('div', { class: 'pixbar streak-bar' },
        Array.from({ length: blocks }, (_, i) => el('span', { class: i < filled ? 'gold-on' : '' }))
      ),
      el('div', { class: 'streak-text' }, `無傷継続 ${days}日 / ${NO_DMG_GOAL_DAYS}日`)
    );
  }

  function levelUpBanner(after) {
    haptic([30, 60, 30, 60, 60]);
    rainConfetti(['#ffcd75', '#73eff7', '#a7f070', '#f4f4f4', '#ff5d8f'], 70);
    showBanner({
      iconHtml: `<div class="levelup-hero">${avatarSVG(loadPlayer().equip, 100)}</div>`,
      text: 'LEVEL UP!',
      sub: `Lv.${after} ${titleFor(after)} になった!`,
      duration: 2600
    });
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
    if (done.length === 0) doneList.append(el('div', { class: 'dojo-empty small' }, 'まだない'));
    for (const task of done.slice().reverse()) doneList.append(doneCard(task));
    doneWrap.querySelector('summary').textContent = `クリアした特訓 (${done.length})`;
  }

  // ストリーク(継続数)バッジ
  function streakBadge(task) {
    if (!task.streak) return null;
    const unit = task.recur?.type === 'daily' ? '日' : '';
    return el('span', { class: 'dojo-streak', title: `${task.streak}連続クリア` }, `🔥${task.streak}${unit}`);
  }

  // ---- 未クリアのカード ----
  function taskCard(task) {
    if (isCountRecur(task.recur)) return countCard(task);

    const card = el('div', { class: 'dojo-task pixel-panel' },
      el('button', { class: 'dojo-task-body', onclick: () => openTaskSheet(task) },
        el('span', { class: 'dojo-task-icon', html: spriteSVG('rock', { size: 30 }) }),
        el('span', { class: 'dojo-task-name' }, task.name),
        streakBadge(task),
        el('span', { class: `dojo-recur ${task.recur ? 'on' : ''}` }, recurLabel(task.recur))
      ),
      el('button', {
        class: 'dojo-complete',
        'aria-label': 'クリアする',
        onclick: (e) => { e.stopPropagation(); completeSingle(task, card); }
      }, '⚔')
    );
    return card;
  }

  // ---- 回数タイプ: 敵のHPゲージ ----
  function countCard(task) {
    const target = task.recur.target;
    const count = currentCount(task);
    const remaining = target - count;

    const enemy = el('span', { class: 'dojo-enemy', html: spriteSVG('slime', { size: 34 }) });
    const hpBar = el('div', { class: 'hp-bar' },
      Array.from({ length: target }, (_, i) => el('span', { class: i < remaining ? 'hp' : 'gone' }))
    );
    const hpLabel = el('span', { class: 'hp-label' }, `${count}/${target}`);

    const card = el('div', { class: 'dojo-task count pixel-panel' },
      el('button', { class: 'dojo-task-body', onclick: () => openTaskSheet(task) },
        enemy,
        el('div', { class: 'dojo-count-info' },
          el('div', { class: 'dojo-count-top' },
            el('span', { class: 'dojo-task-name' }, task.name),
            streakBadge(task),
            el('span', { class: 'dojo-recur on' }, recurLabel(task.recur))
          ),
          el('div', { class: 'hp-row' }, hpBar, hpLabel)
        )
      ),
      el('button', {
        class: 'dojo-complete atk',
        'aria-label': '1回達成した',
        onclick: (e) => { e.stopPropagation(); attackCount(task, card, enemy, hpBar, hpLabel); }
      }, '⚔')
    );
    return card;
  }

  function doneCard(task) {
    const isCount = isCountRecur(task.recur);
    return el('div', { class: 'dojo-task done' },
      el('span', { class: 'dojo-task-icon', html: spriteSVG('starGold', { size: 22 }) }),
      el('div', { class: 'dojo-task-name' },
        task.name,
        el('div', { class: 'dojo-done-meta' },
          `✓ ${isCount ? `${task.recur.target}回討伐` : fmtDate(task.doneAt || Date.now())}` +
          (task.recur ? ` ・ ${nextLabel(task.recur)}` : '')
        )
      ),
      el('button', {
        class: 'dojo-undo',
        'aria-label': 'クリアを取り消す',
        onclick: async () => {
          if (isCount) {
            const key = periodKey(task.recur);
            task.progress = { key, count: Math.max(0, task.recur.target - 1) };
          } else if (task.recur && task.recur.type === 'daily') {
            // 今日の達成を取り消す(週内の達成日とストリークを戻す)
            const today = dkey(new Date());
            if (task.hpWeek) task.hpWeek.days = (task.hpWeek.days || []).filter((d) => d !== today);
            task.streak = Math.max(0, (task.streak || 0) - 1);
            task.lastDoneKey = null;
          } else if (task.recur) {
            task.lastDoneKey = null;
          } else {
            task.doneAt = null;
          }
          addXp(-XP_PER_TASK);
          await putTask(task);
          paintHero(false);
          paintLists();
        }
      }, '↩')
    );
  }

  // ---- 単発クリア(1回きり/毎日/毎週曜日/月初) ----
  async function completeSingle(task, card) {
    const now = new Date();
    const prevDone = task.lastDoneKey; // 上書き前(毎日ストリーク計算用)
    const { before, after } = addXp(XP_PER_TASK);
    task.doneAt = Date.now();
    if (task.recur) task.lastDoneKey = periodKey(task.recur);
    task.doneCount = (task.doneCount || 0) + 1;

    // 毎日: HP用に週内の達成日を記録 + 連続日数ストリーク
    if (task.recur && task.recur.type === 'daily') {
      const wk = weekKey(now);
      if (!task.hpWeek || task.hpWeek.key !== wk) task.hpWeek = { key: wk, days: [] };
      const today = dkey(now);
      if (!task.hpWeek.days.includes(today)) task.hpWeek.days.push(today);
      const yKey = 'd' + dkey(new Date(now.getTime() - DAY_MS));
      task.streak = (prevDone === yKey) ? (task.streak || 0) + 1 : 1;
    }
    await putTask(task);

    haptic([16, 40, 24]);
    card.classList.add('slashed');
    card.append(el('div', { class: 'slash-fx' }), el('div', { class: 'exp-pop' }, `+${XP_PER_TASK} EXP`));

    setTimeout(() => {
      paintHero(true);
      paintLists();
      if (after > before) levelUpBanner(after);
    }, 650);
  }

  // ---- 回数タイプの攻撃(1回達成 → HPを1削る) ----
  async function attackCount(task, card, enemy, hpBar, hpLabel) {
    const target = task.recur.target;
    const key = periodKey(task.recur);
    if (!task.progress || task.progress.key !== key) task.progress = { key, count: 0 };
    task.progress.count++;
    const count = task.progress.count;
    const defeated = count >= target;
    if (defeated) {
      task.doneAt = Date.now();
      task.doneCount = (task.doneCount || 0) + 1;
    }
    const { before, after } = addXp(XP_PER_TASK);
    await putTask(task);

    haptic(defeated ? [20, 50, 20, 50, 40] : [14, 30]);

    // HPゲージを1マス削る + 敵ヒット演出
    const cells = hpBar.querySelectorAll('span');
    const remaining = Math.max(0, target - count);
    cells.forEach((c, i) => { c.className = i < remaining ? 'hp' : 'gone'; });
    hpLabel.textContent = `${Math.min(count, target)}/${target}`;
    enemy.classList.remove('hit'); void enemy.offsetWidth; enemy.classList.add('hit');

    const slash = el('div', { class: 'slash-fx mini' });
    const pop = el('div', { class: 'exp-pop' }, `+${XP_PER_TASK} EXP`);
    card.append(slash, pop);
    setTimeout(() => { slash.remove(); pop.remove(); }, 950);

    paintHero(true);

    if (defeated) {
      enemy.classList.add('dead');
      toast('討伐! 今週の目標達成!(月曜にHP回復)');
      setTimeout(() => {
        card.classList.add('slashed');
        setTimeout(() => { paintLists(); if (after > before) levelUpBanner(after); }, 600);
      }, 500);
    } else if (after > before) {
      levelUpBanner(after);
    }
  }

  // ---- タスク追加/編集シート ----
  function openTaskSheet(task = null) {
    const isNew = !task;
    const draft = task || { id: uid(), name: '', recur: null, createdAt: Date.now(), doneAt: null, lastDoneKey: null, doneCount: 0, progress: null };
    let recur = draft.recur ? { ...draft.recur } : null;

    const nameInput = el('input', { type: 'text', maxlength: 60, placeholder: 'れい: 腹筋30回 / 週報を書く', value: draft.name });
    const recurBox = el('div', { class: 'recur-box' });

    function paintRecur() {
      recurBox.innerHTML = '';
      const type = recur?.type ?? null;
      const opts = [
        { key: null, label: '1回きり' },
        { key: 'daily', label: '毎日' },
        { key: 'weekly', label: '毎週(曜日)' },
        { key: 'weekN', label: '週にn回' },
        { key: 'monthly', label: '月初' },
        { key: 'monthN', label: '月にn回' }
      ];
      recurBox.append(el('div', { class: 'recur-row' },
        opts.map((o) => el('button', {
          class: `seg ${type === o.key ? 'on' : ''}`,
          onclick: () => {
            recur = o.key === null ? null
              : o.key === 'weekly' ? { type: 'weekly', day: recur?.day ?? 1 }
              : o.key === 'weekN' ? { type: 'weekN', target: recur?.target ?? 3 }
              : o.key === 'monthN' ? { type: 'monthN', target: recur?.target ?? 10 }
              : { type: o.key };
            paintRecur();
          }
        }, o.label))
      ));

      if (type === 'weekly') {
        recurBox.append(el('div', { class: 'recur-row weekdays' },
          WEEKDAYS.map((w, i) => el('button', {
            class: `seg day ${recur.day === i ? 'on' : ''}`,
            onclick: () => { recur.day = i; paintRecur(); }
          }, w))
        ));
      } else if (type === 'weekN' || type === 'monthN') {
        const max = type === 'weekN' ? 7 : 31;
        recurBox.append(el('div', { class: 'recur-count' },
          el('span', {}, type === 'weekN' ? '週に' : '月に'),
          el('div', { class: 'habit-target' },
            el('button', { onclick: () => { if (recur.target > 1) { recur.target--; paintRecur(); } } }, '−'),
            el('span', { class: 'habit-target-val' }, String(recur.target)),
            el('button', { onclick: () => { if (recur.target < max) { recur.target++; paintRecur(); } } }, '+')
          ),
          el('span', {}, '回 達成でクリア')
        ));
      }

      recurBox.append(el('div', { class: 'field-help' },
        isCountRecur(recur)
          ? `${recurLabel(recur)}が目標。1回ごとに⚔を押して敵のHPを削り、${recur.target}回で討伐。毎週明けの月曜に判定し、達成でHP+${HP_HEAL}%・未達成で-${HP_DMG}%。`
          : recur?.type === 'daily'
          ? `毎日リストに出現。月曜の判定で、その週を7日クリアでHP+${Math.round(HP_HEAL / 2)}%、崩すと-${Math.round(HP_DMG / 2)}%(毎日は半減)。`
          : recur ? `${recurLabel(recur)} にリストへ出現する。`
          : 'クリアすると完了済みへ移動する。'));
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
          const wasCount = isCountRecur(draft.recur);
          draft.recur = recur;
          // 回数タイプに切り替えた/目標が変わった場合はHP進捗を初期化
          if (isCountRecur(recur) && (!wasCount || !draft.progress)) draft.progress = { key: periodKey(recur), count: 0 };
          await putTask(draft);
          if (isNew) tasks.push(draft);
          closeSheet();
          paintLists();
          paintHero(false); // ストリーク行の有無を更新
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
          paintHero(false);
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
        el('h1', { class: 'wizard-title' }, '特訓部屋')
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

  // 月曜チェックの精算を演出(ダメージ優先、なければ回復)
  const totalDmg = dmgEvents.reduce((s, e) => s + e.delta, 0);
  const totalHeal = healEvents.reduce((s, e) => s + e.delta, 0);
  if (dmgEvents.length) {
    haptic([40, 60, 40]);
    const names = dmgEvents.map((e) => `「${e.name}」`).join('・');
    setTimeout(() => {
      paintHero(false, 'damage');
      showBanner({
        iconHtml: `<div class="dmg-heart">${spriteSVG('heart', { size: 90 })}</div>`,
        text: `HP -${totalDmg}% ダメージ!`,
        sub: `先週の未達成: ${names}`,
        cls: 'danger',
        duration: 2800
      });
    }, 500);
  } else if (healEvents.length && totalHeal > 0) {
    setTimeout(() => {
      paintHero(false, 'heal');
      toast(`先週の目標達成! HP +${totalHeal}% 回復`);
    }, 500);
  }

  // 半年ノーダメージ達成 → 金の宝箱GET
  if (goldWin) {
    setTimeout(() => {
      haptic([20, 60, 20, 60, 20, 60, 60]);
      rainConfetti(['#ffcd75', '#e8a33d', '#fff3c4', '#a7f070', '#73eff7'], 90);
      showBanner({
        iconHtml: `<div class="gold-chest-win">${spriteSVG('chestOpen', { size: 120 })}</div>`,
        text: '半年ノーダメージ達成!',
        sub: '金の宝箱をGETした!',
        duration: 3200
      });
    }, dmgEvents.length ? 3200 : 900);
  }
}
