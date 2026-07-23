// ホーム画面: 実績の星棚 + ダンジョンマップ一覧
import { getAllMaps, deleteMap } from '../db.js';
import { el, confirmDialog, toast } from '../util.js';
import { spriteSVG } from '../sprites.js';

export async function renderHome(root) {
  const maps = await getAllMaps();

  const goldStars = maps.filter((m) => m.goal.openedAt);
  const purpleStars = maps.filter((m) => m.secretGoal && m.secretGoal.openedAt);

  const shelf = el('section', { class: 'star-shelf pixel-panel' },
    el('div', { class: 'star-shelf-title' },
      el('span', { html: spriteSVG('starGold', { size: 18 }) }),
      `じっせき  金の星 ×${goldStars.length}  紫の星 ×${purpleStars.length}`
    ),
    el('div', { class: 'star-shelf-row' },
      (goldStars.length === 0 && purpleStars.length === 0)
        ? el('span', { class: 'star-shelf-empty' }, 'ゴールの宝箱をあけると ここに星がならぶ')
        : [
            ...goldStars.map((m) => shelfStar(m, 'gold')),
            ...purpleStars.map((m) => shelfStar(m, 'purple'))
          ]
    )
  );

  const list = el('div', { class: 'map-list' },
    maps.length === 0
      ? el('div', { class: 'empty-state pixel-panel' },
          el('div', { html: spriteSVG('chestClosed', { size: 84 }) }),
          'まだ ダンジョンマップが ない!',
          el('br'),
          '「+」から さいしょの冒険を はじめよう'
        )
      : maps.map(mapCard)
  );

  root.innerHTML = '';
  root.append(
    el('div', { class: 'home' },
      el('h1', { class: 'home-logo' }, 'クエストダンジョン'),
      el('div', { class: 'home-sub' }, '- 目標達成RPG -'),
      shelf,
      list
    ),
    el('button', { class: 'fab', 'aria-label': '新しいマップを作る', onclick: () => { location.hash = '#new'; } }, '+')
  );
}

function shelfStar(map, kind) {
  return el('div', { class: `shelf-star ${kind}` },
    el('button', {
      title: map.goal.name,
      'aria-label': map.goal.name,
      onclick: () => { location.hash = `#map/${map.id}`; },
      html: spriteSVG(kind === 'gold' ? 'starGold' : 'starPurple', { size: 34 })
    })
  );
}

function mapCard(map) {
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

  const card = el('button', { class: 'map-card pixel-panel', onclick: () => { location.hash = `#map/${map.id}`; } },
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

  const menuBtn = el('button', {
    class: 'map-card-menu',
    'aria-label': 'マップを削除',
    onclick: async (e) => {
      e.stopPropagation();
      const ok = await confirmDialog(`「${map.goal.name}」のマップを削除する?\n記録もすべて消えます。`, { okText: '削除する', danger: true });
      if (ok) {
        await deleteMap(map.id);
        toast('マップを削除しました');
        renderHome(document.getElementById('app'));
      }
    }
  }, '×');

  const wrap = el('div', { style: 'position:relative' }, card, menuBtn);
  return wrap;
}
