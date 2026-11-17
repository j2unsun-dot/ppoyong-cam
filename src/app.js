(() => {
  const $ = (id) => document.getElementById(id);
  const view = $('view'), video = $('video');
  const store = {
    get(k, d) { try { const v = localStorage.getItem('fc_' + k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('fc_' + k, v); } catch {} },
  };

  let renderer;
  try { renderer = new Renderer(view); }
  catch (e) { $('startMsg').textContent = '이 기기에서는 필터를 실행할 수 없어요: ' + e.message; return; }
  let capRenderer = null;

  // iOS Safari 캔버스 한도(약 1,670만 화소)와 GPU 텍스처 한도 안에서 최대한 원본 화소 유지
  const MAX_PIXELS = 16_000_000;
  const MAX_SIDE = Math.min(renderer.maxTex || 4096, 8192);
  function fitFull(w, h) {
    let s = Math.min(1, MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_PIXELS / (w * h)));
    return [Math.round(w * s), Math.round(h * s)];
  }
  function fit(w, h, max) { const s = Math.min(1, max / Math.max(w, h)); return [Math.round(w * s), Math.round(h * s)]; }

  const state = {
    mode: 'camera',          // 'camera' | 'photo'
    facing: store.get('facing', 'environment'),
    filter: FILTERS.find(f => f.id === store.get('filter', 'agfa100')) || FILTERS[2],
    amount: 1, tweak: {},
    timer: 0,
    stream: null,
    photo: null,
    busy: false,
    autoOn: store.get('auto', '1') === '1',
    auto: { gain: 1, wb: [1, 1, 1] },
    seed: Math.random() * 100,
    zoom: 1,            // 현재 배율
    zoomHW: null,       // 카메라가 지원하는 실제(렌즈) 줌 범위 {min,max}. 없으면 화면 확대(디지털)
  };

  // ── 자동 밝기/색: 어두운 장면과 강한 조명색만 살짝 보정 (밝은 장면은 그대로) ──
  const probe = document.createElement('canvas'); probe.width = 32; probe.height = 32;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  function measure(source, sw, sh) {
    pctx.drawImage(source, 0, 0, sw, sh, 0, 0, 32, 32);
    const d = pctx.getImageData(0, 0, 32, 32).data;
    let r = 0, g = 0, b = 0, n = 0; const lum = [];
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i] / 255, G = d[i+1] / 255, B = d[i+2] / 255;
      const L = 0.299*R + 0.587*G + 0.114*B; lum.push(L);
      if (L > 0.06 && L < 0.94) { r += R; g += G; b += B; n++; }
    }
    lum.sort((x, y) => x - y);
    const median = Math.max(lum[lum.length >> 1], 0.02);
    let gain = 1;
    if (median < 0.3) { const T = 0.36; gain = Math.min(2.2, T * (1 - median) / (median * (1 - T))); }
    let wb = [1, 1, 1];
    if (n > 20) {
      const rb = r / b;
      let target = rb;
      if (rb > 1.3) target = 1.3 + (rb - 1.3) * 0.4;
      else if (rb < 0.8) target = 0.8 - (0.8 - rb) * 0.4;
      const k = Math.sqrt(target / rb);
      wb = [k, 1, 1 / k];
      const gr = g / ((r * k + b / k) / 2);
      if (gr > 1.2) wb[1] = (1.2 + (gr - 1.2) * 0.4) / gr;
      const norm = 3 / (wb[0] + wb[1] + wb[2]);
      wb = wb.map(v => Math.max(0.7, Math.min(1.4, v * norm)));
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
  function syncAutoBtn() { $('autoBtn').classList.toggle('on', state.autoOn); $('autoBtn').textContent = state.autoOn ? '자동밝기 켬' : '자동밝기 끔'; }
  syncAutoBtn();
  $('autoBtn').onclick = () => {
    state.autoOn = !state.autoOn; store.set('auto', state.autoOn ? '1' : '0'); syncAutoBtn(); redraw();
  };

  // ── 필름 목록 ──
  const list = $('filters');
  FILTERS.forEach(f => {
    const b = document.createElement('button');
    b.className = 'chip'; b.dataset.id = f.id;
    b.innerHTML = `<span class="sw" style="background:linear-gradient(135deg,${f.sw[0]},${f.sw[1]})"></span>${f.name}`;
    b.onclick = () => selectFilter(f);
    list.appendChild(b);
  });
  let toastTimer;
  function selectFilter(f, scroll = true) {
    state.filter = f; store.set('filter', f.id);
    list.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.id === f.id));
    const el = list.querySelector(`[data-id="${f.id}"]`);
    if (scroll && el) el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    const t = $('filterName'); t.textContent = f.name; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1100);
    redraw();
  }
  selectFilter(state.filter, false);

  // 화면 좌우로 밀어서 필름 바꾸기
  let sx = null, sy = null;
  $('stage').addEventListener('touchstart', e => { if (e.touches.length > 1) { sx = null; return; } sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  $('stage').addEventListener('touchend', e => {
    if (sx === null || pinch || e.touches.length > 0) { sx = null; return; }
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const i = FILTERS.indexOf(state.filter);
      selectFilter(FILTERS[(i + (dx < 0 ? 1 : -1) + FILTERS.length) % FILTERS.length]);
    }
  });

  // ── 조정: 필름 강도 / 노이즈 / 블러 / 밝기 / 대비 / 채도 / 색온도 ──
  const ADJ = { amount: [0, 100, 100], grain: [0, 100, 20], blur: [0, 100, 0],
    bright: [-100, 100, 0], contrast: [-100, 100, 0], sat: [-100, 100, 0], warm: [-100, 100, 0] };
  const adj = {};
  for (const k in ADJ) { const v = Number(store.get('adj_' + k, ADJ[k][2])); adj[k] = isFinite(v) ? v : ADJ[k][2]; }
  let adjKey = 'amount';
  const slider = $('slider');
  function syncSlider() {
    const [mn, mx] = ADJ[adjKey];
    slider.min = mn; slider.max = mx; slider.value = adj[adjKey];
    $('sliderVal').textContent = mn < 0 && adj[adjKey] > 0 ? '+' + adj[adjKey] : adj[adjKey];
    $('adjTabs').querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.k === adjKey);
      b.classList.toggle('changed', adj[b.dataset.k] !== ADJ[b.dataset.k][2]);
    });
  }
  function applyAdj() {
    state.amount = adj.amount / 100;
    state.tweak = { bright: adj.bright / 100, contrast: adj.contrast / 100, sat: adj.sat / 100, warm: adj.warm / 100,
                    grain: adj.grain / 100, blur: adj.blur / 100 };
    redraw();
  }
  $('adjTabs').onclick = (e) => { const b = e.target.closest('button'); if (b) { adjKey = b.dataset.k; syncSlider(); } };
  slider.oninput = () => { adj[adjKey] = Number(slider.value); store.set('adj_' + adjKey, adj[adjKey]); syncSlider(); applyAdj(); };
  $('adjReset').onclick = () => { adj[adjKey] = ADJ[adjKey][2]; store.set('adj_' + adjKey, adj[adjKey]); syncSlider(); applyAdj(); };
  syncSlider(); applyAdj();

  // 필름·조정 패널 숨기기/보이기 (화면 크게 보기). 아래로 쓸어내려도 숨겨짐
  function setCollapsed(v) { $('app').classList.toggle('collapsed', v); store.set('collapsed', v ? '1' : '0'); }
  setCollapsed(store.get('collapsed', '0') === '1');
  $('panelToggle').onclick = () => setCollapsed(!$('app').classList.contains('collapsed'));
  let py = null;
  document.querySelector('.controls').addEventListener('touchstart', e => { py = e.touches[0].clientY; }, { passive: true });
  document.querySelector('.controls').addEventListener('touchend', e => {
    if (py === null) return; const dy = e.changedTouches[0].clientY - py; py = null;
    if (dy > 40) setCollapsed(true); else if (dy < -40) setCollapsed(false);
  });

  // 타이머
  const timers = [0, 3, 10];
  $('timerBtn').onclick = () => {
    state.timer = timers[(timers.indexOf(state.timer) + 1) % timers.length];
    $('timerBtn').textContent = state.timer ? `타이머 ${state.timer}초` : '타이머';
    $('timerBtn').classList.toggle('on', !!state.timer);
  };

  // ── 실시간 카메라 ──
  async function startCamera() {
    stopCamera();
    $('startMsg').textContent = '';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: state.facing, width: { ideal: 4032 }, height: { ideal: 3024 } },
      });
      state.stream = stream;
      video.srcObject = stream;
      await video.play();
      $('startScreen').hidden = true;
      store.set('camOk', '1');
      setupZoom();
      setMode('camera');
    } catch (e) {
      $('startScreen').hidden = false;
      $('startMsg').textContent = e && e.name === 'NotAllowedError'
        ? '카메라 권한이 필요해요. 설정 > Safari > 카메라에서 허용해 주세요.'
        : '카메라를 열 수 없어요. (' + (e && e.message || e) + ')';
    }
  }
  function stopCamera() { if (state.stream) state.stream.getTracks().forEach(t => t.stop()); state.stream = null; }
  $('startBtn').onclick = startCamera;
  $('flipBtn').onclick = () => {
    state.facing = state.facing === 'user' ? 'environment' : 'user';
    store.set('facing', state.facing);
    startCamera();
  };
  $('backBtn').onclick = () => { state.photo = null; startCamera(); };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.mode === 'camera' && store.get('camOk') === '1') {
      const live = state.stream && state.stream.getVideoTracks().some(t => t.readyState === 'live');
      if (!live) startCamera(); else video.play().catch(() => {});
    }
  });

  // ── 확대/축소 ──
  // iOS 17 이상 Safari처럼 카메라 줌을 지원하면 렌즈 줌(화질 유지), 아니면 가운데를 잘라 확대(화질 낮아짐)
  const zoomBar = $('zoomBar');
  let zoomApplying = false, zoomPending = null;
  function zoomRange() { return state.zoomHW || { min: 1, max: 5 }; }
  function setupZoom() {
    state.zoomHW = null;
    const track = state.stream && state.stream.getVideoTracks()[0];
    const caps = track && track.getCapabilities ? track.getCapabilities() : {};
    if (caps.zoom && caps.zoom.max > caps.zoom.min) state.zoomHW = { min: caps.zoom.min, max: Math.min(caps.zoom.max, 10) };
    const r = zoomRange();
    const presets = [0.5, 1, 2, 3].filter(z => z >= r.min - 1e-6 && z <= r.max + 1e-6);
    zoomBar.innerHTML = presets.map(z => `<button data-z="${z}">${z}×</button>`).join('');
    setZoom(Math.max(r.min, Math.min(r.max, 1)));
  }
  zoomBar.onclick = (e) => { const b = e.target.closest('button'); if (b) setZoom(Number(b.dataset.z)); };
  function setZoom(z) {
    const r = zoomRange();
    z = Math.max(r.min, Math.min(r.max, z));
    state.zoom = z;
    // 버튼 표시: 가까운 프리셋을 강조, 사이 값이면 현재 배율을 보여줌
    let shown = false;
    zoomBar.querySelectorAll('button').forEach(b => {
      const bz = Number(b.dataset.z);
      const near = Math.abs(bz - z) < 0.05;
      b.classList.toggle('on', near);
      b.textContent = near ? `${bz}×` : `${bz}×`;
      if (near) shown = true;
    });
    if (!shown) {
      const btns = [...zoomBar.querySelectorAll('button')];
      const below = btns.filter(b => Number(b.dataset.z) <= z).pop();
      if (below) { below.classList.add('on'); below.textContent = `${z.toFixed(1)}×`; }
    }
    if (state.zoomHW) applyHWZoom(z);
  }
  async function applyHWZoom(z) {
    if (zoomApplying) { zoomPending = z; return; }
    zoomApplying = true;
    try {
      const track = state.stream && state.stream.getVideoTracks()[0];
      if (track) await track.applyConstraints({ advanced: [{ zoom: z }] });
    } catch {}
    zoomApplying = false;
    if (zoomPending !== null) { const p = zoomPending; zoomPending = null; applyHWZoom(p); }
  }
  // 두 손가락으로 벌리고 오므리기
  let pinch = null;
  $('stage').addEventListener('touchstart', e => {
    if (e.touches.length === 2 && state.mode === 'camera') {
      const [a, b] = e.touches;
      pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: state.zoom };
    }
  }, { passive: true });
  $('stage').addEventListener('touchmove', e => {
    if (pinch && e.touches.length === 2) {
      const [a, b] = e.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      setZoom(pinch.z * d / pinch.d);
      e.preventDefault();
    }
  }, { passive: false });
  $('stage').addEventListener('touchend', e => { if (e.touches.length === 0) setTimeout(() => { pinch = null; }, 0); });

  // 3:4 비율로 맞추기 (카메라가 4:3 그대로 주면 자르지 않음)
  function cameraCrop() {
    const vw = video.videoWidth, vh = video.videoHeight;
    const portrait = vh >= vw, target = portrait ? 3 / 4 : 4 / 3;
    let w = vw, h = vh;
    if (vw / vh > target) w = vh * target; else h = vw / target;
    if (!state.zoomHW && state.zoom > 1) { w /= state.zoom; h /= state.zoom; }   // 디지털 줌: 가운데를 잘라냄
    return { crop: [(1 - w / vw) / 2, (1 - h / vh) / 2, w / vw, h / vh], w: Math.round(w), h: Math.round(h) };
  }

  let frame = 0;
  function loop() {
    if (state.mode === 'camera' && video.readyState >= 2 && video.videoWidth) {
      const { crop, w, h } = cameraCrop();
      if (state.autoOn && frame++ % 6 === 0) { try { smoothAuto(measure(video, video.videoWidth, video.videoHeight), 0.25); } catch {} }
      const [pw, ph] = fit(w, h, 1440);
      view.style.aspectRatio = `${pw}/${ph}`;
      renderer.render(video, { crop, mirror: state.facing === 'user', params: state.filter.p, amount: state.amount,
        tweak: state.tweak, width: pw, height: ph, auto: curAuto(), seed: state.seed });
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  function setMode(m) {
    state.mode = m;
    $('shutter').classList.toggle('import', m === 'photo');
    $('shutter').setAttribute('aria-label', m === 'photo' ? '저장' : '촬영');
    $('backBtn').hidden = m !== 'photo';
    zoomBar.hidden = m !== 'camera';
  }

  // ── 사진: 앨범 불러오기 / 기본 카메라 고화질 촬영 ──
  async function openPhoto(file) {
    if (!file) return;
    try {
      const img = await loadImage(file);
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const [w, h] = fitFull(iw, ih);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      state.photo = { canvas: c, origW: iw, origH: ih };
      state.auto = measure(c, w, h);
      stopCamera();
      $('startScreen').hidden = true;
      setMode('photo');
      view.style.aspectRatio = `${w}/${h}`;
      photoUploaded = false;
      redraw();
    } catch (err) { alert('사진을 불러올 수 없어요'); }
  }
  $('fileInput').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; openPhoto(f); };
  $('nativeInput').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; openPhoto(f); };
  function loadImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { res(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
      img.onerror = rej; img.src = url;
    });
  }

  // 사진 미리보기: 화면용 크기로 줄인 사본을 한 번만 올리고, 조정할 때마다 다시 그림
  let photoUploaded = false, previewSrc = null, rafPending = false;
  function redraw() {
    if (state.mode !== 'photo' || !state.photo || rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      const p = state.photo.canvas;
      const [pw, ph] = fit(p.width, p.height, 1600);
      if (!photoUploaded) {
        previewSrc = document.createElement('canvas'); previewSrc.width = pw; previewSrc.height = ph;
        previewSrc.getContext('2d').drawImage(p, 0, 0, pw, ph);
      }
      renderer.render(previewSrc, { params: state.filter.p, amount: state.amount, tweak: state.tweak,
        width: pw, height: ph, auto: curAuto(), upload: !photoUploaded, seed: state.seed });
      photoUploaded = true;
    });
  }

  // ── 촬영 / 저장 ──
  $('shutter').onclick = async () => {
    if (state.busy) return;
    if (state.mode === 'camera' && !state.stream) { startCamera(); return; }
    state.busy = true;
    try {
      if (state.mode === 'camera' && state.timer) await countdown(state.timer);
      if (state.mode === 'camera') flash();
      await new Promise(r => setTimeout(r, 30));
      const out = await captureBlob();
      showReview(out);
    } catch (e) { alert('저장용 사진을 만들지 못했어요: ' + (e && e.message || e)); }
    finally { state.busy = false; }
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
    let w, h, info;
    if (state.mode === 'camera') {
      const c = cameraCrop();
      [w, h] = fitFull(c.w, c.h);
      capRenderer.render(video, { crop: c.crop, mirror: state.facing === 'user', params: state.filter.p, amount: state.amount,
        tweak: state.tweak, width: w, height: h, auto: curAuto(), seed: state.seed });
      info = `${w}×${h} · 실시간 카메라` + (!state.zoomHW && state.zoom > 1 ? ` · 디지털 줌 ${state.zoom.toFixed(1)}×` : '');
    } else {
      const p = state.photo;
      w = p.canvas.width; h = p.canvas.height;
      capRenderer.render(p.canvas, { params: state.filter.p, amount: state.amount, tweak: state.tweak,
        width: w, height: h, auto: curAuto(), seed: state.seed });
      info = `${w}×${h}` + (w < p.origW ? ` (원본 ${p.origW}×${p.origH}, 브라우저 한도로 조정)` : ' · 원본 화소 그대로');
    }
    return new Promise((res, rej) => capRenderer.canvas.toBlob(b => b ? res({ blob: b, info }) : rej(new Error('메모리 부족')), 'image/jpeg', 0.95));
  }

  let currentBlob = null, currentUrl = null;
  function showReview({ blob, info }) {
    currentBlob = blob;
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(blob);
    $('reviewImg').src = currentUrl;
    $('reviewInfo').textContent = `${info} · ${blob.size >= 1e6 ? (blob.size / 1e6).toFixed(1) + "MB" : Math.round(blob.size / 1e3) + "KB"} · 사진을 꾹 눌러도 저장돼요`;
    $('review').hidden = false;
  }
  $('retakeBtn').onclick = () => { $('review').hidden = true; };
  $('saveBtn').onclick = async () => {
    if (!currentBlob) return;
    const d = new Date(), pad = (x) => String(x).padStart(2, '0');
    const name = `filmcam_${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.jpg`;
    const file = new File([currentBlob], name, { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch (e) { /* 취소 */ }
    } else {
      const a = document.createElement('a'); a.href = currentUrl; a.download = name; a.click();
    }
  };

  if (store.get('camOk') === '1') startCamera();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
