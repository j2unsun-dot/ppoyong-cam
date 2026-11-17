// 필름캠: 필름 색감 프로필 + WebGL 렌더러
// 과한 효과 없이 "색만" 자연스럽게 바꾸는 것이 원칙.
// temp: +따뜻/-차가움, tint: +분홍/-초록, fade: 검정을 살짝 띄움(물빠진 느낌)
// redSat: 빨강 진하게, skyShift: 파랑을 청록으로, greenDeep/greenTeal: 초록을 깊게/청록으로
const FILTERS = [
  { id:'none', name:'원본', sw:['#9a9a9a','#5e5e5e'], p:{} },
  { id:'natural', name:'내추럴', sw:['#d9cbb8','#6f6355'],
    p:{ contrast:1.04, saturation:1.03, temp:.015 } },

  // 아그파 비스타 계열: 선명하고 따뜻한 빨강, 청록빛 하늘, 살짝 차가운 그림자
  { id:'agfa100', name:'아그파 100', sw:['#e2603f','#2f7f93'],
    p:{ exposure:.02, contrast:1.06, saturation:1.08, temp:.0, redSat:.1, skyShift:.2, greenDeep:.05,
        toneS:[.986,1.112,.888], toneM:[1.09,1.0,.9], toneH:[1.098,1.021,.874], fade:.055, fadeColor:[.9,1.0,.85] } },
  { id:'agfa200', name:'아그파 200', sw:['#e8854a','#3d6f86'],
    p:{ exposure:.03, contrast:1.03, saturation:1.0, redSat:.06, skyShift:.15,
        toneS:[.96,1.13,.91], toneM:[1.065,1.04,.89], toneH:[1.06,1.04,.89], fade:.045, fadeColor:[.92,1.0,.9] } },

  // 코니카 센츄리아 계열: 물빠진 색, 들뜬 검정, 차분한 청록·민트 기운 → 아련한 느낌
  { id:'konica', name:'코니카', sw:['#c9d3c8','#7d9a98'],
    p:{ exposure:.03, contrast:.96, saturation:.72, redSat:-.1, skyShift:.2, greenTeal:.12,
        toneS:[.89,1.03,1.08], toneM:[1.03,.995,.94], toneH:[1.02,1.045,.935], fade:.13, fadeColor:[.85,.97,1.0] } },

  // 그 외 자연스러운 필름들
  { id:'portra', name:'포트라', sw:['#f0c9a8','#8a6d5c'],
    p:{ exposure:.03, contrast:.96, saturation:.92, temp:.05, tint:.015, redSat:-.05, skyShift:.1,
        shadowTint:[.48,.44,.42], shadowAmt:.1, highTint:[1,.95,.88], highAmt:.15, fade:.03 } },
  { id:'gold', name:'골드', sw:['#f2c14e','#9a5b2e'],
    p:{ contrast:1.05, saturation:1.05, temp:.13, tint:.01, redSat:.05, skyShift:.05, greenDeep:-.05,
        shadowTint:[.5,.42,.34], shadowAmt:.1, highTint:[1,.92,.74], highAmt:.22, fade:.025 } },
  { id:'fujic', name:'후지 C200', sw:['#b9d1b4','#3f6d63'],
    p:{ contrast:1.02, saturation:.92, temp:-.04, tint:-.03, redSat:-.05, skyShift:.2, greenTeal:.22, greenDeep:.12,
        shadowTint:[.36,.48,.46], shadowAmt:.18, highTint:[.98,1,.96], highAmt:.1, fade:.03 } },
  { id:'bw', name:'흑백', sw:['#e6e6e6','#262626'],
    p:{ bw:1, contrast:1.12, fade:.02 } },
];

const DEFAULTS = { exposure:0, contrast:1, saturation:1, temp:0, tint:0, fade:0,
  highTint:[1,1,1], highAmt:0, shadowTint:[.5,.5,.5], shadowAmt:0, bw:0,
  redSat:0, skyShift:0, greenDeep:0, greenTeal:0, fadeColor:[.92,.94,.95], toneS:[1,1,1], toneM:[1,1,1], toneH:[1,1,1] };

const VERT = `
attribute vec2 a_pos; varying vec2 v_uv;
void main(){ v_uv = a_pos*0.5+0.5; v_uv.y = 1.0 - v_uv.y; gl_Position = vec4(a_pos,0.0,1.0); }`;

const FRAG = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec4 u_crop; uniform float u_mirror; uniform float u_aspect;
uniform float u_amount, u_seed;
uniform float u_exposure,u_contrast,u_saturation,u_temp,u_tint,u_fade,u_bw,u_highAmt,u_shadowAmt;
uniform float u_redSat,u_skyShift,u_greenDeep,u_greenTeal;
uniform vec3 u_highTint,u_shadowTint,u_fadeColor,u_toneS,u_toneM,u_toneH;
uniform float u_autoGain; uniform vec3 u_wb;
uniform float u_tBright,u_tContrast,u_tSat,u_tWarm,u_grain,u_blur;

float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float luma(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
vec2 src(vec2 uv){ uv.x = mix(uv.x, 1.0-uv.x, u_mirror); return u_crop.xy + clamp(uv,0.0,1.0)*u_crop.zw; }
vec3 raw(vec2 uv){ return texture2D(u_tex, src(uv)).rgb; }

// 블러: 원판(보겔) 샘플링 + 픽셀마다 회전 → 렌즈 아웃포커스처럼 부드럽게
vec3 sampleImg(vec2 uv){
  if (u_blur < 0.002) return raw(uv);
  vec2 R = vec2(u_blur*0.009, u_blur*0.009*u_aspect);
  float rot = hash(floor(gl_FragCoord.xy) + 3.1) * 6.2832;
  vec3 acc = raw(uv);
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    float r = sqrt((fi + 0.5) / 24.0);
    float a = fi * 2.39996 + rot;
    acc += raw(uv + vec2(cos(a), sin(a)) * r * R);
  }
  return acc / 25.0;
}

// 밝기 곡선: 흰색은 그대로 두고 중간톤 위주로 올리거나 내림
vec3 gainCurve(vec3 c, float g){ return c*g / (1.0 + (g-1.0)*c); }

float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  float a = hash(i + u_seed), b = hash(i + vec2(1.0,0.0) + u_seed);
  float c = hash(i + vec2(0.0,1.0) + u_seed), d = hash(i + vec2(1.0,1.0) + u_seed);
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}

void main(){
  vec2 uv = v_uv;
  // 자동 보정(조명 색, 어두운 장면 밝기)
  vec3 base = gainCurve(clamp(sampleImg(uv) * u_wb, 0.0, 1.0), u_autoGain);
  vec3 c = base;

  // ── 필름 색 ──
  c = gainCurve(c, pow(2.0, u_exposure));
  c.r += u_temp*0.10; c.b -= u_temp*0.10; c.g += u_temp*0.015;
  c.r += u_tint*0.04; c.b += u_tint*0.04; c.g -= u_tint*0.05;
  c = clamp(c, 0.0, 1.0);

  // 색별 보정
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float chroma = mx - mn;
  float redness = clamp((c.r - max(c.g, c.b)) * 2.5, 0.0, 1.0);
  float blueness = clamp((c.b - max(c.r, c.g)) * 3.0, 0.0, 1.0);
  float greenness = clamp((c.g - max(c.r, c.b)) * 3.0, 0.0, 1.0);
  float lr = luma(c);
  c = mix(c, mix(vec3(lr), c, 1.0 + u_redSat), redness);
  c.g += blueness * u_skyShift * chroma * 0.45; c.r -= blueness * u_skyShift * chroma * 0.15;
  c -= greenness * u_greenDeep * chroma * vec3(0.2, 0.55, 0.15);
  c.b += greenness * u_greenTeal * chroma * 0.5; c.r -= greenness * u_greenTeal * chroma * 0.15;
  c = clamp(c, 0.0, 1.0);

  if (u_bw > 0.5) c = vec3(dot(c, vec3(0.33,0.5,0.17)));

  // 대비: 부드러운 S커브
  vec3 s = c*c*(3.0-2.0*c);
  c = u_contrast >= 1.0 ? mix(c, s, (u_contrast-1.0)*2.0) : mix(c, vec3(0.5) + (c-0.5)*0.6, (1.0-u_contrast)*2.5);
  c = clamp(c, 0.0, 1.0);

  c = mix(vec3(luma(c)), c, u_saturation);

  // 스플릿 톤
  float l = luma(c);
  float hw = smoothstep(0.45, 1.0, l), sw = 1.0 - smoothstep(0.0, 0.5, l);
  c = mix(c, c * (u_highTint / max(luma(u_highTint), 0.01)), hw * u_highAmt);
  c = mix(c, c * (u_shadowTint / max(luma(u_shadowTint), 0.01)), sw * u_shadowAmt);

  // 톤별 색 기울기(사진참고 실측값): 그림자/중간/밝은 부분에 각각 곱함, 밝기는 유지
  {
    float L0 = luma(c);
    float ws = 1.0 - smoothstep(0.08, 0.42, L0), wh = smoothstep(0.45, 0.85, L0), wm = max(1.0 - ws - wh, 0.0);
    vec3 m = ws*u_toneS + wm*u_toneM + wh*u_toneH;
    m /= max(dot(m, vec3(0.299,0.587,0.114)), 0.01);
    c = clamp(c * m, 0.0, 1.0);
  }

  // 물빠진 검정
  c = u_fade * u_fadeColor + c * (1.0 - u_fade);
  c = clamp(c, 0.0, 1.0);

  // 필름 강도
  c = mix(base, c, u_amount);

  // ── 내가 조정 ──
  c = gainCurve(c, pow(2.0, u_tBright * 1.2));
  c = clamp((c-0.5)*(1.0 + u_tContrast*0.5) + 0.5, 0.0, 1.0);
  c = mix(vec3(luma(c)), c, 1.0 + u_tSat);
  c.r += u_tWarm*0.06; c.b -= u_tWarm*0.06; c.g += u_tWarm*0.008;
  c = clamp(c, 0.0, 1.0);

  // 노이즈(필름 입자): 해상도와 상관없이 같은 크기로 보이도록 화면 비율 기준
  if (u_grain > 0.001) {
    vec2 gp = uv * vec2(1150.0, 1150.0 / u_aspect);
    float n = noise(gp) * 0.62 + noise(gp * 2.13 + 7.7) * 0.38 - 0.5;
    float nc = noise(gp * 0.9 + 31.0) - 0.5;
    float lw = 0.35 + 2.6 * l * (1.0 - l);
    c += (vec3(n) + vec3(nc, -nc*0.5, nc*0.2) * 0.25) * u_grain * 0.28 * lw;
    c = clamp(c, 0.0, 1.0);
  }
  gl_FragColor = vec4(c, 1.0);
}`;

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
    if (!gl) throw new Error('WebGL을 사용할 수 없어요');
    this.gl = gl;
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const sh = (type, code) => {
      const s = gl.createShader(type); gl.shaderSource(s, code); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.u = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(prog, i); this.u[info.name] = gl.getUniformLocation(prog, info.name); }
  }
  // 같은 소스를 여러 번 그릴 땐 upload=false로 텍스처 재업로드 생략
  render(source, { crop = [0,0,1,1], mirror = false, params = {}, amount = 1, tweak = {}, width, height,
                   auto = { gain: 1, wb: [1,1,1] }, upload = true, seed = 0 }) {
    const gl = this.gl;
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    gl.viewport(0, 0, width, height);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    if (upload) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
    const p = Object.assign({}, DEFAULTS, params);
    const f = (k, v) => this.u[k] && gl.uniform1f(this.u[k], v);
    const v3 = (k, v) => this.u[k] && gl.uniform3fv(this.u[k], v);
    gl.uniform4fv(this.u.u_crop, crop);
    f('u_mirror', mirror ? 1 : 0);
    f('u_aspect', width / height);
    f('u_amount', amount);
    f('u_seed', seed);
    f('u_autoGain', auto.gain); v3('u_wb', auto.wb);
    f('u_tBright', tweak.bright || 0); f('u_tContrast', tweak.contrast || 0); f('u_tSat', tweak.sat || 0);
    f('u_tWarm', tweak.warm || 0); f('u_grain', tweak.grain || 0); f('u_blur', tweak.blur || 0);
    for (const k of ['exposure','contrast','saturation','temp','tint','fade','bw','highAmt','shadowAmt','redSat','skyShift','greenDeep','greenTeal']) f('u_' + k, p[k]);
    v3('u_highTint', p.highTint); v3('u_shadowTint', p.shadowTint); v3('u_fadeColor', p.fadeColor); v3('u_toneS', p.toneS); v3('u_toneM', p.toneM); v3('u_toneH', p.toneH);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
