// 宝物の洞窟: ほしいものリスト。金額・入手期限つきの「まだ見ぬお宝」を並べる
import { getAllWishes, putWish, deleteWish } from '../db.js';
import {
  el, uid, fmtDate, haptic, toast, confirmDialog,
  openSheet, closeSheet, rainConfetti, showBanner
} from '../util.js';
import { spriteSVG } from '../sprites.js';

const DAY_MS = 86400000;

// 金額帯によって宝石のランクが上がる
const GEM_RANKS = [
  { max: 5000, colors: { A: '#38b764', B: '#a7f070', E: '#257179' }, label: '小さなお宝' },
  { max: 30000, colors: { A: '#3b5dc9', B: '#73eff7', E: '#29366f' }, label: 'そこそこのお宝' },
  { max: 100000, colors: { A: '#7d3f8d', B: '#d9a0f0', E: '#4a1f5d' }, label: '大きなお宝' },
  { max: Infinity, colors: { A: '#e8a33d', B: '#ffe08a', E: '#a86a1a' }, label: '伝説のお宝' }
];
function rankOf(price) {
  const p = Number(price) || 0;
  return GEM_RANKS.find((r) => p < r.max) || GEM_RANKS[0];
}
function gemFor(price, size, dim) {
  const r = rankOf(price);
  const c = dim
    ? { A: '#3a4466', B: '#566c86', E: '#2b3350', W: '#94b0c2' }
    : { ...r.colors, W: '#ffffff' };
  return spriteSVG('gem', { colors: c, size });
}
function yen(n) {
  const v = Number(n) || 0;
  return '¥' + v.toLocaleString('ja-JP');
}
// 期限までの残り日数(YYYY-MM-DD)
function daysLeft(deadline) {
  if (!deadline) return null;
  const [y, m, d] = deadline.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / DAY_MS);
}

export async function renderCave(root) {
  let wishes = await getAllWishes();

  const listEl = el('div', { class: 'cave-list' });
  const gotEl = el('div', { class: 'cave-got-list' });
  const gotWrap = el('details', { class: 'dojo-done cave-got' },
    el('summary', {}, '手に入れたお宝'),
    gotEl
  );
  const summaryEl = el('div', { class: 'cave-summary pixel-panel' });

  function paintSummary() {
    const wanting = wishes.filter((w) => !w.gotAt);
    const total = wanting.reduce((s, w) => s + (Number(w.price) || 0), 0);
    const got = wishes.filter((w) => w.gotAt);
    const gotTotal = got.reduce((s, w) => s + (Number(w.price) || 0), 0);
    summaryEl.innerHTML = '';
    summaryEl.append(
      el('div', { class: 'cave-summary-row' },
        el('span', { class: 'cave-summary-icon', html: spriteSVG('coin', { size: 22 }) }),
        el('div', { class: 'cave-summary-main' },
          el('div', { class: 'cave-summary-label' }, `お宝 ${wanting.length}コ ぶんの ひつよう金額`),
          el('div', { class: 'cave-summary-total' }, yen(total))
        )
      )
    );
    if (got.length) {
      summaryEl.append(el('div', { class: 'cave-summary-got' }, `これまでに ${got.length}コ(${yen(gotTotal)})を 手に入れた!`));
    }
  }

  function paintLists() {
    const wanting = wishes.filter((w) => !w.gotAt)
      .sort((a, b) => {
        const da = daysLeft(a.deadline), db = daysLeft(b.deadline);
        if (da == null && db == null) return a.createdAt - b.createdAt;
        if (da == null) return 1;
        if (db == null) return -1;
        return da - db;
      });
    const got = wishes.filter((w) => w.gotAt);

    listEl.innerHTML = '';
    if (wanting.length === 0) {
      listEl.append(el('div', { class: 'cave-empty' },
        'この洞窟には まだ お宝がない。', el('br'),
        '「＋」で ほしいものを きざもう'));
    }
    for (const w of wanting) listEl.append(wishCard(w));

    gotEl.innerHTML = '';
    if (got.length === 0) gotEl.append(el('div', { class: 'dojo-empty small' }, 'まだない'));
    for (const w of got.slice().reverse()) gotEl.append(gotCard(w));
    gotWrap.querySelector('summary').textContent = `手に入れたお宝 (${got.length})`;
  }

  function wishCard(w) {
    const left = daysLeft(w.deadline);
    let dl = null;
    if (left != null) {
      const cls = left < 0 ? 'over' : left <= 7 ? 'soon' : '';
      dl = el('span', { class: `cave-deadline ${cls}` },
        left < 0 ? `期限すぎ ${-left}日` : left === 0 ? '今日まで!' : `のこり ${left}日`);
    }
    return el('div', { class: 'cave-item pixel-panel' },
      el('button', { class: 'cave-item-body', onclick: () => openWishSheet(w) },
        el('span', { class: 'cave-gem', html: gemFor(w.price, 40) }),
        el('div', { class: 'cave-item-info' },
          el('div', { class: 'cave-item-top' },
            el('span', { class: 'cave-item-name' }, w.name),
            dl
          ),
          el('div', { class: 'cave-item-meta' },
            w.price ? el('span', { class: 'cave-price' },
              el('span', { class: 'cave-price-icon', html: spriteSVG('coin', { size: 12 }) }),
              yen(w.price)) : null,
            el('span', { class: 'cave-rank' }, rankOf(w.price).label),
            w.deadline ? el('span', { class: 'cave-date' }, `〜${w.deadline.replace(/-/g, '/')}`) : null
          ),
          w.memo ? el('div', { class: 'cave-memo' }, w.memo) : null
        )
      ),
      el('button', {
        class: 'cave-get',
        'aria-label': '手に入れた',
        onclick: (e) => { e.stopPropagation(); claimWish(w); }
      }, '⛏')
    );
  }

  function gotCard(w) {
    return el('div', { class: 'dojo-task done' },
      el('span', { class: 'dojo-task-icon', html: gemFor(w.price, 22) }),
      el('div', { class: 'dojo-task-name' },
        w.name,
        el('div', { class: 'dojo-done-meta' },
          `✓ ${fmtDate(w.gotAt)} 入手` + (w.price ? ` ・ ${yen(w.price)}` : ''))
      ),
      el('button', {
        class: 'dojo-undo',
        'aria-label': '入手を取り消す',
        onclick: async () => {
          w.gotAt = null;
          await putWish(w);
          paintSummary(); paintLists();
        }
      }, '↩')
    );
  }

  async function claimWish(w) {
    w.gotAt = Date.now();
    await putWish(w);
    haptic([20, 60, 20, 60, 40]);
    rainConfetti(['#ffcd75', '#e8a33d', '#73eff7', '#a7f070', '#f4f4f4'], 70);
    showBanner({
      iconHtml: `<div class="cave-reveal">${gemFor(w.price, 110)}</div>`,
      text: 'お宝を手に入れた!',
      sub: `${w.name}${w.price ? ` (${yen(w.price)})` : ''}`,
      duration: 2800
    });
    paintSummary(); paintLists();
  }

  // ---- 追加/編集シート ----
  function openWishSheet(wish) {
    const isNew = !wish;
    const draft = wish || { id: uid(), name: '', price: '', deadline: '', memo: '', gotAt: null, createdAt: Date.now() };

    const nameInput = el('input', { type: 'text', maxlength: 60, value: draft.name, placeholder: '例: 新しいノートPC' });
    const priceInput = el('input', { type: 'number', inputmode: 'numeric', min: '0', value: draft.price ?? '', placeholder: '例: 180000' });
    const dateInput = el('input', { type: 'date', value: draft.deadline || '' });
    const memoInput = el('textarea', { maxlength: 200, placeholder: 'メモ(型番・お店・なぜほしいか など)' });
    memoInput.value = draft.memo || '';

    const preview = el('span', { class: 'cave-sheet-gem', html: gemFor(draft.price, 46) });
    priceInput.addEventListener('input', () => { preview.innerHTML = gemFor(priceInput.value, 46); });

    const body = [
      el('div', { class: 'sheet-head' },
        preview,
        el('div', {},
          el('div', { class: 'sheet-kind gold' }, isNew ? 'お宝をきざむ' : 'お宝を編集'),
          el('div', { class: 'cave-sheet-hint' }, '金額が高いほど 宝石のランクが上がる')
        )
      ),
      el('div', { class: 'field-label' }, 'ほしいもの'),
      nameInput,
      el('div', { class: 'field-label', style: 'margin-top:10px' }, '金額(円)'),
      priceInput,
      el('div', { class: 'field-label', style: 'margin-top:10px' }, 'いつまでに手に入れる?'),
      dateInput,
      el('div', { class: 'field-label', style: 'margin-top:10px' }, 'メモ'),
      memoInput,
      el('button', {
        class: 'btn btn-primary btn-big',
        onclick: async () => {
          const name = nameInput.value.trim();
          if (!name) { toast('ほしいものを入力してね'); nameInput.focus(); return; }
          draft.name = name;
          draft.price = priceInput.value ? Number(priceInput.value) : null;
          draft.deadline = dateInput.value || '';
          draft.memo = memoInput.value.trim();
          await putWish(draft);
          if (isNew) wishes.push(draft);
          closeSheet();
          paintSummary(); paintLists();
        }
      }, isNew ? 'きざむ' : '保存する')
    ];

    if (!isNew && !draft.gotAt) {
      body.push(el('button', {
        class: 'btn btn-gold btn-big', style: 'margin-top:10px',
        onclick: async () => { closeSheet(); await claimWish(draft); }
      }, '⛏ 手に入れた!'));
    }

    if (!isNew) {
      body.push(el('button', {
        class: 'undo-link danger',
        onclick: async () => {
          if (!(await confirmDialog(`「${draft.name}」を洞窟から消す?`, { okText: '削除する', danger: true }))) return;
          await deleteWish(draft.id);
          wishes = wishes.filter((x) => x.id !== draft.id);
          closeSheet();
          paintSummary(); paintLists();
        }
      }, 'このお宝を削除'));
    }

    openSheet(body);
  }

  root.innerHTML = '';
  root.append(
    el('div', { class: 'cave' },
      el('div', { class: 'wizard-top' },
        el('button', { class: 'icon-btn', 'aria-label': 'ホームへもどる', onclick: () => { location.hash = ''; } }, '◀'),
        el('h1', { class: 'wizard-title' }, '宝物の洞窟')
      ),
      summaryEl,
      el('div', { class: 'dojo-section-title cave-title' }, '▼ まだ見ぬ お宝'),
      listEl,
      el('button', { class: 'btn btn-gold btn-big dojo-add', onclick: () => openWishSheet(null) }, '＋ ほしいものをきざむ'),
      gotWrap
    )
  );
  paintSummary();
  paintLists();
}
