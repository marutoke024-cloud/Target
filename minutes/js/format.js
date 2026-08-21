// 日本語の文字起こしテキストを読みやすい議事録の形に整える。
//
//  1. normalize()  … 認識結果のゆらぎ(余分な空白など)をならす
//  2. punctuate()  … 音声認識は句読点を出力しないので、文末・節の切れ目に「。」「、」を補う
//  3. wrap()       … 句点・読点のタイミングで改行し、1行が長くなり過ぎないようにする
//
// いずれも推測に基づくため、整形結果はユーザーが後から自由に編集できる前提。

// 1行の目安文字数
export const LINE_PRESETS = { short: 16, normal: 22, long: 30 };
export const DEFAULT_MAX = LINE_PRESETS.normal;

// 直前の句読点からこれ以上離れていなければ読点を打たない(読点だらけを防ぐ)
const SOFT_MIN = 12;

const SENT_MARKS = '。！？!?';
const ALL_MARKS = '。、！？!?，';
const CLOSERS = '」』）)】〉》”’';

const byLengthDesc = (a, b) => b.length - a.length;

// 文末になりやすい語尾(丁寧体中心)。長いものから照合する
const SENT_TAILS = [
  'ませんでした', 'ましたでしょうか', 'ませんでしょうか', 'ないでしょうか',
  'でしょうか', 'ましょうか', 'ませんか', 'ますか', 'ですか',
  'いたしました', 'いたします', 'ございます', '思いました', '思います',
  'ました', 'ません', 'ましょう', 'でしょう', 'ください', '下さい', 'でした',
  'ですね', 'ですよ', 'ますね', 'ますよ', 'します', 'ます', 'です',
  'である', 'だった', 'かった'
].sort(byLengthDesc);

// 語尾の直後がこれらの文字なら、まだ文が続いている(例: 「ですが」「ますので」)
const CONTINUES = new Set([...'がけのからしとばたてでにをなんどよねまもはへる']);

// 文の先頭に立ちやすい語(語尾の直後にこれが来るなら文の切れ目とみなす)
const CONJUNCTIONS = [
  'そして', 'それで', 'それでは', 'それから', 'それに', 'しかし', 'しかも',
  'ただし', 'ただ', 'また', 'なので', 'ですので', 'ですから', 'ですが',
  'だから', 'つまり', 'ちなみに', '一方', 'さらに', 'たとえば', '例えば',
  'そのため', 'したがって', 'では', 'でも', 'とはいえ', 'なお', 'まず',
  '次に', '続いて', 'あとは', 'あと', 'とりあえず', 'ということで',
  'というのも', 'じゃあ', '加えて', '逆に', 'その上で', 'はい', 'えー', 'あの'
].sort(byLengthDesc);

// 直後がこれらで始まるなら、その手前は文の途中(「〜についてです」など)
const COPULA_HEAD = /^(?:です|ます|でし|まし|でしょ|ましょ|だっ|であ|でご)/;

// 読点を打ちやすい節の切れ目(接続助詞など)
const CLAUSE_TAILS = [
  'ということで', 'とのことで', 'ということは', 'けれども', 'について',
  'に関して', 'に対して', 'によって', 'ですけど', 'ますけど', 'けれど',
  'けども', 'により', 'ですが', 'ますが', 'ですし', 'ますし', 'ながら',
  'なので', 'ので', 'から', 'けど', 'ため', 'たら', 'なら', '場合'
].sort(byLengthDesc);

// 改行位置の候補(この語の直後で折り返す)
const BREAK_PARTICLES = [
  'ということで', 'について', 'に関して', 'に対して', 'によって',
  'けれども', 'ですけど', 'ますけど', 'ですが', 'ますが', 'ながら',
  'なので', 'では', 'には', 'とは', 'ので', 'から', 'けど', 'ため',
  'たら', 'なら', 'まで', 'より', 'は', 'が', 'を', 'に', 'で', 'と', 'も', 'や', 'て', 'の', 'へ'
].sort(byLengthDesc);

// タイムスタンプ行 [12:34] / [1:02:03]
const TIME_LINE = /^\[\d{1,2}:\d{2}(?::\d{2})?\]$/;

export function normalize(text) {
  let s = String(text ?? '').replace(/\r\n?/g, '\n');
  s = s.replace(/[ \t　]+/g, ' ');
  // 日本語(非ASCII)どうしの間の空白は認識器由来のノイズなので落とす
  const joinCjk = (t) => t.replace(/([^ -~]) ([^ -~])/g, '$1$2');
  s = joinCjk(joinCjk(s));
  // 句読点の前の空白を除去し、句読点の重複をまとめる
  s = s.replace(/ +([。、！？，])/g, '$1').replace(/([。、])\1+/g, '$1');
  return s.split('\n').map((line) => line.trim()).join('\n').trim();
}

function tailEndsAt(s, i, tails) {
  for (const t of tails) {
    if (i >= t.length && s.startsWith(t, i - t.length)) return t;
  }
  return null;
}

function startsWithConjunction(rest) {
  return CONJUNCTIONS.some((c) => rest.startsWith(c));
}

// s の位置 i(直前の文字までを含む)が文の切れ目か
function isSentenceEnd(s, i) {
  if (i <= 0 || i >= s.length) return false;
  if (!tailEndsAt(s, i, SENT_TAILS)) return false;
  const rest = s.slice(i);
  if (ALL_MARKS.includes(rest[0]) || CLOSERS.includes(rest[0])) return false;
  if (startsWithConjunction(rest)) return true;
  return !CONTINUES.has(rest[0]);
}

// s の位置 i が読点を打ちたい節の切れ目か
function isClauseBreak(s, i) {
  if (i <= 0 || i >= s.length) return false;
  const rest = s.slice(i);
  if (ALL_MARKS.includes(rest[0]) || CLOSERS.includes(rest[0])) return false;
  // 「〜についてです」のように述語が続くなら文の途中なので読点は打たない
  if (COPULA_HEAD.test(rest)) return false;
  // 接続詞の手前で切る(「〜、そして」)
  if (CONJUNCTIONS.some((c) => c.length >= 2 && rest.startsWith(c))) return true;
  if (!tailEndsAt(s, i, CLAUSE_TAILS)) return false;
  // 「けれども」「ために」のように語が続いている途中では切らない
  return !CONTINUES.has(rest[0]);
}

// 括弧の中では句読点を補わない(引用や固有名詞を壊さないため)
function bracketDelta(ch) {
  if ('「『（(【〈《'.includes(ch)) return 1;
  if (CLOSERS.includes(ch)) return -1;
  return 0;
}

// 句読点を補う。すでに入っている句読点はそのまま活かす
export function punctuate(text) {
  const s = normalize(text);
  if (!s) return '';
  let out = '';
  let sinceMark = 0;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    out += ch;
    depth = Math.max(0, depth + bracketDelta(ch));
    if (ALL_MARKS.includes(ch)) { sinceMark = 0; continue; }
    if (ch === '\n') { sinceMark = 0; continue; }
    sinceMark++;
    if (depth > 0) continue;
    const at = i + 1;
    if (isSentenceEnd(s, at)) { out += '。'; sinceMark = 0; continue; }
    if (sinceMark >= SOFT_MIN && isClauseBreak(s, at)) { out += '、'; sinceMark = 0; }
  }
  return out;
}

// 末尾に句点がなければ補う
export function closeSentence(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  const last = s[s.length - 1];
  if (SENT_MARKS.includes(last) || last === '、' || CLOSERS.includes(last)) return s;
  return `${s}。`;
}

// 文単位に分割(句点は前の文に残す。閉じ括弧が続く場合は取り込む)
function splitSentences(line) {
  const out = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    cur += line[i];
    if (!SENT_MARKS.includes(line[i])) continue;
    while (i + 1 < line.length && (SENT_MARKS.includes(line[i + 1]) || CLOSERS.includes(line[i + 1]))) {
      cur += line[++i];
    }
    out.push(cur);
    cur = '';
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// 行頭に来てはいけない文字(句読点・閉じ括弧・語頭に立たない小書き文字)
function badLineHead(ch) {
  return ch != null && (ALL_MARKS.includes(ch) || CLOSERS.includes(ch) || 'ーんっゃゅょぁぃぅぇぉ々ゝ'.includes(ch));
}

// 折り返しで切り離す末尾がこれより短いと、行が寂しくなるので切らない
const MIN_TAIL = 4;

// 語の途中で折り返さないための判定。
// 「です・ます」や、「〜しています」のような て形 + 補助動詞を割らない
const AUX_AFTER_TE = new Set([...'いおくみあまきしゆ']);

// 行頭が助詞1文字になる位置では折り返さない(「さんと / の打ち合わせ」を防ぐ)
const PARTICLE_HEAD = new Set([...'のがをはにへもやとでかね']);

function splitsWord(s, i) {
  if (COPULA_HEAD.test(s.slice(i - 1))) return true;
  const prev = s[i - 1];
  if ((prev === 'て' || prev === 'で') && AUX_AFTER_TE.has(s[i])) return true;
  return prev === 'と' && s[i] === 'い'; // 「という」を割らない
}

// 各位置が括弧の内側かどうか(括弧の中では折り返さない)
function bracketDepths(s) {
  const depths = new Array(s.length + 1);
  let d = 0;
  depths[0] = 0;
  for (let i = 0; i < s.length; i++) {
    d = Math.max(0, d + bracketDelta(s[i]));
    depths[i + 1] = d;
  }
  return depths;
}

// max 文字を超える文を、どこで折り返すか決める(0 なら折り返さない)
function findCut(s, max) {
  const min = Math.max(6, Math.floor(max * 0.45));
  const depth = bracketDepths(s);
  // 1) 読点・句点や閉じ括弧のうしろ(少しだけ超過を許して探す)
  const hi = Math.min(s.length - 1, max + 2);
  for (let i = hi; i >= min; i--) {
    const prev = s[i - 1];
    if (depth[i] > 0 || badLineHead(s[i]) || s.length - i < 2) continue;
    if (ALL_MARKS.includes(prev) || CLOSERS.includes(prev)) return i;
  }
  // 2) 句読点がなく、超過がわずかなら折り返さない。
  //    無理に助詞で切ると「ありがと / うございます」のように語を割ってしまう
  if (s.length <= max + 2) return 0;
  // 3) 助詞のうしろ
  const hi2 = Math.min(s.length - 1, max);
  for (let i = hi2; i >= min; i--) {
    if (depth[i] > 0 || badLineHead(s[i]) || splitsWord(s, i) || s.length - i < MIN_TAIL) continue;
    if (PARTICLE_HEAD.has(s[i])) continue;
    if (tailEndsAt(s, i, BREAK_PARTICLES)) return i;
  }
  // 4) 諦めて max で切る(行頭に句読点が来ないよう1文字ずらす)
  let cut = Math.min(max, s.length - 1);
  while (cut < s.length && badLineHead(s[cut])) cut++;
  return cut;
}

function pushWrapped(lines, sentence, max) {
  let s = sentence.trim();
  let guard = 0;
  while (s.length > max && guard++ < 500) {
    const cut = findCut(s, max);
    if (cut <= 0 || cut >= s.length) break;
    lines.push(s.slice(0, cut).trim());
    s = s.slice(cut).trim();
  }
  if (s) lines.push(s);
}

// 句読点のタイミングで改行して、1行を max 文字程度に収める
export function wrap(text, max = DEFAULT_MAX) {
  const lines = [];
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) { lines.push(''); continue; }
    if (TIME_LINE.test(trimmed)) { lines.push(trimmed); continue; }
    for (const sentence of splitSentences(trimmed)) pushWrapped(lines, sentence, max);
  }
  return lines.join('\n');
}

// 折り返しを解いて段落に戻す(再整形の前処理)。
// 句点で終わっていない行は次の行と同じ文の続きとみなす
export function unwrap(text) {
  const paras = [];
  let cur = '';
  const flush = () => { if (cur.trim()) paras.push(cur.trim()); cur = ''; };
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); paras.push(''); continue; }
    if (TIME_LINE.test(line)) { flush(); paras.push(line); continue; }
    cur += line;
    const last = line[line.length - 1];
    if (SENT_MARKS.includes(last) || CLOSERS.includes(last)) flush();
  }
  flush();
  return paras.join('\n');
}

// ---- 用語辞書による置換 ----
// 音声認識は固有名詞や専門用語を苦手とするので、聞き間違えられやすい表記を
// 正しい表記へ置き換える。ひらがな/カタカナの違いは吸収する。
const kataToHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const hiraToKata = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

export function applyTerms(text, terms = []) {
  let out = String(text ?? '');
  if (!out || !terms.length) return out;
  for (const term of terms) {
    const right = String(term?.right ?? '').trim();
    if (!right) continue;
    const wrongs = Array.isArray(term?.wrong) ? term.wrong : [];
    // 長い表記から順に置き換える(短い語が先に当たって崩れるのを防ぐ)
    const variants = new Set();
    for (const w of wrongs) {
      const word = String(w ?? '').trim();
      if (!word || word === right) continue;
      variants.add(word);
      variants.add(kataToHira(word));
      variants.add(hiraToKata(word));
    }
    for (const v of [...variants].sort((a, b) => b.length - a.length)) {
      if (v && v !== right) out = out.split(v).join(right);
    }
  }
  return out;
}

// ---- フィラー(えー・あのー など)の除去 ----
// 語頭や句読点の直後にあるものだけを消す。「あの人」のような通常の語は残す
const FILLER = '(?:えーっと|ええっと|えーと|えっと|ええと|あのう|あのー|そのー|うーん|んー|えー|あー|まあ|ええ)';
const FILLER_HEAD = new RegExp(`(^|[。、！？\n])[ 　]*(?:${FILLER}[、,]?[ 　]*)+`, 'g');
const FILLER_MID = new RegExp(`、[ 　]*${FILLER}[ 　]*、`, 'g');

export function stripFillers(text) {
  let s = String(text ?? '');
  if (!s) return '';
  s = s.replace(FILLER_MID, '、');
  s = s.replace(FILLER_HEAD, '$1');
  return s.trim();
}

// 用語辞書 → 句読点の補完 → フィラー除去 の順に整える。
// フィラーは句読点が入ったあとの方が「です。あのー議題は」のような並びを正しく落とせる
function refine(text, { terms = [], fillers = false } = {}) {
  const punctuated = punctuate(applyTerms(text, terms));
  return closeSentence(fillers ? stripFillers(punctuated) : punctuated);
}

// 認識結果1つぶんのテキストを整える
export function formatSegmentText(text, max = DEFAULT_MAX, opts = {}) {
  return wrap(refine(text, opts), max);
}

// 認識結果の配列から議事録本文を組み立てる
export function buildBody(segments = [], opts = {}) {
  const { max = DEFAULT_MAX, timestamps = false } = opts;
  const blocks = [];
  for (const seg of segments) {
    const body = formatSegmentText(seg.text, max, opts);
    if (!body) continue;
    blocks.push(timestamps && seg.t != null ? `[${clock(seg.t)}]\n${body}` : body);
  }
  return blocks.join('\n');
}

// 編集済みの本文をもう一度整える(句読点は補わず、改行だけ引き直す)
export function reflow(text, max = DEFAULT_MAX) {
  return wrap(unwrap(text), max);
}

// 編集済みの本文に句読点も補い直す
export function reformat(text, max = DEFAULT_MAX, opts = {}) {
  const paras = unwrap(text).split('\n').map((line) => {
    const t = line.trim();
    if (!t || TIME_LINE.test(t)) return t;
    return refine(t, opts);
  });
  return wrap(paras.join('\n'), max);
}

function clock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

// 文字数(空白・改行を除く)
export function countChars(text) {
  return String(text ?? '').replace(/\s/g, '').length;
}
