// 装備画面: 取得した武具を装備し、アバターに反映する
import { getAllMaps } from '../db.js';
import { el, toast, haptic } from '../util.js';
import { GEAR, SLOTS, gearSVG, gearName, gearTier } from '../gear.js';
import { avatarSVG } from '../avatar.js';
import { loadPlayer, savePlayerState } from './training.js';

export async function renderEquip(root) {
  const maps = await getAllMaps();

  // 取得済み武具(宝箱で入手した戦利品)
  const ownedSet = new Set();
  for (const mp of maps) {
    if (mp.goal?.openedAt && mp.goal.lootId) ownedSet.add(mp.goal.lootId);
    if (mp.secretGoal?.openedAt && mp.secretGoal.lootId) ownedSet.add(mp.secretGoal.lootId);
  }
  const owned = [...ownedSet];

  const player = loadPlayer();
  const equip = player.equip;

  const preview = el('div', { class: 'equip-preview' });
  function paintPreview() {
    preview.innerHTML = avatarSVG(equip, 130);
  }
  paintPreview();

  function save() {
    const p = loadPlayer();
    p.equip = equip;
    savePlayerState(p);
  }

  const slotsWrap = el('div', { class: 'equip-slots' });
  function paintSlots() {
    slotsWrap.innerHTML = '';
    for (const slot of SLOTS) {
      const ownedInSlot = owned.filter((id) => GEAR[id].slot === slot.key);
      const section = el('div', { class: 'equip-slot' },
        el('div', { class: 'equip-slot-head' },
          el('span', { class: 'equip-slot-label' }, slot.label),
          equip[slot.key] ? el('span', { class: 'equip-slot-cur' }, gearName(equip[slot.key])) : el('span', { class: 'equip-slot-none' }, '未装備')
        ),
        el('div', { class: 'equip-choices' },
          ownedInSlot.length === 0
            ? el('span', { class: 'equip-empty' }, 'この部位の武具はまだない')
            : [
                // はずすボタン
                el('button', {
                  class: `equip-item off ${!equip[slot.key] ? 'on' : ''}`,
                  onclick: () => { equip[slot.key] = null; save(); paintPreview(); paintSlots(); }
                }, 'なし'),
                ...ownedInSlot.map((id) => el('button', {
                  class: `equip-item ${gearTier(id)} ${equip[slot.key] === id ? 'on' : ''}`,
                  title: gearName(id),
                  onclick: () => {
                    equip[slot.key] = id;
                    save();
                    haptic(10);
                    paintPreview();
                    paintSlots();
                  }
                },
                  el('span', { class: 'equip-item-icon', html: gearSVG(id, 30) }),
                  el('span', { class: 'equip-item-name' }, gearName(id))
                ))
              ]
        )
      );
      slotsWrap.append(section);
    }
  }
  paintSlots();

  root.innerHTML = '';
  root.append(
    el('div', { class: 'equip' },
      el('div', { class: 'wizard-top' },
        el('button', { class: 'icon-btn', 'aria-label': 'ホームへもどる', onclick: () => { location.hash = ''; } }, '◀'),
        el('h1', { class: 'wizard-title' }, 'そうび')
      ),
      el('div', { class: 'equip-stage pixel-panel' },
        preview,
        el('div', { class: 'equip-count' }, `所持そうび ${owned.length} / ${Object.keys(GEAR).length}`)
      ),
      owned.length === 0
        ? el('div', { class: 'dojo-empty' }, 'まだ武具がない。', el('br'), 'ダンジョンの宝箱をあけて手に入れよう!')
        : slotsWrap
    )
  );
}
