// ステータスの書: 現在の自分と理想の自分を RPG のステータス画面として可視化する
// kind: 'cert'(資格・称号) | 'trait'(スキル・持ち味)
// state: 'have'(現在の自分) | 'want'(理想の自分)
import { getAllSkills, putSkill, deleteSkill } from '../db.js';
import {
  el, uid, fmtDate, haptic, toast, confirmDialog,
  openSheet, closeSheet, rainConfetti, showBanner
} from '../util.js';
import { spriteSVG } from '../sprites.js';
import { avatarSVG } from '../avatar.js';
import { loadPlayer, levelFromXp, titleFor } from './training.js';

let activeTab = 'have'; // セッション中は選択タブを保持

// シルエット(未取得)配色
const GHOST_MEDAL = { R: '#3a4466', r: '#475077', D: '#232b45', G: '#566c86', g: '#3f4866', W: '#7a8fa5' };
const GEM_HAVE = [
  { A: '#38b764', B: '#a7f070', E: '#257179' },
  { A: '#3b5dc9', B: '#73eff7', E: '#29366f' },
  { A: '#e8a33d', B: '#ffe08a', E: '#a86a1a' },
  { A: '#b13e53', B: '#ff9aa8', E: '#7a2436' },
  { A: '#7d3f8d', B: '#d9a0f0', E: '#4a1f5d' }
];
const GEM_WANT = { A: '#3a4466', B: '#566c86', E: '#2b3350', W: '#94b0c2' };

function gemIcon(index, want, size = 22) {
  const c = want ? GEM_WANT : { ...GEM_HAVE[index % GEM_HAVE.length], W: '#ffffff' };
  return spriteSVG('gem', { colors: c, size });
}

export async function renderStatus(root) {
  let skills = await getAllSkills();
  const player = loadPlayer();
  const { level } = levelFromXp(player.xp);

  const panel = el('div', { class: 'status-panel' });
  const tabsEl = el('div', { class: 'status-tabs' });
  const progressEl = el('div', { class: 'status-progress pixel-panel' });

  function counts() {
    const have = skills.filter((s) => s.state === 'have').length;
    const want = skills.filter((s) => s.state === 'want').length;
    return { have, want, total: have + want };
  }

  function paintTabs() {
    tabsEl.innerHTML = '';
    const { have, want } = counts();
    tabsEl.append(
      el('button', {
        class: `status-tab now ${activeTab === 'have' ? 'on' : ''}`,
        onclick: () => { activeTab = 'have'; paintAll(); }
      }, `現在の自分 (${have})`),
      el('button', {
        class: `status-tab ideal ${activeTab === 'want' ? 'on' : ''}`,
        onclick: () => { activeTab = 'want'; paintAll(); }
      }, `理想の自分 (${want})`)
    );
  }

  function paintProgress() {
    const { have, total } = counts();
    progressEl.innerHTML = '';
    if (total === 0) { progressEl.style.display = 'none'; return; }
    progressEl.style.display = '';
    const blocks = 14;
    const filled = Math.round((have / total) * blocks);
    progressEl.append(
      el('div', { class: 'status-progress-head' },
        el('span', { html: spriteSVG('starGold', { size: 16 }) }),
        el('span', { class: 'status-progress-title' }, '理想への達成度'),
        el('span', { class: 'status-progress-num' }, `${have} / ${total}`)
      ),
      el('div', { class: 'pixbar status-bar' },
        Array.from({ length: blocks }, (_, i) => el('span', { class: i < filled ? 'goal-on' : '' }))
      )
    );
  }

  function paintPanel() {
    const want = activeTab === 'want';
    panel.classList.toggle('ideal', want);
    panel.innerHTML = '';

    const certs = skills.filter((s) => s.kind === 'cert' && s.state === activeTab);
    const traits = skills.filter((s) => s.kind === 'trait' && s.state === activeTab);

    // --- 資格・称号(勲章) ---
    panel.append(sectionHead(
      want ? '目指す資格・称号' : '資格・称号の書',
      spriteSVG('medal', { size: 18, colors: want ? GHOST_MEDAL : undefined }),
      () => openSkillSheet(null, 'cert')
    ));
    if (certs.length === 0) {
      panel.append(el('div', { class: 'status-empty' },
        want ? 'まだ目標の資格がない。「＋」でほしい称号をきざもう'
             : 'まだ資格がない。とったことのある資格を「＋」でしるそう'));
    } else {
      panel.append(el('div', { class: 'medal-grid' },
        certs.map((s) => el('button', {
          class: `medal-item ${want ? 'ghost' : ''}`,
          onclick: () => openSkillSheet(s)
        },
          el('span', { class: 'medal-face', html: spriteSVG('medal', { size: 44, colors: want ? GHOST_MEDAL : undefined }) },
            want ? el('span', { class: 'medal-q' }, '?') : null
          ),
          el('span', { class: 'medal-name' }, s.name)
        ))
      ));
    }

    // --- スキル・持ち味 ---
    panel.append(sectionHead(
      want ? '未習得スキル(理想の強み)' : 'かくとくスキル(強み)',
      gemIcon(1, want, 16),
      () => openSkillSheet(null, 'trait')
    ));
    if (traits.length === 0) {
      panel.append(el('div', { class: 'status-empty' },
        want ? '「こうなりたい」という強みを「＋」で書きとめよう'
             : 'つちかってきた持ち味・アピールポイントを「＋」でしるそう'));
    } else {
      panel.append(el('div', { class: 'skill-list' },
        traits.map((s, i) => el('button', {
          class: `skill-row ${want ? 'ghost' : ''}`,
          onclick: () => openSkillSheet(s)
        },
          el('span', { class: 'skill-gem', html: gemIcon(i, want) }),
          el('span', { class: 'skill-body' },
            el('span', { class: 'skill-name' }, s.name),
            s.detail ? el('span', { class: 'skill-detail' }, s.detail) : null
          ),
          want
            ? el('span', { class: 'skill-state want' }, '未習得')
            : el('span', { class: 'skill-state' }, s.acquiredAt ? `習得 ${fmtDate(s.acquiredAt)}` : 'Lv.MAX')
        ))
      ));
    }
  }

  function sectionHead(title, iconHtml, onAdd) {
    return el('div', { class: 'status-section-head' },
      el('span', { class: 'status-section-icon', html: iconHtml }),
      el('span', { class: 'status-section-title' }, title),
      el('button', { class: 'status-add', 'aria-label': '追加', onclick: onAdd }, '＋')
    );
  }

  function paintAll() { paintTabs(); paintProgress(); paintPanel(); }

  // ---- 追加/編集シート ----
  function openSkillSheet(skill, presetKind) {
    const isNew = !skill;
    const draft = skill || { id: uid(), kind: presetKind || 'cert', name: '', detail: '', state: activeTab, acquiredAt: null, createdAt: Date.now() };
    let kind = draft.kind;
    let state = draft.state;

    const nameInput = el('input', {
      type: 'text', maxlength: 60, value: draft.name,
      placeholder: kind === 'cert' ? '例: TOEIC900点 / 日商簿記2級' : '例: 判断能力に長けている'
    });
    const detailInput = el('textarea', { maxlength: 200, placeholder: 'アピールメモ(どう強いか・根拠・エピソードなど)' });
    detailInput.value = draft.detail || '';

    const kindSeg = el('div', { class: 'recur-row' });
    const stateSeg = el('div', { class: 'recur-row' });
    function paintSegs() {
      kindSeg.innerHTML = '';
      kindSeg.append(
        el('button', { class: `seg ${kind === 'cert' ? 'on' : ''}`, onclick: () => { kind = 'cert'; nameInput.placeholder = '例: TOEIC900点 / 日商簿記2級'; paintSegs(); } }, '🎖 資格・称号'),
        el('button', { class: `seg ${kind === 'trait' ? 'on' : ''}`, onclick: () => { kind = 'trait'; nameInput.placeholder = '例: 判断能力に長けている'; paintSegs(); } }, '💠 スキル・持ち味')
      );
      stateSeg.innerHTML = '';
      stateSeg.append(
        el('button', { class: `seg ${state === 'have' ? 'on' : ''}`, onclick: () => { state = 'have'; paintSegs(); } }, '現在の自分'),
        el('button', { class: `seg ideal-seg ${state === 'want' ? 'on' : ''}`, onclick: () => { state = 'want'; paintSegs(); } }, '理想の自分')
      );
    }
    paintSegs();

    const body = [
      el('div', { class: 'sheet-head' },
        el('span', { html: kind === 'cert' ? spriteSVG('medal', { size: 40 }) : gemIcon(1, false, 36) }),
        el('div', {}, el('div', { class: 'sheet-kind' }, isNew ? 'ステータスを書きこむ' : 'ステータスを編集'))
      ),
      kindSeg,
      nameInput,
      detailInput,
      el('div', { class: 'field-label', style: 'margin-top:4px' }, 'どちらの自分?'),
      stateSeg,
      el('button', {
        class: 'btn btn-primary btn-big',
        onclick: async () => {
          const name = nameInput.value.trim();
          if (!name) { toast('内容を入力してね'); nameInput.focus(); return; }
          draft.name = name;
          draft.detail = detailInput.value.trim();
          draft.kind = kind;
          draft.state = state;
          await putSkill(draft);
          if (isNew) skills.push(draft);
          closeSheet();
          paintAll();
        }
      }, isNew ? '書きこむ' : '保存する')
    ];

    // 理想 → 現在への昇格(習得!)
    if (!isNew && draft.state === 'want') {
      body.push(el('button', {
        class: 'btn btn-gold btn-big', style: 'margin-top:10px',
        onclick: async () => {
          draft.name = nameInput.value.trim() || draft.name;
          draft.detail = detailInput.value.trim();
          draft.kind = kind;
          draft.state = 'have';
          draft.acquiredAt = Date.now();
          await putSkill(draft);
          closeSheet();
          haptic([20, 60, 20, 60, 40]);
          rainConfetti(['#ffcd75', '#e8a33d', '#a7f070', '#73eff7', '#f4f4f4'], 70);
          showBanner({
            iconHtml: `<div class="levelup-hero">${kind === 'cert' ? spriteSVG('medal', { size: 100 }) : gemIcon(0, false, 90)}</div>`,
            text: kind === 'cert' ? '資格・称号 GET!' : 'スキル習得!!',
            sub: `「${draft.name}」が 現在の自分に きざまれた!`,
            duration: 3000
          });
          activeTab = 'have';
          paintAll();
        }
      }, kind === 'cert' ? '🎖 取得した!(現在の自分へ)' : '✨ 習得した!(現在の自分へ)'));
    }

    if (!isNew && draft.state === 'have') {
      body.push(el('button', {
        class: 'undo-link',
        onclick: async () => {
          draft.state = 'want';
          draft.acquiredAt = null;
          await putSkill(draft);
          closeSheet();
          paintAll();
        }
      }, '理想(未習得)へ戻す'));
    }

    if (!isNew) {
      body.push(el('button', {
        class: 'undo-link danger',
        onclick: async () => {
          if (!(await confirmDialog(`「${draft.name}」を削除する?`, { okText: '削除する', danger: true }))) return;
          await deleteSkill(draft.id);
          skills = skills.filter((s) => s.id !== draft.id);
          closeSheet();
          paintAll();
        }
      }, 'この項目を削除'));
    }

    openSheet(body);
  }

  // ---- 画面組み立て ----
  root.innerHTML = '';
  root.append(
    el('div', { class: 'status' },
      el('div', { class: 'wizard-top' },
        el('button', { class: 'icon-btn', 'aria-label': 'ホームへもどる', onclick: () => { location.hash = ''; } }, '◀'),
        el('h1', { class: 'wizard-title' }, 'ステータスの書')
      ),
      el('div', { class: 'status-card pixel-panel' },
        el('div', { class: 'status-avatar', html: avatarSVG(player.equip, 64) }),
        el('div', { class: 'status-card-info' },
          el('div', { class: 'dojo-level' }, `Lv.${level} `, el('span', { class: 'dojo-title-tag' }, titleFor(level))),
          el('div', { class: 'status-card-sub' }, 'おのれを知る者は 強くなる──')
        )
      ),
      tabsEl,
      progressEl,
      panel
    )
  );
  paintAll();
}
