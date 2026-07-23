// マップ作成ウィザード: 入力は最小限(ゴール・裏ゴール・ステップ数)
import { putMap } from '../db.js';
import { el, uid, toast } from '../util.js';
import { spriteSVG } from '../sprites.js';

export function renderWizard(root) {
  let stepCount = 5;

  const goalInput = el('input', { type: 'text', maxlength: 60, placeholder: 'れい: フルマラソン完走' });
  const secretInput = el('input', { type: 'text', maxlength: 60, placeholder: 'れい: サブ4で完走' });

  let secretStepCount = 0; // 裏ゴールまでのステップ(120%クリアの道)
  const secretStepValue = el('div', { class: 'stepper-value' }, String(secretStepCount));
  const secretStepper = el('div', { class: 'stepper' },
    el('button', { 'aria-label': 'へらす', onclick: () => { if (secretStepCount > 0) { secretStepCount--; secretStepValue.textContent = String(secretStepCount); } } }, '−'),
    secretStepValue,
    el('button', { 'aria-label': 'ふやす', onclick: () => { if (secretStepCount < 20) { secretStepCount++; secretStepValue.textContent = String(secretStepCount); } } }, '+')
  );

  const stepValue = el('div', { class: 'stepper-value' }, String(stepCount));
  const stepNames = el('div', { class: 'step-names' });

  function syncStepNames() {
    stepValue.textContent = String(stepCount);
    const inputs = [...stepNames.querySelectorAll('input')];
    while (inputs.length > stepCount) inputs.pop().parentElement.remove();
    for (let i = inputs.length; i < stepCount; i++) {
      stepNames.append(
        el('div', { class: 'step-name-row' },
          el('span', { class: 'num' }, `STEP${i + 1}`),
          el('input', { type: 'text', maxlength: 40, placeholder: 'あとで決めてもOK' })
        )
      );
    }
  }
  syncStepNames();

  const stepper = el('div', { class: 'stepper' },
    el('button', { 'aria-label': 'へらす', onclick: () => { if (stepCount > 1) { stepCount--; syncStepNames(); } } }, '−'),
    stepValue,
    el('button', { 'aria-label': 'ふやす', onclick: () => { if (stepCount < 20) { stepCount++; syncStepNames(); } } }, '+')
  );

  async function create() {
    const goalName = goalInput.value.trim();
    if (!goalName) {
      toast('ゴール(目標)を入力してね');
      goalInput.focus();
      return;
    }
    const secretName = secretInput.value.trim();
    const names = [...stepNames.querySelectorAll('input')].map((i) => i.value.trim());
    const now = Date.now();
    const map = {
      id: uid(),
      createdAt: now,
      steps: Array.from({ length: stepCount }, (_, i) => ({
        id: uid(),
        name: names[i] || `STEP ${i + 1}`,
        memo: '',
        imageId: null,
        clearedAt: null,
        habit: null,
        stamps: []
      })),
      secretSteps: (secretName && secretStepCount > 0)
        ? Array.from({ length: secretStepCount }, (_, i) => ({
            id: uid(),
            name: `裏STEP ${i + 1}`,
            memo: '',
            imageId: null,
            clearedAt: null,
            habit: null,
            stamps: []
          }))
        : [],
      goal: { name: goalName, memo: '', imageId: null, openedAt: null },
      secretGoal: secretName ? { name: secretName, memo: '', imageId: null, openedAt: null } : null,
      lastNodeId: null,
      visited: false
    };
    await putMap(map);
    location.hash = `#map/${map.id}`;
  }

  root.innerHTML = '';
  root.append(
    el('div', { class: 'wizard' },
      el('div', { class: 'wizard-top' },
        el('button', { class: 'icon-btn', 'aria-label': 'もどる', onclick: () => { location.hash = ''; } }, '◀'),
        el('h1', { class: 'wizard-title' }, '新しい冒険')
      ),
      el('div', { class: 'wizard-form' },
        el('div', { class: 'field pixel-panel' },
          el('div', { class: 'field-label' },
            el('span', { html: spriteSVG('chestClosed', { size: 22 }) }),
            'ゴール(目標)',
            el('span', { class: 'tag' }, '必須')
          ),
          goalInput,
          el('div', { class: 'field-help' }, 'たどりつきたい目標。マップの宝箱になる。')
        ),
        el('div', { class: 'field pixel-panel secret' },
          el('div', { class: 'field-label' },
            el('span', { html: spriteSVG('luxeClosed', { size: 24 }) }),
            '裏ゴール(裏目標)',
            el('span', { class: 'tag opt' }, 'おすすめ')
          ),
          secretInput,
          el('div', { class: 'field-help' }, 'ゴールのさらに先の高み。豪華な宝箱としてマップの奥にかくされる。'),
          el('div', { class: 'field-label', style: 'margin-top:14px' }, '裏ゴールまでのステップ（120%クリアの道）'),
          secretStepper,
          el('div', { class: 'field-help' }, '「何を達成すれば120%クリアか」の中間ステップ。0でもOK。あとから追加もできる。')
        ),
        el('div', { class: 'field pixel-panel' },
          el('div', { class: 'field-label' }, 'ステップ数(マイルストーン)'),
          stepper,
          el('div', { class: 'field-help' }, 'ゴールまでの通過点の数。どのステップからクリアしてもOK。'),
          stepNames
        ),
        el('button', { class: 'btn btn-gold btn-big', onclick: create }, 'ダンジョンマップを生成!')
      )
    )
  );
}
