// mLearn / PRISM. Art-directed studio optics, not a spectral/path-traced simulation.
// Only pixels in the logo's tight AABB march. Ground, reflections, panel and air are analytic.
struct Params {
  resolution: vec2f,
  time: f32,
  progress: f32,
  illumination: f32,
  pointer: vec2f,
  seed: f32,
  exposure: f32,
  lighting: vec4f,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var logo: texture_2d<f32>;
@group(0) @binding(2) var linear: sampler;

fn sq(x: f32) -> f32 { return x*x; }
fn hash21(p: vec2f) -> f32 { return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453); }
fn noise2(p: vec2f) -> f32 {
  let i: vec2f = floor(p);
  let f: vec2f = fract(p);
  let u: vec2f = f*f*(vec2f(3.0)-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2f(1.0,0.0)),u.x),mix(hash21(i+vec2f(0.0,1.0)),hash21(i+vec2f(1.0)),u.x),u.y);
}
fn box2(p: vec2f, b: vec2f) -> f32 {
  let q: vec2f = abs(p)-b;
  return length(max(q,vec2f(0.0)))+min(max(q.x,q.y),0.0);
}
fn gaussian(p: vec2f, scale: vec2f) -> f32 { return exp(-dot(p/scale,p/scale)); }
// The two studio lights move on different slow cycles, so the scene never flashes in unison.
fn warmDrift() -> f32 { return params.lighting.x; }
fn coolDrift() -> f32 { return params.lighting.y; }
fn lightReveal() -> f32 {
  let t: f32 = clamp(params.illumination,0.0,1.0);
  return t*t*(3.0-2.0*t);
}
fn warmLight() -> f32 { return mix(0.16,params.lighting.z,lightReveal()); }
fn coolLight() -> f32 { return mix(0.65,params.lighting.w,lightReveal()); }

// The atlas contains the exact two path outlines from the pinned mLearn dev commit.
// Both source axes use 0.009 world units per SVG unit. No aspect-ratio distortion.
fn logo2(p: vec2f) -> f32 {
  let svg: vec2f = vec2f(p.x/0.009+927.5,1007.0-(p.y-0.045)/0.009);
  let uv: vec2f = (svg-vec2f(721.0,768.0))/vec2f(416.0,260.0);
  let edge: vec2f = max(max(-uv,uv-vec2f(1.0)),vec2f(0.0))*vec2f(3.744,2.340);
  return textureSampleLevel(logo,linear,clamp(uv,vec2f(0.0),vec2f(1.0)),0.0).r+length(edge);
}
fn logo3(p: vec3f) -> f32 {
  let bevel: f32 = 0.108;
  let q: vec2f = vec2f(logo2(p.xy)+bevel,abs(p.z)-0.295+bevel);
  return min(max(q.x,q.y),0.0)+length(max(q,vec2f(0.0)))-bevel;
}
fn logoNormal(p: vec3f) -> vec3f {
  let e: f32 = 0.010;
  return normalize(vec3f(
    logo3(p+vec3f(e,0.0,0.0))-logo3(p-vec3f(e,0.0,0.0)),
    logo3(p+vec3f(0.0,e,0.0))-logo3(p-vec3f(0.0,e,0.0)),
    logo3(p+vec3f(0.0,0.0,e))-logo3(p-vec3f(0.0,0.0,e))
  ));
}
fn boxInterval(ro: vec3f, rd: vec3f) -> vec2f {
  let a: vec3f = (vec3f(-1.77,-0.02,-0.31)-ro)/(rd+vec3f(0.000001));
  let b: vec3f = (vec3f(1.78,2.04,0.31)-ro)/(rd+vec3f(0.000001));
  let lo: vec3f = min(a,b);
  let hi: vec3f = max(a,b);
  return vec2f(max(max(lo.x,lo.y),lo.z),min(min(hi.x,hi.y),hi.z));
}
fn traceLogo(ro: vec3f, rd: vec3f, limit: f32) -> f32 {
  let bounds: vec2f = boxInterval(ro,rd);
  var t: f32 = max(0.0,bounds.x);
  let end: f32 = min(bounds.y,limit);
  if (t>end) { return -1.0; }
  for (var i: i32 = 0; i<64; i=i+1) {
    let d: f32 = logo3(ro+rd*t);
    if (d<0.0012) { return t; }
    t=t+max(0.0008,d*0.82);
    if (t>end) { break; }
  }
  return -1.0;
}

fn environment(r: vec3f) -> vec3f {
  var c: vec3f = vec3f(0.006,0.009,0.019);
  // Analytic HDR softboxes: narrow in angle, extended along the other axis.
  c=c+vec3f(3.1,2.0,1.25)*warmLight()*exp(-sq((r.x+0.77-warmDrift()*0.075)/0.22)-sq((r.z-0.36)/0.70));
  c=c+vec3f(1.3,1.8,3.0)*coolLight()*exp(-sq((r.x-0.76-coolDrift()*0.055)/0.18)-sq((r.z-0.32)/0.65));
  c=c+vec3f(2.3,2.5,2.8)*exp(-sq((r.y-0.68)/0.18)-sq(r.x/0.85));
  c=c+vec3f(1.8,1.9,2.1)*exp(-sq((r.x+0.19+warmDrift()*0.065)/0.075)-sq((r.y+0.12)/0.65)-sq((r.z-0.95)/0.30));
  return c;
}
fn air(uv: vec2f) -> vec3f {
  let source: vec2f = vec2f(-0.13+warmDrift()*0.025,-0.12+warmDrift()*0.018);
  let p: vec2f = uv-source;
  let drift: f32 = warmDrift()*0.055+params.pointer.x*0.012;
  let ray1: f32 = exp(-sq((p.y-p.x*(0.64+drift))/0.074));
  let ray2: f32 = exp(-sq((p.y-p.x*(1.10+drift))/0.046));
  let ray3: f32 = exp(-sq((p.y-p.x*(1.68+drift))/0.085));
  let mist: f32 = 0.83+0.17*noise2(uv*5.0+vec2f(params.time*0.04,0.0));
  let rays: f32 = (ray1*0.052+ray2*0.090+ray3*0.025)*exp(-p.x*1.8)*warmLight()*lightReveal();
  // Broad sheets of light make the slow movement legible between short startup phases.
  let warmSheet: f32 = exp(-sq((p.y-p.x*(1.23+drift))/0.17))*exp(-max(p.x,0.0)*1.1);
  let coolP: vec2f = vec2f(1.18-uv.x,uv.y+0.07);
  let coolSheet: f32 = exp(-sq((coolP.y-coolP.x*(1.70+coolDrift()*0.12))/0.13))*exp(-max(coolP.x,0.0)*1.0);
  return vec3f(1.0,0.61,0.34)*(rays+warmSheet*0.24*warmLight()*lightReveal())*mist
    +vec3f(0.24,0.48,1.0)*coolSheet*0.11*coolLight()*mist;
}
fn background(uv: vec2f) -> vec3f {
  var c: vec3f = mix(vec3f(0.003,0.006,0.015),vec3f(0.001,0.002,0.006),uv.y);
  c=c+vec3f(1.4,1.05,0.80)*warmLight()*gaussian(uv-vec2f(-0.08+warmDrift()*0.045,-0.10+warmDrift()*0.025),vec2f(0.18,0.25));
  c=c+vec3f(0.010,0.022,0.052)*coolLight()*gaussian(uv-vec2f(0.85+coolDrift()*0.035,0.14),vec2f(0.34,0.42));
  // A defocused dark glass shape on the right gives depth without a large image asset.
  let p: vec2f = vec2f(uv.x+(uv.y-0.35)*0.34-0.99,uv.y-0.35);
  let rect: f32 = box2(p,vec2f(0.175,0.257));
  let plate: f32 = 1.0-smoothstep(-0.025,0.040,rect);
  let edge: f32 = exp(-sq(rect/0.020));
  c=c*(1.0-plate*0.35)+vec3f(0.031,0.054,0.105)*edge*0.55*coolLight();
  return c+air(uv);
}
fn glass(p: vec3f, n: vec3f, v: vec3f) -> vec3f {
  let r: vec3f = reflect(-v,n);
  let incident: vec3f = refract(-v,n,1.0/1.46);
  var back: vec3f = p-n*0.006+incident*0.007;
  var thickness: f32 = 0.007;
  // One bounded internal traversal. No recursive bounces or stochastic samples.
  for (var j: i32 = 0; j<24; j=j+1) {
    let d: f32 = -logo3(back);
    if (d<0.001) { break; }
    let stride: f32 = max(0.002,d*0.80);
    back=back+incident*stride;
    thickness=thickness+stride;
  }
  let backN: vec3f = logoNormal(back);
  let rearF: f32 = pow(1.0-clamp(dot(incident,backN),0.0,1.0),3.0);
  let frontF: f32 = 0.035+0.965*pow(1.0-clamp(dot(n,v),0.0,1.0),5.0);
  let internal: vec3f = environment(reflect(incident,backN));
  let scatter: f32 = 1.0-exp(-thickness*2.25);
  let inset: f32 = max(0.0,-logo2(p.xy));
  let rim: f32 = exp(-inset*22.0);
  let cloud: f32 = 0.82+0.18*noise2(p.xy*4.2+vec2f(2.0+params.time*0.035,1.0));
  var c: vec3f = vec3f(0.016,0.025,0.047)*(1.0-scatter);
  c=c+vec3f(0.42,0.50,0.64)*scatter*cloud;
  c=c+environment(r)*(0.085+frontF*0.65);
  c=c+internal*(0.035+rearF*0.28);
  c=c+vec3f(0.54,0.64,0.82)*rearF*0.65;
  // Broad backlighting is captured by the frosted volume rather than a diffuse plastic lobe.
  let warm: f32 = exp(-(p.x+1.70)*1.5)*(0.19+rim*0.85);
  let cool: f32 = exp(-(1.72-p.x)*1.5)*(0.10+rim*0.50);
  c=c+vec3f(1.90,1.16,0.67)*warm*warmLight()+vec3f(0.55,0.84,1.55)*cool*coolLight();
  let softSweep: f32 = exp(-sq((p.x+0.20-warmDrift()*0.65)/0.90));
  c=c*(0.72+0.28*softSweep);
  let spectrum: vec3f = vec3f(0.5)+0.5*cos(vec3f(0.0,2.1,4.2)+vec3f(n.x*5.0+n.y*7.0+p.y*1.4));
  c=c+spectrum*rim*(frontF+rearF)*0.08;
  c=c+vec3f(2.4,1.8,1.2)*gaussian(p.xy-vec2f(-1.50,0.04),vec2f(0.20,0.095));
  c=c+vec3f(0.7,1.0,1.7)*gaussian(p.xy-vec2f(1.47,0.04),vec2f(0.25,0.08));
  return c;
}
fn ground(ro: vec3f, rd: vec3f, p: vec3f) -> vec3f {
  let rough: f32 = noise2(p.xz*75.0);
  var c: vec3f = vec3f(0.005,0.009,0.018)*(0.96+rough*0.08);
  let fresnel: f32 = 0.08+0.52*pow(1.0-max(-rd.y,0.0),4.0);
  let refl: vec3f = reflect(rd,vec3f(0.0,1.0,0.0));
  let t: f32 = -p.z/refl.z;
  if (t>0.0) {
    let q: vec3f = p+refl*t;
    let blur: f32 = 0.040+max(p.z,0.0)*0.14;
    let d: f32 = logo2(vec2f(q.x+1.56,q.y));
    let mask: f32 = 1.0-smoothstep(-blur,blur,d);
    let reflected: vec3f = mix(vec3f(1.1,0.73,0.48),vec3f(0.56,0.76,1.2),clamp((q.x+3.10)/3.4,0.0,1.0));
    c=c+reflected*mask*fresnel*1.45*exp(-max(p.z,0.0)*0.30);
  }
  c=c+vec3f(1.45,0.72,0.34)*gaussian(vec2f(p.x+3.1-warmDrift()*0.40,p.z-0.3),vec2f(0.50,1.4))*0.24*warmLight();
  c=c+vec3f(0.30,0.52,1.0)*gaussian(vec2f(p.x-1.0-coolDrift()*0.28,p.z-0.0),vec2f(0.75,2.8))*0.20*coolLight();
  let contact: f32 = exp(-sq(p.z/0.23))*exp(-sq((p.x+1.55)/2.1));
  c=c*(1.0-0.28*contact);
  // Caustic suggestion: a few low-energy spectral streaks near the floor, not extra rays.
  let streak: f32 = p.x*0.23-p.z*0.085-0.47+sin(p.z*0.3+params.time*0.05)*0.035;
  let spectrum: vec3f = vec3f(exp(-sq((streak-0.019)/0.015)),exp(-sq(streak/0.015)),exp(-sq((streak+0.019)/0.015)));
  c=c+spectrum*gaussian(p.xz-vec2f(2.5,1.4),vec2f(1.2,0.75))*0.06;
  return c*(0.94+rough*0.12);
}
fn scene(uv: vec2f) -> vec3f {
  let aspect: f32 = params.resolution.x/params.resolution.y;
  // Fit the same 16:9 composition at any embedding ratio instead of squashing the logo.
  let film: vec2f = (vec2f(uv.x,1.0-uv.y)*2.0-vec2f(1.0))*vec2f(aspect,1.0);
  let ro: vec3f = vec3f(0.55+params.pointer.x*0.15,3.9+params.pointer.y*0.10,12.5);
  let aim: vec3f = vec3f(0.30,1.35,0.0);
  let forward: vec3f = normalize(aim-ro);
  let right: vec3f = normalize(cross(forward,vec3f(0.0,1.0,0.0)));
  let up: vec3f = cross(right,forward);
  let focal: f32 = 4.20*min(1.0,aspect/1.60);
  let rd: vec3f = normalize(forward*focal+right*film.x+up*film.y);
  var c: vec3f = background(uv);
  var nearest: f32 = 100.0;
  if (rd.y< -0.0001) {
    let tf: f32 = -ro.y/rd.y;
    nearest=tf;
    let p: vec3f = ro+rd*tf;
    c=ground(ro,rd,p);
    let fog: f32 = max(1.0-exp(-sq(tf/60.0)),1.0-smoothstep(-5.0,0.0,p.z));
    c=mix(c,background(uv),fog);
  }
  let tp: f32 = (-0.34-ro.z)/rd.z;
  let panel: vec3f = ro+rd*tp;
  let d: f32 = box2(panel.xy-vec2f(-1.55,1.77),vec2f(1.78,1.75));
  if (tp>0.0 && tp<nearest && d<0.006) {
    nearest=tp;
    c=vec3f(0.004,0.007,0.013);
    c=c+vec3f(0.035,0.024,0.018)*warmLight()*gaussian(panel.xy-vec2f(-3.25+warmDrift()*0.10,3.3),vec2f(0.80,1.35));
    c=c+vec3f(0.010,0.017,0.033)*gaussian(panel.xy-vec2f(-0.1,3.6),vec2f(1.4,1.3));
    let rim: f32 = exp(-sq(d/0.008));
    let warm: f32 = gaussian(panel.xy-vec2f(-3.33,3.52),vec2f(0.55,0.85));
    let cold: f32 = gaussian(panel.xy-vec2f(0.23,3.52),vec2f(0.55,1.0));
    c=c+(vec3f(0.008,0.014,0.026)+vec3f(1.5,0.95,0.65)*warm*warmLight()+vec3f(0.42,0.67,1.25)*cold*coolLight())*rim;
    c=c+vec3f(5.0,3.5,2.0)*warmLight()*gaussian(panel.xy-vec2f(-3.32,3.51),vec2f(0.027,0.032));
    let bar: f32 = box2(panel.xy-vec2f(-1.55,3.15),vec2f(1.24,0.075));
    if (bar<0.0) {
      c=vec3f(0.28,0.33,0.43)+vec3f(0.12,0.10,0.08)*clamp((-panel.x)/3.0,0.0,1.0);
      c=c+vec3f(0.35)*exp(-sq(bar/0.007));
      c=c*(0.86+params.progress*0.14);
    }
  }
  let localRo: vec3f = ro-vec3f(-1.56,0.0,0.03);
  let tl: f32 = traceLogo(localRo,rd,nearest);
  if (tl>0.0) {
    let lp: vec3f = localRo+rd*tl;
    c=glass(lp,logoNormal(lp),-rd);
  }
  // Very light atmospheric veil also in front of the objects; never obscures the mark.
  c=c+air(uv)*0.22;
  let flare: f32 = gaussian(uv-vec2f(0.058,0.667),vec2f(0.085,0.0015));
  c=c+vec3f(0.0)*flare;
  return max(c,vec3f(0.0));
}
@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  return vec4f(scene(uv),1.0);
}
