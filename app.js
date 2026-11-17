(() => {
  const $ = (id) => document.getElementById(id);
  const view = $('view'), video = $('video');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  let renderer;
  try { renderer = new Renderer(view); }
  catch (e) { $('startMsg').textContent = '이 기기에서는 필터를 실행할 수 없어요: ' + e.message; return; }
  let capRenderer = null;

  const state = {
    mode: 'camera',          // 'camera' | 'photo'
    facing: store.get('facing', 'environment'),
    filter: FILTERS.find(f => f.id === store.get('filter', 'butter')) || FILTERS[1],
    amount: 1,
    timer: 0,
    stream: null,
    photo: null,             // 불러온 사진 (canvas)
    busy: false,
    autoOn: store.get('auto', '1') === '1',
    auto: { gain: 1, wb: [1, 1, 1] },
  };

  // ── 자동 밝기/색 보정 ──
  // 장면을 아주 작게 줄여 평균 밝기와 조명 색을 재고, 필터 전에 보정해서
  // 실내/조명 아래에서도 야외와 비슷한 밝기·색으로 필터가 입혀지게 함
  const probe = document.createElement('canvas'); probe.width = 32; probe.height = 32;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  function measure(source, sw, sh) {
    pctx.drawImage(source, 0, 0, sw, sh, 0, 0, 32, 32);
    const d = pctx.getImageData(0, 0, 32, 32).data;
    let r = 0, g = 0, b = 0, n = 0; const lum = [];
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i] / 255, G = d[i+1] / 255, B = d[i+2] / 255;
      const L = 0.299*R + 0.587*G + 0.114*B; lum.push(L);
      if (L > 0.06 && L < 0.94) { r += R; g += G; b += B; n++; } // 너무 어둡거나 날아간 곳은 색 측정에서 제외
    }
    lum.sort((x, y) => x - y);
    const median = Math.max(lum[lum.length >> 1], 0.02);
    // 밝기: 곡선 보정 후 중간 밝기가 0.45가 되도록 (밝은 부분은 곡선이 알아서 보호)
    const T = 0.45;
    let gain = T * (1 - median) / (median * (1 - T));
    gain = Math.max(0.9, Math.min(gain, 6));
    // 조명 색: 주황(전구색)/파랑 조명이 강할 때만 그 초과분을 줄임. 자연광은 거의 그대로 둠
    let wb = [1, 1, 1];
    if (n > 20) {
      const rb = r / b;
      let target = rb;
      if (rb > 1.15) target = 1.15 + (rb - 1.15) * 0.3;
      else if (rb < 0.85) target = 0.85 - (0.85 - rb) * 0.3;
      const k = Math.sqrt(target / rb);
      wb = [k, 1, 1 / k];
      const gr = g / ((r * k + b / k) / 2);   // 형광등 초록끼
      if (gr > 1.15) wb[1] = (1.15 + (gr - 1.15) * 0.3) / gr;
      const norm = 3 / (wb[0] + wb[1] + wb[2]);
      wb = wb.map(v => Math.max(0.6, Math.min(1.5, v * norm)));
    }
    return { gain, wb };
  }
  function smoothAuto(t, k) {
    const s = state.auto;
    s.gain += (t.gain - s.gain) * k;
    s.wb = s.wb.map((v, i) => v + (t.wb[i] - v) * k);
  }
  const NO_AUTO = { gain: 1, wb: [1, 1, 1] };
  const curAuto = () => state.autoOn ? state.auto : NO_AUTO;
  $('autoBtn').classList.toggle('on', state.autoOn);
  $('autoBtn').onclick = () => {
    state.autoOn = !state.autoOn; store.set('auto', state.autoOn ? '1' : '0');
    $('autoBtn').classList.toggle('on', state.autoOn);
    $('autoBtn').textContent = state.autoOn ? '자동밝기 켬' : '자동밝기 끔';
    if (state.mode === 'photo') drawPhoto();
  };
  $('autoBtn').textContent = state.autoOn ? '자동밝기 켬' : '자동밝기 끔';

  // ── 필터 목록 ──
  const list = $('filters');
  let lastGroup = null;
  FILTERS.forEach(f => {
    const b = document.createElement('button');
    b.className = 'chip'; b.dataset.id = f.id;
    b.innerHTML = `<span class="sw" style="background:linear-gradient(135deg,${f.sw[0]},${f.sw[1]})"></span>${f.name}` +
      `<span class="grp">${f.group !== lastGroup ? f.group : '&nbsp;'}</span>`;
    lastGroup = f.group;
    b.onclick = () => selectFilter(f);
    list.appendChild(b);
  });

  let toastTimer;
  function selectFilter(f, scroll = true) {
    state.filter = f; store.set('filter', f.id);
    list.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.id === f.id));
    const el = list.querySelector(`[data-id="${f.id}"]`);
    if (scroll && el) el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    const t = $('filterName'); t.textContent = (f.group ? f.group + ' · ' : '') + f.name; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1200);
    if (state.mode === 'photo') drawPhoto();
  }
  selectFilter(state.filter, false);

  // 화면 좌우로 밀어서 필터 바꾸기
  let sx = null, sy = null;
  $('stage').addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  $('stage').addEventListener('touchend', e => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const i = FILTERS.indexOf(state.filter);
      const n = (i + (dx < 0 ? 1 : -1) + FILTERS.length) % FILTERS.length;
      selectFilter(FILTERS[n]);
    }
  });

  // 강도
  $('amount').oninput = (e) => {
    state.amount = e.target.value / 100; $('amountVal').textContent = e.target.value;
    if (state.mode === 'photo') drawPhoto();
  };

  // 타이머
  const timers = [0, 3, 10];
  $('timerBtn').onclick = () => {
    state.timer = timers[(timers.indexOf(state.timer) + 1) % timers.length];
    $('timerBtn').textContent = state.timer ? `타이머 ${state.timer}초` : '타이머 끔';
    $('timerBtn').classList.toggle('on', !!state.timer);
  };

  // ── 카메라 ──
  async function startCamera() {
    stopCamera();
    $('startMsg').textContent = '';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: state.facing, width: { ideal: 2560 }, height: { ideal: 1920 } },
      });
      state.stream = stream;
      video.srcObject = stream;
      await video.play();
      $('startScreen').hidden = true;
      store.set('camOk', '1');
      setMode('camera');
    } catch (e) {
      $('startScreen').hidden = false;
      $('startMsg').textContent = e && e.name === 'NotAllowedError'
        ? '카메라 권한이 필요해요. 설정 > Safari > 카메라에서 허용해 주세요.'
        : '카메라를 열 수 없어요. (' + (e && e.message || e) + ')';
    }
  }
  function stopCamera() {
    if (state.stream) state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
  }
  $('startBtn').onclick = startCamera;
  $('flipBtn').onclick = () => {
    state.facing = state.facing === 'user' ? 'environment' : 'user';
    store.set('facing', state.facing);
    startCamera();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.mode === 'camera' && store.get('camOk') === '1') {
      const live = state.stream && state.stream.getVideoTracks().some(t => t.readyState === 'live');
      if (!live) startCamera(); else video.play().catch(() => {});
    }
  });

  // 3:4 세로 비율로 자르기
  function cameraCrop() {
    const vw = video.videoWidth, vh = video.videoHeight;
    const target = 3 / 4;
    let w = vw, h = vh;
    if (vw / vh > target) w = vh * target; else h = vw / target;
    return { crop: [(1 - w / vw) / 2, (1 - h / vh) / 2, w / vw, h / vh], w: Math.round(w), h: Math.round(h) };
  }
  function fit(w, h, max) { const s = Math.min(1, max / Math.max(w, h)); return [Math.round(w * s), Math.round(h * s)]; }

  let frame = 0;
  function loop() {
    if (state.mode === 'camera' && video.readyState >= 2 && video.videoWidth) {
      const { crop, w, h } = cameraCrop();
      if (state.autoOn && frame++ % 6 === 0) {
        try { smoothAuto(measure(video, video.videoWidth, video.videoHeight), 0.25); } catch {}
      }
      const [pw, ph] = fit(w, h, 1280);
      renderer.render(video, { crop, mirror: state.facing === 'user', params: state.filter.p, amount: state.amount, width: pw, height: ph, auto: curAuto() });
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  function setMode(m) {
    state.mode = m;
    $('shutter').classList.toggle('import', m === 'photo');
    $('shutter').setAttribute('aria-label', m === 'photo' ? '저장' : '촬영');
    if (m === 'camera') { view.style.aspectRatio = '3/4'; }
  }

  // ── 사진 불러오기 ──
  $('fileInput').onchange = async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const img = await loadImage(file);
      const [w, h] = fit(img.naturalWidth || img.width, img.naturalHeight || img.height, 4096);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      state.photo = c;
      const m = measure(c, w, h); state.auto = m;
      stopCamera();
      $('startScreen').hidden = true;
      setMode('photo');
      view.style.aspectRatio = `${w}/${h}`;
      drawPhoto();
    } catch (err) { alert('사진을 불러올 수 없어요'); }
  };
  function loadImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { res(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
      img.onerror = rej; img.src = url;
    });
  }
  function drawPhoto() {
    const p = state.photo; if (!p) return;
    const [pw, ph] = fit(p.width, p.height, 1600);
    renderer.render(p, { params: state.filter.p, amount: state.amount, width: pw, height: ph, auto: curAuto() });
  }

  // ── 촬영/저장 ──
  $('shutter').onclick = async () => {
    if (state.busy) return;
    if (state.mode === 'camera' && !state.stream) { startCamera(); return; }
    state.busy = true;
    try {
      if (state.mode === 'camera' && state.timer) await countdown(state.timer);
      flash();
      const blob = await captureBlob();
      showReview(blob);
    } finally { state.busy = false; }
  };
  function countdown(n) {
    return new Promise(res => {
      const el = $('countdown');
      const tick = () => { if (n === 0) { el.textContent = ''; res(); return; } el.textContent = n--; setTimeout(tick, 1000); };
      tick();
    });
  }
  function flash() { const f = $('flash'); f.classList.add('on'); requestAnimationFrame(() => setTimeout(() => f.classList.remove('on'), 60)); }

  function captureBlob() {
    if (!capRenderer) capRenderer = new Renderer(document.createElement('canvas'));
    if (state.mode === 'camera') {
      const { crop, w, h } = cameraCrop();
      const [cw, ch] = fit(w, h, 4096);
      capRenderer.render(video, { crop, mirror: state.facing === 'user', params: state.filter.p, amount: state.amount, width: cw, height: ch, auto: curAuto() });
    } else {
      const p = state.photo;
      capRenderer.render(p, { params: state.filter.p, amount: state.amount, width: p.width, height: p.height, auto: curAuto() });
    }
    return new Promise(res => capRenderer.canvas.toBlob(res, 'image/jpeg', 0.93));
  }

  let currentBlob = null, currentUrl = null;
  function showReview(blob) {
    currentBlob = blob;
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(blob);
    $('reviewImg').src = currentUrl;
    $('review').hidden = false;
  }
  $('retakeBtn').onclick = () => { $('review').hidden = true; };
  $('saveBtn').onclick = async () => {
    if (!currentBlob) return;
    const d = new Date(), pad = (x) => String(x).padStart(2, '0');
    const name = `ppoyong_${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.jpg`;
    const file = new File([currentBlob], name, { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch (e) { /* 취소 */ }
    } else {
      const a = document.createElement('a'); a.href = currentUrl; a.download = name; a.click();
    }
  };

  // 시작
  if (store.get('camOk') === '1') startCamera();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
