// 필터 정의 + WebGL 렌더러
// temp: +따뜻/-차가움, tint: +분홍/-초록, fade: 검정 띄우기, soft: 뽀얀 확산, glow: 하이라이트 빛번짐
const FILTERS = [
  { id:'none', name:'원본', group:'', sw:['#999','#666'], p:{} },

  // ── 뽀용 ──
  { id:'butter', name:'버터', group:'뽀용', sw:['#fff1c9','#f3c98b'],
    p:{ exposure:.14, contrast:.9, saturation:.98, temp:.24, tint:.01, fade:.06, soft:.3, glow:.4,
        highTint:[1.0,.93,.7], highAmt:.3, shadowTint:[.66,.52,.4], shadowAmt:.14, vignette:.08, grain:.015 } },
  { id:'sunny', name:'햇살', group:'뽀용', sw:['#fff6d6','#ffb878'],
    p:{ exposure:.1, contrast:.94, saturation:1.0, temp:.2, tint:.01, fade:.05, soft:.18, glow:.55, leak:.5,
        highTint:[1.0,.9,.7], highAmt:.2, vignette:.1, grain:.015 } },
  { id:'wedding', name:'웨딩', group:'뽀용', sw:['#ffffff','#f6dcd6'],
    p:{ exposure:.26, contrast:.82, saturation:.8, temp:.04, tint:.05, fade:.1, soft:.38, glow:.3,
        highTint:[1.0,.96,.94], highAmt:.2, shadowTint:[.6,.52,.55], shadowAmt:.15 } },
  { id:'peach', name:'피치', group:'뽀용', sw:['#ffe3d3','#f7a48f'],
    p:{ exposure:.12, contrast:.9, saturation:.95, temp:.09, tint:.07, fade:.06, soft:.22, glow:.3,
        highTint:[1.0,.86,.8], highAmt:.25, vignette:.06 } },
  { id:'milk', name:'우유', group:'뽀용', sw:['#fbf8f2','#e2dbd0'],
    p:{ exposure:.3, contrast:.78, saturation:.68, temp:.03, fade:.13, soft:.42, glow:.2,
        highTint:[1,.98,.95], highAmt:.15 } },

  // ── 리코 GR 스타일 ──
  { id:'posi', name:'포지티브', group:'리코', sw:['#f2b56b','#2f5a63'],
    p:{ exposure:.02, contrast:1.25, saturation:1.18, temp:.1, tint:-.01, shadowTint:[.2,.42,.46], shadowAmt:.25,
        highTint:[1,.88,.66], highAmt:.15, vignette:.38, grain:.035 } },
  { id:'nega', name:'네거티브', group:'리코', sw:['#d9cfae','#5d7a78'],
    p:{ exposure:.06, contrast:.88, saturation:.82, temp:-.02, fade:.1, shadowTint:[.32,.5,.52], shadowAmt:.3,
        highTint:[1,.95,.8], highAmt:.2, vignette:.2, grain:.04 } },
  { id:'hicon', name:'하이콘 흑백', group:'리코', sw:['#eeeeee','#111111'],
    p:{ bw:1, exposure:.02, contrast:1.55, vignette:.4, grain:.09 } },
  { id:'bleach', name:'블리치', group:'리코', sw:['#c9c3b4','#3b3a36'],
    p:{ exposure:.03, contrast:1.35, saturation:.42, temp:.02, vignette:.3, grain:.05 } },

  { id:'deep', name:'진득', group:'리코', sw:['#c9733e','#3a2a22'],
    p:{ exposure:.02, contrast:1.18, saturation:1.22, temp:.12, tint:.01, fade:.03,
        shadowTint:[.36,.24,.2], shadowAmt:.22, highTint:[1,.86,.62], highAmt:.22, vignette:.3, grain:.03, glow:.12, glowColor:[1,.6,.4] } },

  // ── 영화 필름 ──
  { id:'cine', name:'시네마', group:'필름', sw:['#f0a35e','#1f4c57'],
    p:{ contrast:1.12, saturation:1.05, temp:.04, shadowTint:[.12,.4,.46], shadowAmt:.42,
        highTint:[1,.76,.5], highAmt:.28, fade:.04, vignette:.35, grain:.035, glow:.15, glowColor:[1,.7,.5], letterbox:1 } },
  { id:'fujimovie', name:'후지 무비', group:'필름', sw:['#8e9a8f','#22302a'],
    p:{ exposure:-.14, contrast:1.16, saturation:.8, temp:-.03, tint:-.05, fade:.02,
        shadowTint:[.18,.26,.22], shadowAmt:.35, highTint:[.95,1.0,.95], highAmt:.15,
        greenDeep:.6, greenTeal:.25, vignette:.25, grain:.035 } },
  { id:'kodak', name:'코닥 무비', group:'필름', sw:['#f5c582','#7a3d2b'],
    p:{ exposure:.03, contrast:1.06, saturation:1.08, temp:.13, tint:.02, fade:.06,
        shadowTint:[.45,.32,.28], shadowAmt:.15, highTint:[1,.88,.68], highAmt:.2,
        glow:.45, glowColor:[1,.35,.2], vignette:.28, grain:.05 } },
  { id:'fuji', name:'초록 필름', group:'필름', sw:['#cfdcb8','#3e5a4e'],
    p:{ exposure:.05, contrast:.95, saturation:.88, temp:-.04, tint:-.04, fade:.08,
        shadowTint:[.3,.5,.42], shadowAmt:.25, highTint:[.98,.97,.88], highAmt:.15, vignette:.22, grain:.045 } },
  { id:'night', name:'밤 영화', group:'필름', sw:['#3c6e8c','#d27a4b'],
    p:{ exposure:.04, contrast:1.18, saturation:1.1, temp:-.08, shadowTint:[.1,.32,.5], shadowAmt:.45,
        highTint:[1,.72,.5], highAmt:.3, glow:.4, glowColor:[1,.55,.35], vignette:.42, grain:.06, letterbox:1 } },
];

const DEFAULTS = { exposure:0, contrast:1, saturation:1, temp:0, tint:0, fade:0, soft:0, glow:0, glowColor:[1,.95,.85],
  leak:0, highTint:[1,1,1], highAmt:0, shadowTint:[.5,.5,.5], shadowAmt:0, vignette:0, grain:0, bw:0, letterbox:0, greenDeep:0, greenTeal:0 };

const VERT = `
attribute vec2 a_pos; varying vec2 v_uv;
void main(){ v_uv = a_pos*0.5+0.5; v_uv.y = 1.0 - v_uv.y; gl_Position = vec4(a_pos,0.0,1.0); }`;

const FRAG = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec4 u_crop; uniform float u_mirror; uniform float u_aspect; uniform vec2 u_res;
uniform float u_amount, u_time;
uniform float u_exposure,u_contrast,u_saturation,u_temp,u_tint,u_fade,u_soft,u_glow,u_leak,u_vignette,u_grain,u_bw,u_highAmt,u_shadowAmt,u_letterbox,u_greenDeep,u_greenTeal;
uniform vec3 u_highTint,u_shadowTint,u_glowColor;
uniform float u_autoGain; uniform vec3 u_wb;

vec2 src(vec2 uv){ uv.x = mix(uv.x, 1.0-uv.x, u_mirror); return u_crop.xy + clamp(uv,0.0,1.0)*u_crop.zw; }
// 자동 보정: 조명 색 중화 + 밝기 맞춤 (흰색은 날리지 않고 어두운 곳만 끌어올림)
vec3 prep(vec3 c){
  c = clamp(c*u_wb, 0.0, 1.0);
  float g = u_autoGain;
  return c*g / (1.0 + (g-1.0)*c);
}
vec3 tex(vec2 uv){ return prep(texture2D(u_tex, src(uv)).rgb); }
float luma(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }

void main(){
  vec2 uv = v_uv;
  vec3 orig = tex(uv);
  vec3 c = orig;

  // 블러 샘플 (뽀얀 확산 + 빛번짐)
  vec3 blur = vec3(0.0); vec3 bright = vec3(0.0);
  if (u_soft > 0.0 || u_glow > 0.0) {
    vec2 r = vec2(0.012, 0.012*u_aspect);
    for (int i=0;i<12;i++){
      float a = float(i)*0.5236;
      vec2 d = vec2(cos(a),sin(a));
      vec3 s1 = tex(uv + d*r);
      vec3 s2 = tex(uv + d*r*2.4);
      blur += s1 + s2;
      bright += max(s1-0.6,0.0) + max(s2-0.55,0.0)*0.8;
    }
    blur /= 24.0; bright /= 12.0;
    // 밝은 부분만 은은하게 번지는 프로미스트 느낌 (어두운 곳은 선명하게 유지)
    c += max(blur - c, 0.0) * u_soft * 1.3;
    c = mix(c, blur, u_soft * 0.12);
  }

  // 노출, 색온도, 틴트
  c *= pow(2.0, u_exposure);
  c.r += u_temp*0.12; c.b -= u_temp*0.12; c.g += u_temp*0.02;
  c.r += u_tint*0.05; c.b += u_tint*0.05; c.g -= u_tint*0.06;
  c = clamp(c,0.0,1.0);

  // 흑백
  if (u_bw > 0.5) { float l = dot(c, vec3(0.35,0.5,0.15)); c = vec3(l); }

  // 대비 (부드러운 S커브)
  c = clamp((c-0.5)*u_contrast + 0.5, 0.0, 1.0);
  vec3 sc = c*c*(3.0-2.0*c);
  c = u_contrast > 1.0 ? mix(c, sc, min(u_contrast-1.0,1.0)*0.5) : c;

  // 채도
  float l = luma(c);
  c = mix(vec3(l), c, u_saturation);

  // 초록을 깊고 차분하게 (후지 계열 녹색)
  float gn = clamp(c.g - max(c.r, c.b), 0.0, 1.0);
  c -= gn * u_greenDeep * vec3(0.15, 0.55, 0.1);
  c.b += gn * u_greenTeal * 0.45; c.r -= gn * u_greenTeal * 0.1;
  c = clamp(c, 0.0, 1.0);

  // 스플릿 톤
  l = luma(c);
  float hw = smoothstep(0.35,1.0,l), sw = 1.0 - smoothstep(0.0,0.55,l);
  c = mix(c, c*u_highTint*1.05 + (u_highTint-1.0)*0.1, hw*u_highAmt);
  c = mix(c, mix(c, u_shadowTint, 0.6), sw*u_shadowAmt);

  // 페이드(검정 띄우기)
  c = c*(1.0-u_fade) + u_fade*vec3(0.98,0.95,0.92)*0.55;

  // 빛번짐
  c = 1.0 - (1.0-c)*(1.0 - bright*u_glowColor*u_glow*1.6);

  // 햇살 라이트릭
  vec2 lp = uv - vec2(0.05, -0.05);
  lp.y /= u_aspect;
  float leak = exp(-dot(lp,lp)*3.0);
  c = 1.0 - (1.0-c)*(1.0 - vec3(1.0,0.78,0.45)*leak*u_leak);

  // 비네팅
  vec2 vp = uv-0.5;
  c *= 1.0 - u_vignette*smoothstep(0.25, 0.85, length(vp*vec2(1.0,1.0/u_aspect))*1.25);

  // 그레인
  float g = hash(floor(gl_FragCoord.xy) + fract(u_time)*100.0) - 0.5;
  c += g*u_grain*(1.2 - luma(c)*0.6);

  c = clamp(c,0.0,1.0);
  c = mix(orig, c, u_amount);

  // 시네마 레터박스 (2.35:1)
  if (u_letterbox > 0.5) {
    float bar = u_res.x > u_res.y ? (1.0 - u_res.x / 2.35 / u_res.y) * 0.5 : 0.09;
    if (uv.y < bar || uv.y > 1.0 - bar) c = vec3(0.0);
  }
  gl_FragColor = vec4(c,1.0);
}`;

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL을 사용할 수 없어요');
    this.gl = gl;
    const sh = (type, srcCode) => {
      const s = gl.createShader(type); gl.shaderSource(s, srcCode); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.prog = prog;
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
  // source: video/img/canvas, crop: [x,y,w,h] 0-1, params: filter params
  render(source, { crop = [0,0,1,1], mirror = false, params = {}, amount = 1, width, height, auto = { gain: 1, wb: [1,1,1] } }) {
    const gl = this.gl;
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    gl.viewport(0, 0, width, height);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
    const p = Object.assign({}, DEFAULTS, params);
    const f = (k, v) => this.u[k] && gl.uniform1f(this.u[k], v);
    const v3 = (k, v) => this.u[k] && gl.uniform3fv(this.u[k], v);
    gl.uniform4fv(this.u.u_crop, crop);
    f('u_autoGain', auto.gain); v3('u_wb', auto.wb);
    f('u_mirror', mirror ? 1 : 0);
    f('u_aspect', width / height);
    gl.uniform2f(this.u.u_res, width, height);
    f('u_amount', amount);
    f('u_time', performance.now() / 1000);
    for (const k of ['exposure','contrast','saturation','temp','tint','fade','soft','glow','leak','vignette','grain','bw','highAmt','shadowAmt','letterbox','greenDeep','greenTeal']) f('u_' + k, p[k]);
    v3('u_highTint', p.highTint); v3('u_shadowTint', p.shadowTint); v3('u_glowColor', p.glowColor);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
