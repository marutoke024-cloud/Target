// ダンジョンマップ画面: スゴロク風マップ + クリア演出 + 宝箱 + 習慣スタンプシート
import { getMap, putMap, putImage, getImageURL, deleteImage, getRecords } from '../db.js';
import { el, uid, fmtDate, haptic, toast, confirmDialog, resizeImage, debounce } from '../util.js';
import { spriteSVG, gemSVG } from '../sprites.js';
import { openRecords } from './records.js';

const GAP = 132;          // ステップ間の縦距離
const SGAP = 132;         // 裏ステップ間の縦距離
const SECRET_GAP = 270;   // 裏ステップが無いときのゴール→裏ゴール距離
const GOAL_EXTRA = 40;
const NODE_SIZE = 52;

// ---- 日付ユーティリティ(スタンプシート用) ----
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayKey() { return dateKey(new Date()); }
function parseKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
function startOfWeek(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; }

// いまの期間(今週/今月)にいくつスタンプが押されているか
function periodCount(step, ref = new Date()) {
  if (!step.habit) return 0;
  const stamps = step.stamps || [];
  if (step.habit.type === 'week') {
    const s = startOfWeek(ref);
    const e = new Date(s); e.setDate(e.getDate() + 7);
    return stamps.filter((k) => { const d = parseKey(k); return d >= s && d < e; }).length;
  }
  const y = ref.getFullYear(), m = ref.getMonth();
  return stamps.filter((k) => { const d = parseKey(k); return d.getFullYear() === y && d.getMonth() === m; }).length;
}

export async function renderMap(root, mapId) {
  const map = await getMap(mapId);
  if (!map) { location.hash = ''; return; }

  const hasSecret = !!map.secretGoal;
  const secretSteps = hasSecret ? map.secretSteps : [];
  const n = map.steps.length;
  const m = secretSteps.length;

  const rerender = () => renderMap(root, mapId);

  // ---- レイアウト計算(下がスタート、上がゴール→裏ゴール) ----
  const width = Math.min(window.innerWidth, 560);
  const cx = width / 2;
  const amp = width * 0.26;
  const topPad = hasSecret ? 170 : 150;
  const bottomPad = 130;
  const secretSpan = hasSecret ? (m > 0 ? (m + 1) * SGAP + 40 : SECRET_GAP) : 0;
  const span = (n + 1) * GAP + GOAL_EXTRA + secretSpan;
  const worldH = topPad + span + bottomPad;
  const startY = worldH - bottomPad;
  const xAt = (k) => cx + amp * Math.sin(k * 1.7 + 0.4);

  const pts = [];
  const startPt = { x: xAt(0), y: startY, kind: 'start' };
  pts.push(startPt);
  map.steps.forEach((s, i) => {
    pts.push({ x: xAt(i + 1), y: startY - (i + 1) * GAP, kind: 'step', step: s, index: i });
  });
  const goalPt = { x: cx + amp * 0.35 * Math.sin((n + 1) * 1.7 + 0.4), y: startY - (n + 1) * GAP - GOAL_EXTRA, kind: 'goal' };
  pts.push(goalPt);
  const secretStepPts = [];
  let secretPt = null;
  if (hasSecret) {
    secretSteps.forEach((s, j) => {
      const p = { x: xAt(n + 2 + j), y: goalPt.y - (j + 1) * SGAP, kind: 'secretStep', step: s, index: j };
      secretStepPts.push(p);
      pts.push(p);
    });
    secretPt = { x: cx, y: goalPt.y - secretSpan, kind: 'secret' };
    pts.push(secretPt);
  }

  // ---- DOM構築 ----
  const world = el('div', { class: 'map-world' });
  world.style.height = `${worldH}px`;
  world.style.background = buildSkyGradient(worldH, hasSecret, goalPt.y);
  world.innerHTML = buildTerrainSVG(map.id, width, worldH, pts, hasSecret);

  const viewport = el('div', { class: 'map-viewport' }, world);

  // 霧(裏ゴールゾーンを隠す)
  let fog = null;
  if (hasSecret) {
    fog = el('div', { class: `fog ${map.goal.openedAt ? 'lifted' : ''}` },
      el('div', { class: 'fog-q' }, '???'),
      el('div', { class: 'fog-t' }, 'ゴールの先に なにかが ねむっている…')
    );
    fog.style.top = '0px';
    fog.style.height = `${Math.max(120, goalPt.y - 90)}px`;
    world.append(fog);
  }

  // スタート地点
  world.append(
    el('div', { class: 'map-node', style: `left:${startPt.x}px; top:${startPt.y}px` },
      el('div', { class: 'node-face', html: spriteSVG('flag', { size: 44 }) }),
      el('div', { class: 'node-label' }, 'スタート')
    )
  );

  // ステップノード + 裏ステップノード(共通処理)
  const nodeEls = new Map(); // step.id -> { el, step, kind, index, point }

  function buildStepNode(step, kind, index, point) {
    const node = el('button', {
      class: `map-node ${kind === 'secretStep' ? 'secret-step-node' : ''}`,
      style: `left:${point.x}px; top:${point.y}px`,
      'aria-label': step.name,
      onclick: () => openStepSheet(step, kind, index)
    });
    world.append(node);
    nodeEls.set(step.id, { el: node, step, kind, index, point });
    paintStepNode(step.id);
    return node;
  }

  map.steps.forEach((step, i) => buildStepNode(step, 'step', i, pts[i + 1]));
  secretSteps.forEach((step, j) => buildStepNode(step, 'secretStep', j, secretStepPts[j]));

  // ゴール宝箱
  const goalNode = el('button', {
    class: 'map-node goal-node',
    style: `left:${goalPt.x}px; top:${goalPt.y}px`,
    'aria-label': 'ゴール',
    onclick: () => openGoalSheet(false)
  });
  world.append(goalNode);

  // 裏ゴール宝箱
  let secretNode = null;
  if (hasSecret) {
    secretNode = el('button', {
      class: 'map-node secret-node',
      style: `left:${secretPt.x}px; top:${secretPt.y}px`,
      'aria-label': '裏ゴール',
      onclick: () => openGoalSheet(true)
    });
    world.append(secretNode);
  }

  // 勇者
  const hero = el('div', { class: 'hero-sprite', html: spriteSVG('hero', { size: 34 }) });
  world.append(hero);

  // ヘッダー
  const progressEl = el('div', { class: 'map-header-progress' });
  const recordBadge = el('span', { class: 'badge', style: 'display:none' });
  const header = el('div', { class: 'map-header' },
    el('button', { class: 'icon-btn', 'aria-label': 'ホームへもどる', onclick: () => { location.hash = ''; } }, '◀'),
    el('div', { class: 'map-header-info' },
      el('div', { class: 'map-header-title' }, map.goal.name),
      progressEl
    ),
    el('button', {
      class: 'icon-btn record-btn',
      'aria-label': '記録帳をひらく',
      html: spriteSVG('book', { size: 26 }),
      onclick: () => openRecords(map)
    }, recordBadge)
  );

  const screen = el('div', { class: 'map-screen' }, viewport, header);
  root.innerHTML = '';
  root.append(screen);

  paintGoalNodes();
  updateProgress();
  placeHero(false);

  getRecords(map.id).then((rs) => {
    if (rs.length > 0) {
      recordBadge.style.display = 'flex';
      recordBadge.textContent = rs.length > 99 ? '99+' : String(rs.length);
    }
  });

  if (!map.visited) {
    map.visited = true;
    putMap(map);
    viewport.scrollTop = 0;
    setTimeout(() => viewport.scrollTo({ top: heroScrollTop(), behavior: 'smooth' }), 900);
  } else {
    viewport.scrollTop = heroScrollTop();
  }

  // ======================================================
  function heroScrollTop() {
    const p = heroPoint();
    return Math.max(0, p.y - window.innerHeight * 0.62);
  }
  function heroPoint() {
    if (map.lastNodeId) {
      const idx = map.steps.findIndex((s) => s.id === map.lastNodeId);
      if (idx >= 0 && map.steps[idx].clearedAt) return pts[idx + 1];
      const sidx = secretSteps.findIndex((s) => s.id === map.lastNodeId);
      if (sidx >= 0 && secretSteps[sidx].clearedAt) return secretStepPts[sidx];
      if (map.lastNodeId === 'goal') return goalPt;
      if (map.lastNodeId === 'secret' && secretPt) return secretPt;
    }
    return startPt;
  }
  function placeHero(animated) {
    const p = heroPoint();
    if (!animated) hero.style.transition = 'none';
    hero.style.left = `${p.x + 26}px`;
    hero.style.top = `${p.y - 14}px`;
    if (!animated) requestAnimationFrame(() => { hero.style.transition = ''; });
  }

  function updateProgress() {
    const cleared = map.steps.filter((s) => s.clearedAt).length;
    let txt = `▶ ${cleared}/${n} ステップ`;
    if (map.goal.openedAt) txt += '  ★GOAL';
    if (m > 0) {
      const sc = secretSteps.filter((s) => s.clearedAt).length;
      txt += `  裏${sc}/${m}`;
    }
    if (map.secretGoal && map.secretGoal.openedAt) txt += '  ★裏GOAL';
    progressEl.textContent = txt;
  }

  function paintGoalNodes() {
    const allCleared = map.steps.every((s) => s.clearedAt);
    const opened = !!map.goal.openedAt;
    goalNode.classList.toggle('locked', !allCleared && !opened);
    goalNode.classList.toggle('ready', allCleared && !opened);
    goalNode.innerHTML = '';
    goalNode.append(
      el('div', { class: 'node-face', html: spriteSVG(opened ? 'chestOpen' : 'chestClosed', { size: 78 }) },
        (!allCleared && !opened) ? el('span', { class: 'node-lock', html: spriteSVG('lock', { size: 22 }) }) : null
      ),
      el('div', { class: 'node-label' }, `GOAL: ${map.goal.name}`)
    );
    if (secretNode) {
      const sOpened = !!map.secretGoal.openedAt;
      const secretStepsDone = secretSteps.every((s) => s.clearedAt);
      const canOpen = opened && secretStepsDone;
      secretNode.classList.toggle('locked', !canOpen && !sOpened);
      secretNode.classList.toggle('ready', canOpen && !sOpened);
      secretNode.innerHTML = '';
      secretNode.append(
        el('div', { class: 'node-face', html: spriteSVG(sOpened ? 'luxeOpen' : 'luxeClosed', { size: 92 }) }),
        el('div', { class: 'node-label' }, opened ? `裏ゴール: ${map.secretGoal.name}` : '？？？')
      );
    }
  }

  function paintStepNode(id) {
    const info = nodeEls.get(id);
    if (!info) return;
    const { el: node, step, index, kind } = info;
    node.classList.toggle('cleared', !!step.clearedAt);
    node.innerHTML = '';
    const face = el('div', { class: 'node-face' });
    const gemIdx = kind === 'secretStep' ? index + 2 : index;
    face.innerHTML = step.clearedAt ? gemSVG(gemIdx, NODE_SIZE) : spriteSVG('rock', { size: NODE_SIZE });
    if (!step.clearedAt) face.append(el('span', { class: 'node-num' }, kind === 'secretStep' ? '★' : String(index + 1)));
    else face.append(el('span', { class: 'node-check' }, '✓'));
    if (step.imageId) face.append(el('span', { class: 'node-photo' }, '📷'));
    if (step.habit) face.append(el('span', { class: 'node-stamp', html: spriteSVG('stamp', { size: 16 }) }));
    const children = [face, el('div', { class: 'node-label' }, step.name)];
    if (step.habit && !step.clearedAt) {
      const c = periodCount(step);
      const done = c >= step.habit.target;
      children.push(el('div', { class: `node-habit ${done ? 'done' : ''}` },
        `${step.habit.type === 'week' ? '今週' : '今月'} ${c}/${step.habit.target}${done ? ' ✓' : ''}`));
    }
    node.append(...children);
  }

  // ---- ズーム・スクロール・演出 ----
  function zoomTo(p, scale = 1.9) { world.style.transformOrigin = `${p.x}px ${p.y}px`; world.style.transform = `scale(${scale})`; }
  function unzoom() { world.style.transform = 'scale(1)'; }
  function scrollToPoint(p) { viewport.scrollTo({ top: Math.max(0, p.y - window.innerHeight * 0.5), behavior: 'smooth' }); }

  function burstParticles(p, colors) {
    for (let i = 0; i < 14; i++) {
      const ang = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
      const dist = 46 + Math.random() * 55;
      const s = el('div', { class: 'particle' });
      s.style.left = `${p.x}px`; s.style.top = `${p.y}px`;
      s.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
      s.style.setProperty('--dy', `${Math.sin(ang) * dist}px`);
      const size = 5 + Math.floor(Math.random() * 6);
      s.style.width = `${size}px`; s.style.height = `${size}px`;
      s.style.background = colors[i % colors.length];
      world.append(s);
      setTimeout(() => s.remove(), 950);
    }
  }
  function rainConfetti(colors, count = 60) {
    for (let i = 0; i < count; i++) {
      const c = el('div', { class: 'confetti' });
      c.style.left = `${Math.random() * 100}vw`;
      c.style.width = '8px'; c.style.height = `${6 + Math.random() * 8}px`;
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = `${1.3 + Math.random() * 1.4}s`;
      c.style.animationDelay = `${Math.random() * 0.7}s`;
      document.body.append(c);
      setTimeout(() => c.remove(), 3600);
    }
  }
  function showBanner(text, starKind, purple) {
    const banner = el('div', { class: `clear-banner ${purple ? 'purple' : ''}` },
      el('div', { class: 'banner-star', html: spriteSVG(starKind, { size: 96 }) }),
      el('div', { class: 'banner-text' }, text)
    );
    document.body.append(banner);
    setTimeout(() => { banner.style.transition = 'opacity .5s'; banner.style.opacity = '0'; setTimeout(() => banner.remove(), 550); }, 2100);
  }

  // ---- ステップ / 裏ステップのシート ----
  function openStepSheet(step, kind, index) {
    const isSecret = kind === 'secretStep';
    const point = isSecret ? secretStepPts[index] : pts[index + 1];
    scrollToPoint(point);

    const nameInput = el('input', { type: 'text', maxlength: 40, value: step.name });
    const memoInput = el('textarea', { maxlength: 300, placeholder: 'メモ(まいにち10分…など)' });
    memoInput.value = step.memo || '';

    const save = debounce(async () => {
      step.name = nameInput.value.trim() || step.name;
      step.memo = memoInput.value;
      await putMap(map);
      paintStepNode(step.id);
    }, 500);
    nameInput.addEventListener('input', save);
    memoInput.addEventListener('input', save);

    const persist = async () => { await putMap(map); paintStepNode(step.id); };

    const body = [
      el('div', { class: 'sheet-head' },
        el('span', { html: step.clearedAt ? gemSVG(isSecret ? index + 2 : index, 40) : spriteSVG('rock', { size: 40 }) }),
        el('div', {},
          el('div', { class: `sheet-kind ${isSecret ? 'purple' : ''}` },
            isSecret ? `裏STEP ${index + 1} / ${m}(120%クリアの道)` : `STEP ${index + 1} / ${n}`)
        )
      ),
      nameInput,
      memoInput,
      habitSection(step, persist),
      photoAttach(step, persist)
    ];

    if (step.clearedAt) {
      body.push(el('div', { class: 'sheet-date' }, `✓ ${fmtDate(step.clearedAt)} クリア!`));
      body.push(el('button', {
        class: 'undo-link',
        onclick: async () => {
          if (!(await confirmDialog('このステップのクリアを取り消す?'))) return;
          step.clearedAt = null;
          if (map.lastNodeId === step.id) map.lastNodeId = null;
          await putMap(map);
          closeSheet();
          paintStepNode(step.id); paintGoalNodes(); updateProgress(); placeHero(true);
        }
      }, 'クリアを取り消す'));
    } else {
      body.push(el('button', {
        class: `btn ${isSecret ? 'btn-purple' : 'btn-primary'} btn-big`,
        onclick: async () => {
          step.name = nameInput.value.trim() || step.name;
          step.memo = memoInput.value;
          step.clearedAt = Date.now();
          map.lastNodeId = step.id;
          await putMap(map);
          closeSheet();
          clearSequence(step, kind, index);
        }
      }, 'クリアした!'));
    }

    if (isSecret) {
      body.push(el('button', {
        class: 'undo-link danger',
        onclick: async () => {
          if (!(await confirmDialog(`裏STEP「${step.name}」を削除する?`, { okText: '削除する', danger: true }))) return;
          map.secretSteps = map.secretSteps.filter((s) => s.id !== step.id);
          if (map.lastNodeId === step.id) map.lastNodeId = null;
          await putMap(map);
          closeSheet();
          rerender();
        }
      }, 'このステップを削除'));
    }

    openSheet(body);
  }

  function clearSequence(step, kind, index) {
    const point = kind === 'secretStep' ? secretStepPts[index] : pts[index + 1];
    haptic([16, 40, 24]);
    scrollToPoint(point);
    setTimeout(() => zoomTo(point), 380);
    setTimeout(() => {
      paintStepNode(step.id);
      burstParticles(point, ['#ffcd75', '#a7f070', '#73eff7', '#f4f4f4']);
      updateProgress();
    }, 1000);
    setTimeout(() => { unzoom(); placeHero(true); }, 1750);

    if (kind === 'step' && map.steps.every((s) => s.clearedAt) && !map.goal.openedAt) {
      setTimeout(() => {
        paintGoalNodes();
        scrollToPoint(goalPt);
        goalNode.querySelector('.node-face')?.classList.add('chest-shake');
        toast('すべてのステップをクリア! ゴールの宝箱がひらけるぞ!');
      }, 2600);
    }
    if (kind === 'secretStep' && map.goal.openedAt && secretSteps.every((s) => s.clearedAt) && !map.secretGoal.openedAt) {
      setTimeout(() => {
        paintGoalNodes();
        if (secretPt) scrollToPoint(secretPt);
        secretNode?.querySelector('.node-face')?.classList.add('chest-shake');
        toast('裏ステップ制覇! 豪華な宝箱がひらけるぞ!');
      }, 2600);
    }
  }

  // ---- ゴール / 裏ゴールのシート ----
  function openGoalSheet(isSecret) {
    const target = isSecret ? map.secretGoal : map.goal;
    const p = isSecret ? secretPt : goalPt;
    scrollToPoint(p);

    const memoInput = el('textarea', { maxlength: 300, placeholder: 'この目標へのおもい・ごほうびメモなど' });
    memoInput.value = target.memo || '';
    const save = debounce(async () => { target.memo = memoInput.value; await putMap(map); }, 500);
    memoInput.addEventListener('input', save);

    const remaining = map.steps.filter((s) => !s.clearedAt).length;
    const secretRemaining = secretSteps.filter((s) => !s.clearedAt).length;
    const opened = !!target.openedAt;
    const canOpen = isSecret ? (!!map.goal.openedAt && secretRemaining === 0) : remaining === 0;

    const chestSprite = isSecret ? (opened ? 'luxeOpen' : 'luxeClosed') : (opened ? 'chestOpen' : 'chestClosed');

    const body = [
      el('div', { class: 'sheet-head' },
        el('span', { html: spriteSVG(chestSprite, { size: 52 }) }),
        el('div', {},
          el('div', { class: `sheet-kind ${isSecret ? 'purple' : 'gold'}` }, isSecret ? '裏ゴール(裏目標)' : 'GOAL(目標)'),
          el('div', { style: 'font-size:17px; margin-top:2px; word-break:break-word' }, target.name)
        )
      ),
      memoInput,
      photoAttach(target, () => putMap(map))
    ];

    // 裏ゴールシートには「120%クリアの道」ステップ管理を出す
    if (isSecret) {
      body.push(el('div', { class: 'secret-steps-box' },
        el('div', { class: 'secret-steps-title' }, `120%クリアの道: 裏ステップ ${secretSteps.length}個`),
        el('button', {
          class: 'btn btn-ghost',
          onclick: async () => {
            map.secretSteps.push({ id: uid(), name: `裏STEP ${map.secretSteps.length + 1}`, memo: '', imageId: null, clearedAt: null, habit: null, stamps: [] });
            await putMap(map);
            closeSheet();
            rerender();
          }
        }, '＋ 裏ステップを追加')
      ));
    }

    if (opened) {
      body.push(el('div', { class: 'sheet-date' }, `★ ${fmtDate(target.openedAt)} 達成!`));
      body.push(el('button', {
        class: 'undo-link',
        onclick: async () => {
          if (!(await confirmDialog('達成を取り消す?(星も棚からはずれます)'))) return;
          target.openedAt = null;
          if (map.lastNodeId === (isSecret ? 'secret' : 'goal')) map.lastNodeId = null;
          await putMap(map);
          closeSheet();
          paintGoalNodes(); updateProgress();
          if (!isSecret && fog) fog.classList.remove('lifted');
          placeHero(true);
        }
      }, '達成を取り消す'));
    } else if (isSecret) {
      let hint = '';
      if (!map.goal.openedAt) hint = 'まずゴールを達成しよう';
      else if (secretRemaining > 0) hint = `のこり ${secretRemaining} 個の裏ステップでひらく`;
      body.push(el('button', {
        class: 'btn btn-purple btn-big',
        disabled: canOpen ? null : 'disabled',
        onclick: async () => {
          target.openedAt = Date.now(); map.lastNodeId = 'secret';
          await putMap(map); closeSheet(); openChestSequence(true);
        }
      }, canOpen ? '裏ゴール達成! 豪華な宝箱をあける' : hint));
    } else {
      body.push(el('button', {
        class: 'btn btn-gold btn-big',
        disabled: canOpen ? null : 'disabled',
        onclick: async () => {
          target.openedAt = Date.now(); map.lastNodeId = 'goal';
          await putMap(map); closeSheet(); openChestSequence(false);
        }
      }, canOpen ? '宝箱をあける!' : `のこり ${remaining} ステップでひらく`));
      if (!canOpen) body.push(el('div', { class: 'field-help', style: 'margin-top:8px' }, 'すべてのステップをクリアすると宝箱がひらく。'));
    }

    openSheet(body);
  }

  function openChestSequence(isSecret) {
    const p = isSecret ? secretPt : goalPt;
    haptic([20, 60, 20, 60, 40]);
    scrollToPoint(p);
    setTimeout(() => zoomTo(p, 1.7), 380);
    setTimeout(() => {
      paintGoalNodes(); updateProgress();
      burstParticles(p, isSecret ? ['#d9a0f0', '#7d3f8d', '#ffcd75', '#73eff7'] : ['#ffcd75', '#ffe08a', '#fff7d6', '#e8a33d']);
    }, 1000);
    setTimeout(() => {
      rainConfetti(isSecret ? ['#b06ad4', '#7d3f8d', '#ffcd75', '#73eff7', '#f4f4f4'] : ['#ffcd75', '#e8a33d', '#a7f070', '#73eff7', '#f4f4f4']);
      showBanner(isSecret ? '裏ゴール制覇!!' : 'GOAL 達成!', isSecret ? 'starPurple' : 'starGold', isSecret);
    }, 1400);
    setTimeout(() => {
      unzoom(); placeHero(true);
      if (!isSecret && fog) {
        fog.classList.add('lifted');
        if (secretPt) setTimeout(() => scrollToPoint(secretStepPts[0] || secretPt), 900);
      }
    }, 3400);
  }

  // ---- 習慣スタンプシート ----
  function habitSection(step, persist) {
    const wrap = el('div', { class: 'habit-section' });
    const cal = { y: new Date().getFullYear(), m: new Date().getMonth() };

    async function toggleStamp(k) {
      const i = step.stamps.indexOf(k);
      if (i >= 0) step.stamps.splice(i, 1); else step.stamps.push(k);
      haptic(8);
      await persist();
      render();
    }

    function render() {
      wrap.innerHTML = '';
      if (!step.habit) {
        wrap.append(el('button', {
          class: 'btn btn-ghost habit-enable',
          onclick: async () => { step.habit = { type: 'week', target: 2 }; await persist(); render(); }
        }, '📅 スタンプシートで習慣を記録する'));
        return;
      }

      // 頻度タイプ切り替え + 目標回数
      const typeRow = el('div', { class: 'habit-config' },
        el('div', { class: 'habit-seg' },
          el('button', { class: `seg ${step.habit.type === 'week' ? 'on' : ''}`, onclick: async () => { step.habit.type = 'week'; await persist(); render(); } }, '週'),
          el('button', { class: `seg ${step.habit.type === 'month' ? 'on' : ''}`, onclick: async () => { step.habit.type = 'month'; await persist(); render(); } }, '月')
        ),
        el('span', { class: 'habit-config-txt' }, 'に'),
        el('div', { class: 'habit-target' },
          el('button', { onclick: async () => { if (step.habit.target > 1) { step.habit.target--; await persist(); render(); } } }, '−'),
          el('span', { class: 'habit-target-val' }, String(step.habit.target)),
          el('button', { onclick: async () => { if (step.habit.target < 31) { step.habit.target++; await persist(); render(); } } }, '+')
        ),
        el('span', { class: 'habit-config-txt' }, '回'),
        el('button', {
          class: 'habit-off',
          onclick: async () => { if (await confirmDialog('スタンプシートをやめる?(押したスタンプも消えます)', { okText: 'やめる', danger: true })) { step.habit = null; step.stamps = []; await persist(); render(); } }
        }, '解除')
      );

      // 今期間の達成度サマリー
      const c = periodCount(step);
      const done = c >= step.habit.target;
      const summary = el('div', { class: `habit-summary ${done ? 'done' : ''}` },
        `${step.habit.type === 'week' ? '今週' : '今月'}: ${c} / ${step.habit.target} 回${done ? '  達成! ✓' : ''}`,
        el('span', { class: 'habit-total' }, `累計 ${step.stamps.length}コ`)
      );

      wrap.append(typeRow, summary, buildCalendar());
    }

    function buildCalendar() {
      const box = el('div', { class: 'stamp-cal' });
      const monthLabel = el('div', { class: 'stamp-cal-title' }, `${cal.y}年 ${cal.m + 1}月`);
      box.append(el('div', { class: 'stamp-cal-nav' },
        el('button', { class: 'stamp-nav-btn', 'aria-label': '前の月', onclick: () => { cal.m--; if (cal.m < 0) { cal.m = 11; cal.y--; } render(); } }, '◀'),
        monthLabel,
        el('button', { class: 'stamp-nav-btn', 'aria-label': '次の月', onclick: () => { cal.m++; if (cal.m > 11) { cal.m = 0; cal.y++; } render(); } }, '▶')
      ));

      const weekMode = step.habit.type === 'week';
      const grid = el('div', { class: `stamp-grid ${weekMode ? 'with-week' : ''}` });
      for (const h of ['日', '月', '火', '水', '木', '金', '土']) grid.append(el('div', { class: 'stamp-head' }, h));
      if (weekMode) grid.append(el('div', { class: 'stamp-head wk' }, '週計'));

      const lead = new Date(cal.y, cal.m, 1).getDay();
      const days = new Date(cal.y, cal.m + 1, 0).getDate();
      const rows = Math.ceil((lead + days) / 7);
      const tKey = todayKey();
      let dnum = 1 - lead;
      for (let r = 0; r < rows; r++) {
        let weekCount = 0;
        for (let i = 0; i < 7; i++, dnum++) {
          if (dnum < 1 || dnum > days) { grid.append(el('div', { class: 'stamp-cell empty' })); continue; }
          const d = new Date(cal.y, cal.m, dnum);
          const k = dateKey(d);
          const on = step.stamps.includes(k);
          if (on) weekCount++;
          const future = k > tKey;
          grid.append(el('button', {
            class: `stamp-cell ${on ? 'on' : ''} ${k === tKey ? 'today' : ''} ${future ? 'future' : ''}`,
            disabled: future ? 'disabled' : null,
            onclick: future ? null : () => toggleStamp(k)
          },
            el('span', { class: 'stamp-num' }, String(dnum)),
            on ? el('span', { class: 'stamp-mark', html: spriteSVG('stamp', { size: 22 }) }) : null
          ));
        }
        if (weekMode) {
          const met = weekCount >= step.habit.target;
          grid.append(el('div', { class: `stamp-week ${met ? 'met' : ''}` }, weekCount ? `${weekCount}/${step.habit.target}` : '·'));
        }
      }
      box.append(grid);
      return box;
    }

    render();
    return wrap;
  }

  // ---- 画像添付 ----
  function photoAttach(entity, onChange) {
    const wrap = el('div', { class: 'photo-attach' });
    async function paint() {
      wrap.innerHTML = '';
      const url = await getImageURL(entity.imageId);
      if (url) {
        wrap.append(
          el('img', { class: 'thumb', src: url, alt: '添付画像', onclick: () => viewImage(url) }),
          el('button', {
            class: 'remove-photo',
            onclick: async () => { await deleteImage(entity.imageId); entity.imageId = null; await onChange(); paint(); }
          }, '画像をはずす')
        );
      } else {
        const file = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
        file.addEventListener('change', async () => {
          if (!file.files || !file.files[0]) return;
          try {
            const blob = await resizeImage(file.files[0]);
            const id = uid();
            await putImage(id, blob);
            if (entity.imageId) await deleteImage(entity.imageId);
            entity.imageId = id;
            await onChange(); paint();
          } catch (err) { toast(err.message || '画像を追加できませんでした'); }
        });
        wrap.append(el('button', { class: 'attach-btn', onclick: () => file.click() }, '📷 画像をつける'), file);
      }
    }
    paint();
    return wrap;
  }
}

// ---- シート(モーダル)共通 ----
let sheetEl = null;
function openSheet(children) {
  closeSheet();
  const root = document.getElementById('overlay-root');
  sheetEl = el('div', { class: 'sheet-backdrop', onclick: (e) => { if (e.target === sheetEl) closeSheet(); } },
    el('div', { class: 'sheet' }, el('div', { class: 'sheet-grip' }), children)
  );
  root.append(sheetEl);
}
function closeSheet() { if (sheetEl) { sheetEl.remove(); sheetEl = null; } }

export function viewImage(url) {
  const root = document.getElementById('overlay-root');
  const v = el('div', { class: 'img-viewer', onclick: () => v.remove() }, el('img', { src: url, alt: '' }));
  root.append(v);
}

// ---- 空・地形の生成 ----
function buildSkyGradient(worldH, hasSecret, goalY) {
  const secretEnd = hasSecret ? Math.round(((goalY - 150) / worldH) * 100) : 0;
  if (hasSecret) {
    return `linear-gradient(180deg,
      #14061f 0%,
      #2b1a3a ${Math.max(4, secretEnd - 14)}%,
      #1a1c2c ${secretEnd}%,
      #29366f ${secretEnd + 18}%,
      #3b5dc9 78%,
      #41a6f6 100%)`;
  }
  return `linear-gradient(180deg, #1a1c2c 0%, #29366f 30%, #3b5dc9 78%, #41a6f6 100%)`;
}

function seededRand(seed) {
  let s = 0;
  for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function buildTerrainSVG(seed, w, h, pts, hasSecret) {
  const rand = seededRand(seed);
  let out = `<svg class="map-terrain" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">`;
  const hillColors = ['#38b764', '#2f9e57', '#257179', '#1f5f66', '#29366f'];
  const layers = Math.ceil(h / 230);
  for (let i = 0; i < layers; i++) {
    const y = h - i * 230;
    const c = hillColors[Math.min(i === 0 ? 0 : (i % 2 === 0 ? 1 : 2), 4)];
    const off = rand() * w;
    out += `<path d="M0 ${y} Q ${w * 0.25 + off * 0.1} ${y - 90 - rand() * 60} ${w * 0.5} ${y - 40 - rand() * 40} T ${w} ${y - 60 - rand() * 50} L ${w} ${y + 230} L 0 ${y + 230} Z" fill="${c}" opacity="${i === 0 ? 1 : 0.55}"/>`;
  }
  if (hasSecret) {
    const starZone = pts[pts.length - 1].y + 120;
    for (let i = 0; i < 26; i++) {
      const sx = rand() * w, sy = rand() * starZone, ss = rand() < 0.2 ? 3 : 2;
      out += `<rect x="${sx.toFixed(0)}" y="${sy.toFixed(0)}" width="${ss}" height="${ss}" fill="${rand() < 0.3 ? '#d9a0f0' : '#f4f4f4'}" opacity="${0.5 + rand() * 0.5}"/>`;
    }
  }
  const path = smoothPath(pts);
  out += `<path d="${path}" fill="none" stroke="#3a2317" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>`;
  out += `<path d="${path}" fill="none" stroke="#c98a4b" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>`;
  out += `<path d="${path}" fill="none" stroke="#e8b877" stroke-width="4" stroke-dasharray="2 14" stroke-linecap="round"/>`;
  for (let i = 0; i < Math.floor(h / 90); i++) {
    const fx = 14 + rand() * (w - 28), fy = 80 + rand() * (h - 160), kind = rand();
    if (kind < 0.45) {
      out += `<rect x="${fx}" y="${fy}" width="4" height="4" fill="#a7f070"/><rect x="${fx - 4}" y="${fy + 4}" width="4" height="4" fill="#a7f070"/><rect x="${fx + 4}" y="${fy + 4}" width="4" height="4" fill="#a7f070"/>`;
    } else if (kind < 0.75) {
      out += `<rect x="${fx}" y="${fy}" width="5" height="5" fill="#ffcd75"/><rect x="${fx + 1.5}" y="${fy + 1.5}" width="2" height="2" fill="#ef7d57"/>`;
    } else {
      out += `<rect x="${fx + 4}" y="${fy}" width="8" height="10" fill="#257179"/><rect x="${fx}" y="${fy + 6}" width="16" height="8" fill="#38b764"/><rect x="${fx + 6}" y="${fy + 14}" width="4" height="7" fill="#3a2317"/>`;
    }
  }
  out += '</svg>';
  return out;
}

function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}
