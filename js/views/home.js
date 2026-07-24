// ホーム画面: 武具コレクション(実績) + 装備 + 特訓部屋 + ダンジョンマップ一覧
import { getAllMaps, deleteMap, putMap, getAllTasks } from '../db.js';
import { el, confirmDialog, toast } from '../util.js';
import { spriteSVG } from '../sprites.js';
import { GEAR, gearSVG, gearName, gearTier, rollLoot } from '../gear.js';
import { avatarSVG } from '../avatar.js';
import { loadPlayer, levelFromXp, titleFor } from './training.js';

let showLocked = false; // 施錠ダンジョンの表示状態(セッション中のみ保持)

export async function renderHome(root) {
  const maps = await getAllMaps();

  // 戦利品機能より前に開けた宝箱には、あとから中身を割り当てる
  for (const map of maps) {
    let changed = false;
    if (map.goal.openedAt && !map.goal.lootId) { map.goal.lootId = rollLoot('normal'); changed = true; }
    if (map.secretGoal?.openedAt && !map.secretGoal.lootId) { map.secretGoal.lootId = rollLoot('luxe'); changed = true; }
    if (changed) await putMap(map);
  }

  // 取得済みの武具(取得順)= 実績一覧
  const loot = [];
  const ownedSet = new Set();
  for (const m of maps) {
    if (m.goal.openedAt && m.goal.lootId) { loot.push({ id: m.goal.lootId, at: m.goal.openedAt, from: m.goal.name }); ownedSet.add(m.goal.lootId); }
    if (m.secretGoal?.openedAt && m.secretGoal.lootId) { loot.push({ id: m.secretGoal.lootId, at: m.secretGoal.openedAt, from: m.goal.name }); ownedSet.add(m.secretGoal.lootId); }
  }
  loot.sort((a, b) => a.at - b.at);

  const player = loadPlayer();

  // 武具コレクション(実績)+ 装備アバター
  const shelf = el('section', { class: 'gear-shelf pixel-panel' },
    el('button', { class: 'gear-shelf-avatar', 'aria-label': '装備を変更', onclick: () => { location.hash = '#equip'; } },
      el('div', { class: 'gear-avatar-frame', html: avatarSVG(player.equip, 68) }),
      el('span', { class: 'gear-avatar-tag' }, 'そうび ▸')
    ),
    el('div', { class: 'gear-shelf-main' },
      el('div', { class: 'gear-shelf-title' },
        el('span', { class: 'gear-shelf-icon', html: gearSVG('iron_sword', 16) }),
        `武具コレクション  ${ownedSet.size}/${Object.keys(GEAR).length}`
      ),
      el('div', { class: 'gear-shelf-row' },
        loot.length === 0
          ? el('span', { class: 'star-shelf-empty' }, '宝箱から伝説の武具が手に入る…')
          : loot.map((l) => el('span', {
              class: `gear-item ${gearTier(l.id)}`,
              title: `${gearName(l.id)}(${l.from})`,
              onclick: () => toast(`${gearName(l.id)} - 「${l.from}」の宝箱から入手`),
              html: gearSVG(l.id, 30)
            }))
      )
    )
  );

  // ステータスの書の入口
  const statusCard = el('button', { class: 'status-entry pixel-panel', onclick: () => { location.hash = '#status'; } },
    el('span', { class: 'status-entry-icon', html: spriteSVG('medal', { size: 34 }) }),
    el('div', { class: 'status-entry-info' },
      el('div', { class: 'status-entry-title' }, 'ステータスの書'),
      el('div', { class: 'status-entry-sub' }, '現在の自分 と 理想の自分')
    ),
    el('span', { class: 'dojo-entry-arrow' }, '▶')
  );

  // 特訓部屋の入口
  const { level, rest, need } = levelFromXp(player.xp);
  let pendingCount = 0;
  try {
    const tasks = await getAllTasks();
    pendingCount = tasks.filter((t) => t.recur ? true : !t.doneAt).length; // ざっくり: 保有メニュー数
  } catch { /* 初回はストア未作成でも無視 */ }
  const blocks = 10;
  const filled = Math.min(blocks, Math.round((rest / need) * blocks));
  const hp = player.hp ?? 100;
  const hpFilled = Math.round(hp / 10);
  const hpCls = hp <= 20 ? 'crit' : hp <= 40 ? 'low' : '';
  const dojoCard = el('button', { class: 'dojo-entry pixel-panel', onclick: () => { location.hash = '#training'; } },
    el('span', { class: `dojo-entry-sprite ${hp <= 20 ? 'weak' : ''}`, html: avatarSVG(player.equip, 44) }),
    el('div', { class: 'dojo-entry-info' },
      el('div', { class: 'dojo-entry-title' }, '特訓部屋 ',
        el('span', { class: 'dojo-entry-lv' }, `Lv.${level}`),
        el('span', { class: 'dojo-title-tag' }, titleFor(level)),
        (player.goldChests > 0)
          ? el('span', { class: 'dojo-goldchest', html: spriteSVG('chestClosed', { size: 16 }) + `<b>×${player.goldChests}</b>` })
          : null
      ),
      el('div', { class: 'pixbar xp-bar small' },
        Array.from({ length: blocks }, (_, i) => el('span', { class: i < filled ? 'xp-on' : '' }))
      ),
      el('div', { class: 'dojo-entry-hp' },
        el('span', { class: 'dojo-hp-icon', html: spriteSVG('heart', { size: 12 }) }),
        el('div', { class: `pixbar hp-gauge small ${hpCls}` },
          Array.from({ length: 10 }, (_, i) => el('span', { class: i < hpFilled ? 'hp-on' : '' }))
        ),
        el('span', { class: `dojo-hp-pct ${hpCls}` }, `${hp}%`)
      )
    ),
    el('span', { class: 'dojo-entry-arrow' }, '▶')
  );

  // ダンジョン一覧(施錠は通常非表示)
  const lockedMaps = maps.filter((m) => m.locked);
  const visibleMaps = showLocked ? maps : maps.filter((m) => !m.locked);

  const listHead = el('div', { class: 'map-list-head' },
    el('span', { class: 'map-list-title' }, '▼ ダンジョン'),
    lockedMaps.length > 0
      ? el('button', {
          class: `lock-reveal ${showLocked ? 'open' : ''}`,
          'aria-label': showLocked ? '施錠ダンジョンをかくす' : '施錠ダンジョンを表示',
          onclick: () => { showLocked = !showLocked; renderHome(root); }
        },
          el('span', { html: spriteSVG('lock', { size: 20 }) }),
          `×${lockedMaps.length}`
        )
      : null
  );

  const list = el('div', { class: 'map-list' },
    maps.length === 0
      ? el('div', { class: 'empty-state pixel-panel' },
          el('div', { html: spriteSVG('chestClosed', { size: 84 }) }),
          'まだ ダンジョンマップが ない!',
          el('br'),
          '「+」から さいしょの冒険を はじめよう'
        )
      : visibleMaps.length === 0
        ? el('div', { class: 'empty-state pixel-panel' },
            el('div', { html: spriteSVG('lock', { size: 60 }) }),
            'すべてのダンジョンが施錠中。',
            el('br'),
            '上の鍵アイコンをタップすると あらわれる'
          )
        : visibleMaps.map((m) => mapCard(m, root))
  );

  root.innerHTML = '';
  root.append(
    el('div', { class: 'home' },
      el('h1', { class: 'home-logo' }, 'クエストダンジョン'),
      el('div', { class: 'home-sub' }, '- 目標達成RPG -'),
      shelf,
      statusCard,
      dojoCard,
      listHead,
      list
    ),
    el('button', { class: 'fab', 'aria-label': '新しいマップを作る', onclick: () => { location.hash = '#new'; } }, '+')
  );
}

function mapCard(map, root) {
  const total = map.steps.length;
  const cleared = map.steps.filter((s) => s.clearedAt).length;
  const goalOpened = !!map.goal.openedAt;
  const secretOpened = !!(map.secretGoal && map.secretGoal.openedAt);

  const bar = el('div', { class: 'pixbar map-card-progress' },
    map.steps.map((s) => el('span', { class: s.clearedAt ? 'on' : '' })),
    el('span', { class: goalOpened ? 'goal-on' : '' })
  );

  const secretSteps = map.secretSteps || [];
  const secretBar = secretSteps.length
    ? el('div', { class: 'pixbar pixbar-secret' },
        secretSteps.map((s) => el('span', { class: s.clearedAt ? 'secret-on' : '' })),
        el('span', { class: secretOpened ? 'secret-goal-on' : '' })
      )
    : null;

  const stars = el('div', { class: 'map-card-stars' });
  if (goalOpened) stars.append(el('span', { html: spriteSVG('starGold', { size: 22 }) }));
  if (secretOpened) stars.append(el('span', { html: spriteSVG('starPurple', { size: 22 }) }));

  const chest = secretOpened ? 'luxeOpen' : goalOpened ? 'chestOpen' : 'chestClosed';

  const card = el('button', { class: `map-card pixel-panel ${map.locked ? 'is-locked' : ''}`, onclick: () => { location.hash = `#map/${map.id}`; } },
    el('div', { class: 'map-card-head' },
      el('span', { html: spriteSVG(chest, { size: 40 }) }),
      el('div', { class: 'map-card-title' }, map.goal.name),
      stars
    ),
    map.secretGoal
      ? el('div', { class: `map-card-secret ${goalOpened ? 'unlocked' : ''}` },
          goalOpened ? `裏ゴール: ${map.secretGoal.name}` : '裏ゴール: ？？？')
      : null,
    el('div', { class: 'map-card-foot' },
      bar,
      el('span', { class: 'map-card-count' }, `${cleared}/${total}`)
    ),
    secretBar
      ? el('div', { class: 'map-card-foot secret' },
          secretBar,
          el('span', { class: 'map-card-count' }, `裏 ${secretSteps.filter((s) => s.clearedAt).length}/${secretSteps.length}`)
        )
      : null
  );

  const lockBtn = el('button', {
    class: `map-card-lock ${map.locked ? 'locked' : ''}`,
    'aria-label': map.locked ? 'ロックをはずす' : 'ロックする',
    onclick: async (e) => {
      e.stopPropagation();
      map.locked = !map.locked;
      await putMap(map);
      toast(map.locked ? 'ダンジョンを施錠した(ホームで非表示)' : 'ロックをはずした');
      renderHome(root);
    }
  }, map.locked ? '🔒' : '🔓');

  const menuBtn = el('button', {
    class: 'map-card-menu',
    'aria-label': 'マップを削除',
    onclick: async (e) => {
      e.stopPropagation();
      const ok = await confirmDialog(`「${map.goal.name}」のマップを削除する?\n記録もすべて消えます。`, { okText: '削除する', danger: true });
      if (ok) {
        await deleteMap(map.id);
        toast('マップを削除しました');
        renderHome(root);
      }
    }
  }, '×');

  return el('div', { style: 'position:relative' }, card, lockBtn, menuBtn);
}
