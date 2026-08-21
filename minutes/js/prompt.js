// 議事録を Claude に渡してレポートを作らせるためのプロンプト生成。
// 本文は「音声認識由来の誤りを含む」前提を明示し、Claude が補正しやすい形で渡す。

import { fmtDateTime, fmtDuration } from './util.js';
import { countChars } from './format.js';

export const TEMPLATES = [
  {
    id: 'minutes',
    name: '議事録レポート',
    desc: '要約・決定事項・ToDo・論点を整理した標準の議事録',
    ask: [
      '1. 会議サマリー(200字程度で、読めば全体像がつかめるように)',
      '2. 議題ごとの要点(見出し + 箇条書き。発言の重複はまとめる)',
      '3. 決定事項(決まったことだけを、断定形で)',
      '4. ToDo(内容 / 担当 / 期限。読み取れない項目は「未定」と書く)',
      '5. 未解決の論点・次回への持ち越し',
      '6. 補足(認識ミスと思われる語があれば、推定した正しい表記を挙げる)'
    ]
  },
  {
    id: 'lecture',
    name: '講演レポート',
    desc: '講演・セミナーの内容をレポートとしてまとめる',
    ask: [
      '1. 講演の主旨(200字程度)',
      '2. 論点の構成(話の流れが分かる見出し + 要約)',
      '3. 重要なポイント(箇条書きで5〜10個)',
      '4. 印象的な発言(引用として。原文に近い形で)',
      '5. 用語・固有名詞の解説(専門用語があれば簡潔に)',
      '6. 所感を書くための観点(自分の意見を書き足せるよう、問いの形で3つ)'
    ]
  },
  {
    id: 'todo',
    name: 'ToDo抽出',
    desc: 'やるべきことと期限だけを抜き出す',
    ask: [
      '1. ToDo一覧(表形式: 内容 / 担当 / 期限 / 根拠となる発言の要約)',
      '2. 担当・期限が曖昧なもの(確認が必要な点として)',
      '3. 依頼メールに使える文面(必要な相手ごとに短く)'
    ]
  },
  {
    id: 'summary',
    name: '要約のみ',
    desc: '短くまとめるだけ',
    ask: [
      '1. 3行サマリー',
      '2. 詳しめの要約(400字程度)',
      '3. キーワード(5〜10個)'
    ]
  }
];

export function templateById(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
}

function metaLines(minute) {
  const kind = minute.kind === 'lecture' ? '講演' : '会議';
  const lines = [
    `- 種別: ${kind}`,
    `- タイトル: ${minute.title || '(未設定)'}`,
    `- 日時: ${fmtDateTime(minute.startedAt)}`
  ];
  if (minute.durationMs) lines.push(`- 所要時間: ${fmtDuration(minute.durationMs)}`);
  if (minute.participants?.trim()) lines.push(`- 参加者: ${minute.participants.trim()}`);
  if (minute.memo?.trim()) lines.push(`- 補足メモ: ${minute.memo.trim().replace(/\n/g, ' / ')}`);
  lines.push(`- 文字数: 約${countChars(minute.body)}字`);
  return lines.join('\n');
}

// Claude に投げるプロンプト全文
export function buildPrompt(minute, templateId = 'minutes', extra = '') {
  const tpl = templateById(templateId);
  const kind = minute.kind === 'lecture' ? '講演' : '会議';
  const parts = [
    `以下は${kind}の録音をスマホアプリで文字起こしした記録です。`,
    '音声認識のため、誤変換・言い間違い・重複・話し言葉の乱れが含まれています。',
    '文脈から意味を汲み取って補正しながら読み、日本語でレポートを作成してください。',
    '',
    '## 記録の情報',
    metaLines(minute),
    '',
    `## 作成してほしいもの(${tpl.name})`,
    tpl.ask.join('\n'),
    '',
    '## 守ってほしいこと',
    '- 記録に書かれていない事実を創作しない。推測を書く場合は「推測」と明示する',
    '- 読み取れない箇所は「記録からは判断できない」と書く',
    '- 発言者が特定できる場合のみ名前を添える。不明なら書かない',
    '- 出力は見出し付きの Markdown で、そのまま共有できる体裁にする'
  ];
  if (extra.trim()) {
    parts.push('', '## 追加の指示', extra.trim());
  }
  parts.push('', '## 文字起こし本文', '```', minute.body || '(本文なし)', '```');
  return parts.join('\n');
}

// 書き出し用の議事録 Markdown
export function buildMarkdown(minute) {
  const kind = minute.kind === 'lecture' ? '講演' : '会議';
  const head = [
    `# ${minute.title || '無題の議事録'}`,
    '',
    `- 種別: ${kind}`,
    `- 日時: ${fmtDateTime(minute.startedAt)}`
  ];
  if (minute.durationMs) head.push(`- 所要時間: ${fmtDuration(minute.durationMs)}`);
  if (minute.participants?.trim()) head.push(`- 参加者: ${minute.participants.trim()}`);
  if (minute.memo?.trim()) head.push('', '## メモ', '', minute.memo.trim());
  head.push('', '## 文字起こし', '', minute.body || '');
  return head.join('\n');
}

export const CLAUDE_URL = 'https://claude.ai/new';
