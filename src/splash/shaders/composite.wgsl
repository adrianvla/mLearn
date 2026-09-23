struct Params { resolution: vec2f, time: f32, progress: f32, pointer: vec2f, seed: f32, exposure: f32 }
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var bloom: texture_2d<f32>;
@group(0) @binding(3) var linear: sampler;
fn aces(x: vec3f) -> vec3f {
  return clamp((x*(2.51*x+vec3f(0.03)))/(x*(2.43*x+vec3f(0.59))+vec3f(0.14)),vec3f(0.0),vec3f(1.0));
}
// FXAA in the existing composite pass. Flat areas take the early-out.
fn readHdr(uv: vec2f) -> vec3f { return textureSampleLevel(source,linear,uv,0.0).rgb; }
fn antialias(uv: vec2f) -> vec3f {
  let px: vec2f = vec2f(1.0)/params.resolution;
  let nw: vec3f = readHdr(uv+vec2f(-1.0,-1.0)*px);
  let ne: vec3f = readHdr(uv+vec2f(1.0,-1.0)*px);
  let sw: vec3f = readHdr(uv+vec2f(-1.0,1.0)*px);
  let se: vec3f = readHdr(uv+vec2f(1.0,1.0)*px);
  let m: vec3f = readHdr(uv);
  let luma: vec3f = vec3f(0.299,0.587,0.114);
  let lnw: f32 = dot(nw,luma); let lne: f32 = dot(ne,luma);
  let lsw: f32 = dot(sw,luma); let lse: f32 = dot(se,luma); let lm: f32 = dot(m,luma);
  let lo: f32 = min(lm,min(min(lnw,lne),min(lsw,lse)));
  let hi: f32 = max(lm,max(max(lnw,lne),max(lsw,lse)));
  if (hi-lo<max(0.025,hi*0.14)) { return m; }
  var dir: vec2f = vec2f(-((lnw+lne)-(lsw+lse)),(lnw+lsw)-(lne+lse));
  let reduce: f32 = max((lnw+lne+lsw+lse)*0.03125,0.0078125);
  dir=clamp(dir/(min(abs(dir.x),abs(dir.y))+reduce),vec2f(-4.0),vec2f(4.0))*px;
  let a: vec3f = 0.5*(readHdr(uv-dir/6.0)+readHdr(uv+dir/6.0));
  let b: vec3f = a*0.5+0.25*(readHdr(uv-dir*0.5)+readHdr(uv+dir*0.5));
  let lb: f32 = dot(b,luma);
  if (lb<lo || lb>hi) { return a; }
  return b;
}
@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let hdr: vec3f = antialias(uv);
  let glow: vec3f = textureSampleLevel(bloom,linear,uv,0.0).rgb;
  let vignette: f32 = 1.0-0.22*dot((uv-vec2f(0.5))*vec2f(0.9,1.0),(uv-vec2f(0.5))*vec2f(0.9,1.0));
  var c: vec3f = pow(aces((hdr+glow*0.30)*params.exposure*vignette),vec3f(1.0/2.2));
  // Static sub-LSB grain prevents banding without temporal shimmer or an image asset.
  let grain: f32 = fract(52.9829189*fract(dot(floor(uv*params.resolution),vec2f(0.06711056,0.00583715))))-0.5;
  c=c+vec3f(grain/255.0);
  return vec4f(c,1.0);
}
