// 記録帳: 経過を日付つきで残すジャーナル(文字+画像)
import { getRecords, putRecord, deleteRecord, putImage, getImageURL } from '../db.js';
import { el, uid, fmtDateTime, toast, confirmDialog, resizeImage, haptic } from '../util.js';
import { spriteSVG } from '../sprites.js';
import { viewImage } from './map.js';

export async function openRecords(map) {
  const root = document.getElementById('overlay-root');
  root.querySelector('.records-panel')?.remove();

  const listEl = el('div', { class: 'records-list' });

  // --- 入力欄(投稿日は自動) ---
  const textInput = el('textarea', { maxlength: 1000, placeholder: 'きょうの記録をのこす…(投稿日は自動でつく)' });
  const thumbs = el('div', { class: 'composer-thumbs' });
  let pendingImages = []; // { id, blob, url }

  const fileInput = el('input', { type: 'file', accept: 'image/*', multiple: 'multiple', style: 'display:none' });
  fileInput.addEventListener('change', async () => {
    for (const f of fileInput.files || []) {
      try {
        const blob = await resizeImage(f);
        const url = URL.createObjectURL(blob);
        pendingImages.push({ id: uid(), blob, url });
        thumbs.append(el('img', { src: url, alt: '' }));
      } catch {
        toast('画像を読み込めませんでした');
      }
    }
    fileInput.value = '';
  });

  async function submit() {
    const text = textInput.value.trim();
    if (!text && pendingImages.length === 0) {
      toast('文字か画像をいれてね');
      return;
    }
    for (const img of pendingImages) {
      await putImage(img.id, img.blob);
      URL.revokeObjectURL(img.url);
    }
    const record = {
      id: uid(),
      mapId: map.id,
      createdAt: Date.now(),
      text,
      imageIds: pendingImages.map((i) => i.id)
    };
    await putRecord(record);
    pendingImages = [];
    thumbs.innerHTML = '';
    textInput.value = '';
    haptic(10);
    await paintList();
    listEl.scrollTop = 0;
  }

  const panel = el('div', { class: 'records-panel' },
    el('div', { class: 'records-head' },
      el('button', { class: 'icon-btn', 'aria-label': 'とじる', onclick: () => panel.remove() }, '▼'),
      el('div', { class: 'records-title' },
        el('span', { html: spriteSVG('book', { size: 24 }) }),
        `記録帳 - ${map.goal.name}`
      )
    ),
    listEl,
    el('div', { class: 'record-composer' },
      textInput,
      el('div', { class: 'composer-row' },
        el('button', { class: 'attach-btn icon-btn', 'aria-label': '画像を追加', onclick: () => fileInput.click() }, '📷'),
        thumbs,
        el('button', { class: 'btn btn-gold', onclick: submit }, 'のこす')
      ),
      fileInput
    )
  );
  root.append(panel);
  await paintList();

  async function paintList() {
    const records = await getRecords(map.id);
    listEl.innerHTML = '';
    if (records.length === 0) {
      listEl.append(el('div', { class: 'records-empty' },
        'まだ記録がない。', el('br'),
        'まいにちの経過をここにためていこう。', el('br'),
        '(れい: 筋トレの写真を毎日アップする)'
      ));
      return;
    }
    for (const r of records) {
      const imgs = el('div', { class: 'rec-images' });
      for (const iid of r.imageIds || []) {
        const url = await getImageURL(iid);
        if (url) imgs.append(el('img', { src: url, alt: '記録画像', onclick: () => viewImage(url) }));
      }
      listEl.append(
        el('div', { class: 'record-entry' },
          el('div', { class: 'rec-date' }, `▣ ${fmtDateTime(r.createdAt)}`),
          r.text ? el('div', { class: 'rec-text' }, r.text) : null,
          (r.imageIds && r.imageIds.length) ? imgs : null,
          el('button', {
            class: 'rec-del',
            'aria-label': '記録を削除',
            onclick: async () => {
              const ok = await confirmDialog('この記録を削除する?', { okText: '削除する', danger: true });
              if (!ok) return;
              await deleteRecord(r);
              paintList();
            }
          }, '×')
        )
      );
    }
  }
}
