struct Blur { step: vec2f, threshold: f32, pad: f32 }
@group(0) @binding(0) var<uniform> blur: Blur;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var linear: sampler;
fn sampleBright(uv: vec2f) -> vec3f {
  return max(textureSampleLevel(source,linear,uv,0.0).rgb-vec3f(blur.threshold),vec3f(0.0));
}
@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  var c: vec3f = sampleBright(uv)*0.227027;
  c=c+(sampleBright(uv+blur.step*1.384615)+sampleBright(uv-blur.step*1.384615))*0.316216;
  c=c+(sampleBright(uv+blur.step*3.230769)+sampleBright(uv-blur.step*3.230769))*0.070270;
  return vec4f(c,1.0);
}
