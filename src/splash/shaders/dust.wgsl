struct Params { resolution: vec2f, time: f32, progress: f32, pointer: vec2f, seed: f32, exposure: f32 }
@group(0) @binding(0) var<uniform> params: Params;
struct DustOut { @builtin(position) position: vec4f, @location(0) local: vec2f, @location(1) color: vec3f }
fn rnd(n: f32) -> f32 { return fract(sin(n*127.1+params.seed*3.1)*43758.5453); }
@vertex fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DustOut {
  let corners = array<vec2f,6>(vec2f(-1.0,-1.0),vec2f(1.0,-1.0),vec2f(-1.0,1.0),vec2f(-1.0,1.0),vec2f(1.0,-1.0),vec2f(1.0,1.0));
  let id: f32 = f32(ii)+1.0;
  let depth: f32 = rnd(id*4.7);
  let phase: f32 = rnd(id*2.3)*6.283185;
  let x: f32 = fract(rnd(id*1.9)+sin(params.time*0.08+phase)*0.022+params.time*0.0014+params.pointer.x*depth*0.016);
  let y: f32 = fract(rnd(id*8.1)-params.time*(0.002+depth*0.0015)+cos(params.time*0.05+phase)*0.016+params.pointer.y*depth*0.010);
  let radius: f32 = 0.00065+pow(depth,10.0)*0.010;
  let uv: vec2f = vec2f(x,y)+corners[vi]*vec2f(radius*params.resolution.y/params.resolution.x,radius);
  let illumination: f32 = exp(-pow((y-x*0.8-0.03)/0.25,2.0));
  let pulse: f32 = 0.60+0.40*(sin(params.time*0.28+phase)*sin(params.time*0.28+phase));
  var out: DustOut;
  out.position=vec4f(uv.x*2.0-1.0,1.0-uv.y*2.0,0.0,1.0);
  out.local=corners[vi];
  out.color=mix(vec3f(0.36,0.51,0.78),vec3f(1.25,0.94,0.65),illumination)*pulse*(0.10+depth*0.10+illumination*0.32)*(1.0-x*0.40);
  return out;
}
@fragment fn fs_main(input: DustOut) -> @location(0) vec4f {
  let r2: f32 = dot(input.local,input.local);
  let alpha: f32 = exp(-r2*3.5)*(1.0-smoothstep(0.5,1.0,r2));
  return vec4f(input.color*alpha,0.0);
}
