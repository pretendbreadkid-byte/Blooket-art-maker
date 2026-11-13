// The tutorials page. Everyone can watch. When the tutorial account is signed in
// (in the Blook Berry app on this site), this adds buttons to add, edit and
// remove tutorials.
(() => {
  const TOKEN_KEY = 'blook-session';
  const THUMB_W = 1280, THUMB_H = 720, THUMB_MAX = 560 * 1024;
  let token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch { /* not signed in */ }
  if (!token) return;

  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = async (method, url, body) => {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'That did not work. Try again.');
    return data;
  };

  // Uploads the video itself, with a progress bar.
  const sendVideo = (id, file, onProgress) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/tutorials/${id}/video`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* empty */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `The video did not upload (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error('The video did not upload. Check your internet and try again.'));
    xhr.send(file);
  });

  // Any picture, shrunk to a 16:9 JPEG thumbnail.
  function toThumb(source, w, h) {
    const scale = Math.max(THUMB_W / w, THUMB_H / h);
    const c = Object.assign(document.createElement('canvas'), { width: THUMB_W, height: THUMB_H });
    const x = c.getContext('2d');
    x.fillStyle = '#f5d3e4';
    x.fillRect(0, 0, THUMB_W, THUMB_H);
    x.drawImage(source, (THUMB_W - w * scale) / 2, (THUMB_H - h * scale) / 2, w * scale, h * scale);
    for (const q of [0.85, 0.7, 0.55, 0.4]) {
      const url = c.toDataURL('image/jpeg', q);
      if (url.length * 0.75 < THUMB_MAX) return url;
    }
    return c.toDataURL('image/jpeg', 0.3);
  }
  async function pictureThumb(file) {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await img.decode();
    const url = toThumb(img, img.naturalWidth, img.naturalHeight);
    URL.revokeObjectURL(img.src);
    return url;
  }
  // A still from a second into the video, when no thumbnail was picked.
  function videoThumb(file) {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      v.src = URL.createObjectURL(file);
      const done = (url) => { URL.revokeObjectURL(v.src); resolve(url); };
      v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 2); };
      v.onseeked = () => { try { done(toThumb(v, v.videoWidth, v.videoHeight)); } catch { done(null); } };
      v.onerror = () => done(null);
      setTimeout(() => done(null), 8000);
    });
  }

  function form(t) {
    const editing = !!t;
    const box = document.createElement('div');
    box.className = 'tut-modal';
    box.innerHTML = `<form class="tut-form">
      <h2>${editing ? 'Edit tutorial' : 'New tutorial'}</h2>
      <label>Name<input type="text" id="tname" maxlength="100" required value="${esc(t?.name)}"></label>
      <label>Description<textarea id="tdesc" maxlength="4000">${esc(t?.description)}</textarea></label>
      <label>Thumbnail<input type="file" id="tthumb" accept="image/png,image/jpeg,image/webp">
        <small>${editing ? 'Leave empty to keep the one it has.' : 'Leave empty to use a still from the video.'}</small></label>
      ${t?.hasThumb ? `<img class="tut-thumb-pre" src="/api/tutorials/${t.id}/thumb?v=${Date.now()}" alt="">` : ''}
      <label>Video file<input type="file" id="tvideo" accept="video/mp4,video/webm,video/quicktime">
        <small>MP4, WEBM or MOV, up to 50 MB.${editing && t.video ? ' Leave empty to keep the video it has.' : ''}</small></label>
      <p class="tut-or">or</p>
      <label>YouTube link<input type="url" id="tyt" placeholder="https://youtube.com/watch?v=..." value="${t?.video?.kind === 'youtube' ? `https://youtu.be/${esc(t.video.yt)}` : ''}"></label>
      <div class="tut-progress" hidden><i></i></div>
      <p class="tut-err" hidden></p>
      <div class="tut-actions"><button type="button" class="tut-btn" data-no>Cancel</button><button class="tut-btn primary" data-yes>${editing ? 'Save' : 'Upload'}</button></div>
    </form>`;
    document.body.append(box);
    const err = $('.tut-err', box), bar = $('.tut-progress', box);
    const fail = (m) => { err.textContent = m; err.hidden = false; $('[data-yes]', box).disabled = false; };
    $('[data-no]', box).onclick = () => box.remove();
    box.onclick = (e) => { if (e.target === box) box.remove(); };
    $('form', box).onsubmit = async (e) => {
      e.preventDefault();
      err.hidden = true;
      const video = $('#tvideo', box).files[0], picture = $('#tthumb', box).files[0];
      const youtube = $('#tyt', box).value.trim();
      if (video && youtube) return fail('Pick a video file or a YouTube link, not both.');
      if (!editing && !video && !youtube) return fail('Add a video file or a YouTube link.');
      if (video && video.size > 50 * 1024 * 1024) return fail('That video is bigger than 50 MB. Try a shorter or smaller one, or put it on YouTube.');
      $('[data-yes]', box).disabled = true;
      try {
        const body = { name: $('#tname', box).value, description: $('#tdesc', box).value };
        if (picture) body.thumb = await pictureThumb(picture);
        else if (video && !t?.hasThumb) body.thumb = (await videoThumb(video)) || undefined;
        if (youtube && youtube !== `https://youtu.be/${t?.video?.yt}`) body.youtube = youtube;
        const { tutorial } = await api(editing ? 'PATCH' : 'POST', editing ? `/api/tutorials/${t.id}` : '/api/tutorials', body);
        if (video) {
          bar.hidden = false;
          await sendVideo(tutorial.id, video, (f) => { $('i', bar).style.width = `${Math.round(f * 100)}%`; });
        }
        location.href = `/tutorials/${tutorial.id}`;
      } catch (error) {
        fail(error.message);
      }
    };
    $('#tname', box).focus();
  }

  async function remove(t) {
    if (!confirm(`Delete "${t.name}"? This can't be undone.`)) return;
    try {
      await api('DELETE', `/api/tutorials/${t.id}`);
      location.href = '/tutorials';
    } catch (error) { alert(error.message); }
  }

  const button = (label, cls, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `tut-btn ${cls}`;
    b.textContent = label;
    b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onClick(); };
    return b;
  };

  api('GET', '/api/tutorials').then(({ tutorials, canEdit }) => {
    if (!canEdit) return;
    const byId = Object.fromEntries(tutorials.map((t) => [t.id, t]));
    const hero = $('.tut-hero');
    if (hero) {
      const bar = document.createElement('div');
      bar.className = 'tut-bar';
      bar.append(button('+ New tutorial', 'primary', () => form(null)));
      hero.after(bar);
      document.querySelectorAll('.tut-card').forEach((card) => {
        const t = byId[card.dataset.tutorial];
        if (!t) return;
        const tools = document.createElement('span');
        tools.className = 'tut-card-tools';
        tools.append(button('Edit', '', () => form(t)), button('Delete', 'danger', () => remove(t)));
        card.append(tools);
      });
    }
    const one = $('.tut-one');
    if (one && byId[one.dataset.tutorial]) {
      const t = byId[one.dataset.tutorial];
      const tools = document.createElement('div');
      tools.className = 'tut-owner';
      tools.append(button('Edit', '', () => form(t)), button('Delete', 'danger', () => remove(t)));
      one.append(tools);
    }
  }).catch(() => {});
})();
