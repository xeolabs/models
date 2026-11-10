import {
  CompilationCache,
  FallbackImages,
  ProgressiveState,
  ResourceLeases,
  TRACING_DOMAINS_WGSL,
  awaitCompilation,
  batchUploads,
  compatibleGeometry,
  dataStreams,
  decodeTexture,
  geometryUnits,
  mutableStreams,
  opaqueScene,
  rayLightingFrame,
  resizeTexturePixels,
  streamLiveLength,
  streamUploads
} from "./chunk-3HYABQVT.js";

// ../sdk-oct2/src/viewing/techniques/rayTracing/webGPU/mipmaps.ts
var normalized = new Float64Array(256);
var linear = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  normalized[i] = v;
  linear[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function downsample(source, width, height, srgb) {
  const w = Math.max(1, width >> 1), h = Math.max(1, height >> 1), result = new Uint8ClampedArray(w * h * 4), rgb = srgb ? linear : normalized;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * height / h), y1 = Math.floor((y + 1) * height / h);
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * width / w), x1 = Math.floor((x + 1) * width / w), count = (y1 - y0) * (x1 - x0);
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
        const i = (sy * width + sx) * 4;
        r += rgb[source[i]];
        g += rgb[source[i + 1]];
        b += rgb[source[i + 2]];
        a += normalized[source[i + 3]];
      }
      r /= count;
      g /= count;
      b /= count;
      if (srgb) {
        r = r <= 31308e-7 ? r * 12.92 : 1.055 * r ** (1 / 2.4) - 0.055;
        g = g <= 31308e-7 ? g * 12.92 : 1.055 * g ** (1 / 2.4) - 0.055;
        b = b <= 31308e-7 ? b * 12.92 : 1.055 * b ** (1 / 2.4) - 0.055;
      }
      const o = (y * w + x) * 4;
      result[o] = r * 255;
      result[o + 1] = g * 255;
      result[o + 2] = b * 255;
      result[o + 3] = a / count * 255;
    }
  }
  return result;
}

// ../sdk-oct2/src/viewing/techniques/rayTracing/webGPU/drawTiles.ts
function drawTraceTiles(pass, width, height) {
  if (!pass.setScissorRect) {
    pass.draw(3);
    return;
  }
  const size = 128;
  try {
    for (let y = 0; y < height; y += size) {
      for (let x = 0; x < width; x += size) {
        pass.setScissorRect(x, y, Math.min(size, width - x), Math.min(size, height - y));
        pass.draw(3);
      }
    }
  } finally {
    pass.setScissorRect(0, 0, width, height);
  }
}

// ../sdk-oct2/src/viewing/techniques/rayTracing/webGPU/shaders.ts
function createShaderSource(sharedCount, instanced = false, progressive = false, compute = false, opaque = false, sceneOnly = false) {
  const sharedShadow = !instanced && !opaque;
  let code = (
    /* wgsl */
    `
struct Uniforms {
  eye: vec4f, forward: vec4f, right: vec4f, up: vec4f,
  light: vec4f, resolution: vec4f, flags: vec4f, options: vec4f,
  environment: vec4f, clip: vec4f, projection: mat4x4f, worldUp: vec4f, skyLight: vec4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> triangles: array<vec4f>;
@group(0) @binding(2) var<storage, read> materials: array<vec4f>;
@group(0) @binding(3) var<storage, read> nodes: array<vec4f>;
@group(0) @binding(4) var<storage, read> normals: array<vec4f>;
@group(0) @binding(5) var<storage, read> pbr: array<vec4f>;
@group(0) @binding(6) var<storage, read> uvs: array<vec4f>;
@group(0) @binding(7) var<storage, read> bindings: array<vec4f>;
@group(0) @binding(8) var<storage, read> sharedBindings: array<vec4f>;
@group(0) @binding(9) var images: texture_2d_array<f32>;
@group(0) @binding(10) var colorImages: texture_2d_array<f32>;
@group(0) @binding(11) var imageSampler: sampler;
@group(0) @binding(12) var environmentMap: texture_cube<f32>;
@group(0) @binding(13) var irradianceMap: texture_cube<f32>;
@group(0) @binding(14) var brdfMap: texture_2d<f32>;
@group(0) @binding(15) var environmentSampler: sampler;
${Array.from({ length: sharedCount }, (_, i) => `@group(0) @binding(${16 + i * 2}) var sharedBindings${i}: texture_2d<f32>;
@group(0) @binding(${17 + i * 2}) var sampler${i}: sampler;`).join("\n")}
${TRACING_DOMAINS_WGSL}
const EPS = 0.0003;
const FAR = 1000.0;
const PI = 3.14159265359;
struct Hit { t: f32, geometricNormal: vec3f, uv: vec2f, normals: i32, mesh: i32, triangle: i32, texcoords: i32, instance: i32 }
struct UV { a: vec2f, b: vec2f, c: vec2f, valid: bool }
struct Material { albedo: vec3f, metallic: f32, roughness: f32, f0: vec3f, emission: vec3f, ao: f32, transmission: f32, transmissionTint: vec3f }
// Store layer count plus half the environment roughness in one scalar. Layer
// counts stay exact (0..16); roughness loses at most 2^-19 after 15 layers.
// This affects only environment mip filtering, never intersection precision.
// Keeping the continuation stack compact avoids a measured WebGPU regression.
struct Ray { origin: vec3f, direction: vec3f, weight: vec3f, bounces: i32, layers: f32, minT: f32, domain: i32 }
fn instanceData(instance: i32, row: i32) -> vec4f { return materials[i32(u.eye.w)+instance*7+row]; }
fn instanceNormal(instance: i32, n: vec3f) -> vec3f {
  if(instance<0){return n;}
  return instanceData(instance,0).xyz*n.x+instanceData(instance,1).xyz*n.y+instanceData(instance,2).xyz*n.z;
}
fn instanceVector(instance: i32, v: vec3f) -> vec3f {
  if(instance<0){return v;}
  return vec3f(dot(instanceData(instance,3).xyz,v),dot(instanceData(instance,4).xyz,v),dot(instanceData(instance,5).xyz,v));
}

fn strength(v: vec3f) -> f32 { return max(v.x,max(v.y,v.z)); }
fn mapBinding(mesh: i32, slot: i32) -> i32 {
  if (slot < 4) { return i32(pbr[mesh*6+2][slot]); }
  return i32(pbr[mesh*6+3].x);
}
fn wrapUV(value: vec2f, modes: vec2f) -> vec2f {
  var result = value;
  for (var axis=0; axis<2; axis++) {
    if (modes[axis]>1.5) { result[axis] = 1.0-abs(value[axis]-2.0*floor(value[axis]/2.0)-1.0); }
    else if (modes[axis]>0.5) { result[axis] = clamp(value[axis],0.0,1.0); }
    else { result[axis] = fract(value[axis]); }
  }
  return result;
}
fn sampleShared(binding: i32, value: vec2f, footprint: f32) -> vec4f {
  let info = sharedBindings[binding*2]; // resource index, flipY, width, height
  let mapInfo = bindings[binding*3];
  var uv = value;
  if (info.y>0.5) { uv.y = 1.0-uv.y; }
  uv = wrapUV(uv,mapInfo.yz);
  var lod = 0.0;
  if (bindings[binding*3+2].w>0.5) { lod = clamp(log2(max(footprint*max(info.z,info.w),1.0)),0.0,sharedBindings[binding*2+1].x); }
  let halfTexel = min(vec2f(0.5),vec2f(0.5*exp2(ceil(lod)))/info.zw);
  if (mapInfo.y>0.5) { uv.x=clamp(uv.x,halfTexel.x,1.0-halfTexel.x); }
  if (mapInfo.z>0.5) { uv.y=clamp(uv.y,halfTexel.y,1.0-halfTexel.y); }
  switch i32(info.x) {
${Array.from({ length: sharedCount }, (_, i) => `    case ${i}: {
      if (mapInfo.w>0.5) { let level=i32(floor(lod)); let size=textureDimensions(sharedBindings${i},level); return textureLoad(sharedBindings${i},min(vec2i(floor(uv*vec2f(size))),vec2i(size)-vec2i(1)),level); }
      return textureSampleLevel(sharedBindings${i},sampler${i},uv,lod);
    }`).join("\n")}
    default: { return vec4f(1); }
  }
}
fn sampleImage(binding: i32, value: vec2f, footprint: f32, colorMap: bool) -> vec4f {
  if (sharedBindings[binding*2].x>=0.0) { return sampleShared(binding,value,footprint); }
  let mapInfo=bindings[binding*3]; let flags=bindings[binding*3+2];
  let size=vec2f(textureDimensions(images,0));
  var lod=0.0;
  if (flags.w>0.5) { lod=clamp(log2(max(footprint*max(size.x,size.y),1.0)),0.0,f32(textureNumLevels(images)-1)); }
  var uv=wrapUV(value,mapInfo.yz);
  let halfTexel=vec2f(0.5)/vec2f(textureDimensions(images,i32(ceil(lod))));
  if (mapInfo.y>0.5) { uv.x=clamp(uv.x,halfTexel.x,1.0-halfTexel.x); }
  if (mapInfo.z>0.5) { uv.y=clamp(uv.y,halfTexel.y,1.0-halfTexel.y); }
  if (mapInfo.w>0.5) {
    let level=i32(floor(lod)); let dimensions=textureDimensions(images,level);
    let texel=min(vec2i(floor(uv*vec2f(dimensions))),vec2i(dimensions)-vec2i(1));
    if (colorMap) { return textureLoad(colorImages,texel,i32(mapInfo.x),level); }
    return textureLoad(images,texel,i32(mapInfo.x),level);
  }
  if (colorMap) { return textureSampleLevel(colorImages,imageSampler,uv,i32(mapInfo.x),lod); }
  return textureSampleLevel(images,imageSampler,uv,i32(mapInfo.x),lod);
}
fn transformedUV(binding: i32, value: vec2f) -> vec2f {
  let m=bindings[binding*3+1]; let o=bindings[binding*3+2];
  var uv=mat2x2f(m.xy,m.zw)*value+o.xy;
  if (o.z>0.5) { uv.y=1.0-uv.y; }
  return uv;
}
fn triangleUV(hit: Hit, slot: i32) -> UV {
  if (hit.texcoords<0) { return UV(vec2f(0),vec2f(0),vec2f(0),false); }
  var address=hit.texcoords+slot*2;
  if(hit.instance>=0){address=i32(uvs[hit.texcoords+slot/4][slot%4]);if(address<0){return UV(vec2f(0),vec2f(0),vec2f(0),false);}}
  let ab=uvs[address]; let last=uvs[address+1];
  return UV(ab.xy,ab.zw,last.xy,last.z>0.5);
}
fn pixelFootprint(hit: Hit) -> f32 { return max(1e-6,2.0*u.forward.w*hit.t/u.resolution.y); }
fn sampleMap(hit: Hit, slot: i32, p: vec3f, g: vec3f) -> vec4f {
  let binding=mapBinding(hit.mesh,slot);
  if (u.flags.y<0.5 || binding<0) { return vec4f(1); }
  let colorMap=slot==0 || slot==3;
  let uv=triangleUV(hit,slot);
  if (uv.valid) {
    let ab=instanceVector(hit.instance,triangles[hit.triangle+1].xyz); let ac=instanceVector(hit.instance,triangles[hit.triangle+2].xyz);
    let density=max(length(uv.b-uv.a)/max(length(ab),1e-6),length(uv.c-uv.a)/max(length(ac),1e-6));
    let footprint=pixelFootprint(hit)*density/max(abs(dot(g,normalize(p-u.eye.xyz))),0.1);
    return sampleImage(binding,uv.a*(1.0-hit.uv.x-hit.uv.y)+uv.b*hit.uv.x+uv.c*hit.uv.y,footprint,colorMap);
  }
  let scale=max(pbr[hit.mesh*6+3].y,0.0001);
  var w=pow(abs(g),vec3f(4)); w/=max(w.x+w.y+w.z,1e-6);
  let q=p/scale; let transform=bindings[binding*3+1];
  let footprint=pixelFootprint(hit)/scale*max(length(transform.xy),length(transform.zw));
  return sampleImage(binding,transformedUV(binding,vec2f(select(q.z,-q.z,g.x<0),q.y)),footprint,colorMap)*w.x+
    sampleImage(binding,transformedUV(binding,vec2f(q.x,select(q.z,-q.z,g.y<0))),footprint,colorMap)*w.y+
    sampleImage(binding,transformedUV(binding,vec2f(select(q.x,-q.x,g.z<0),q.y)),footprint,colorMap)*w.z;
}
fn surfaceOpacity(hit: Hit, p: vec3f) -> f32 {
  if (u.flags.w<0.5) { return 1; }
  var opacity=materials[hit.mesh*2+1].y; let mode=pbr[hit.mesh*6].w;
  if (mode>0.5) { opacity*=sampleMap(hit,0,p,hit.geometricNormal).a; }
  if (mode>0.5 && mode<1.5) { return select(1.0,0.0,opacity<pbr[hit.mesh*6+1].w); }
  return opacity;
}
fn mappedNormal(hit: Hit, p: vec3f, n: vec3f, rd: vec3f) -> vec3f {
  let binding=mapBinding(hit.mesh,2);
  if (u.flags.y<0.5 || binding<0) { return n; }
  let uv=triangleUV(hit,2); var mapped: vec3f;
  if (uv.valid) {
    let du=uv.b-uv.a; let dv=uv.c-uv.a; let determinant=du.x*dv.y-du.y*dv.x;
    if (abs(determinant)<1e-8) { return n; }
    let ab=instanceVector(hit.instance,triangles[hit.triangle+1].xyz); let ac=instanceVector(hit.instance,triangles[hit.triangle+2].xyz);
    var t=(ab*dv.y-ac*du.y)/determinant; let bitangent=(ac*du.x-ab*dv.x)/determinant;
    t-=n*dot(n,t); if (dot(t,t)<1e-12) { return n; } t=normalize(t);
    var bAxis=normalize(cross(n,t)); if (dot(bAxis,bitangent)<0) { bAxis=-bAxis; }
    mapped=mat3x3f(t,bAxis,n)*(sampleMap(hit,2,p,hit.geometricNormal).xyz*2.0-vec3f(1));
  } else {
    let g=hit.geometricNormal; let scale=max(pbr[hit.mesh*6+3].y,0.0001); let q=p/scale;
    var w=pow(abs(g),vec3f(4)); w/=max(w.x+w.y+w.z,1e-6);
    let sx=select(1.0,-1.0,g.x<0); let sy=select(1.0,-1.0,g.y<0); let sz=select(1.0,-1.0,g.z<0);
    let footprint=pixelFootprint(hit)/scale;
    var nx=sampleImage(binding,transformedUV(binding,vec2f(sx*q.z,q.y)),footprint,false).xyz*2.0-vec3f(1);
    var ny=sampleImage(binding,transformedUV(binding,vec2f(q.x,sy*q.z)),footprint,false).xyz*2.0-vec3f(1);
    var nz=sampleImage(binding,transformedUV(binding,vec2f(sz*q.x,q.y)),footprint,false).xyz*2.0-vec3f(1);
    let m=bindings[binding*3+1]; let o=bindings[binding*3+2];
    if (dot(m.xz,m.xz)<1e-12 || dot(m.yw,m.yw)<1e-12) { return n; }
    let tu=normalize(m.xz); var tv=normalize(m.yw); if (o.z>0.5) { tv=-tv; }
    nx=vec3f(tu*nx.x+tv*nx.y,nx.z); ny=vec3f(tu*ny.x+tv*ny.y,ny.z); nz=vec3f(tu*nz.x+tv*nz.y,nz.z);
    mapped=n+vec3f(0,nx.y,sx*nx.x)*w.x+vec3f(ny.x,0,sy*ny.y)*w.y+vec3f(sz*nz.x,nz.y,0)*w.z;
  }
  if (dot(mapped,mapped)<1e-10) { return n; }
  mapped=normalize(mapped);
  return select(n,mapped,dot(mapped,hit.geometricNormal)>0 && dot(mapped,-rd)>0);
}
fn surfaceMaterial(hit: Hit, p: vec3f) -> Material {
  let color=materials[hit.mesh*2]; let factors=pbr[hit.mesh*6];
  var albedo=color.rgb*sampleMap(hit,0,p,hit.geometricNormal).rgb;
  if (materials[hit.mesh*2+1].x>0.5) {
    let sum=floor(p.x)+floor(p.z); var checker=sum-2.0*floor(sum/2.0);
    checker=mix(checker,0.5,smoothstep(15.0,45.0,length(p.xz-u.eye.xz))); albedo*=mix(0.55,1.0,checker);
  }
  let mr=sampleMap(hit,1,p,hit.geometricNormal);
  let metallic=clamp(factors.x*mr.b,0.0,1.0); let roughness=clamp(factors.y*mr.g,0.045,1.0);
  let dielectric=pow((factors.z-1.0)/(factors.z+1.0),2.0);
  let emission=pbr[hit.mesh*6+1].rgb*sampleMap(hit,3,p,hit.geometricNormal).rgb;
  let optical=pbr[hit.mesh*6+4]; let attenuation=pbr[hit.mesh*6+5].rgb;
  let absorption=pow(max(attenuation,vec3f(1e-6)),vec3f(optical.y*optical.z));
  return Material(albedo,metallic,roughness,mix(vec3f(dielectric),albedo,metallic),emission,
    sampleMap(hit,4,p,hit.geometricNormal).r,select(0.0,optical.x,u.flags.w>0.5),albedo*absorption);
}
fn fresnel(f0: vec3f, cosine: f32) -> vec3f { return f0+(vec3f(1)-f0)*pow(1.0-clamp(cosine,0.0,1.0),5.0); }
fn surfaceTransmission(m: Material, opacity: f32, cosine: f32) -> vec3f {
  return vec3f(1.0-opacity)+opacity*m.transmission*(1.0-m.metallic)*m.transmissionTint*(vec3f(1)-fresnel(m.f0,cosine));
}
fn boundsHit(ro: vec3f, invRay: vec3f, lo: vec3f, hi: vec3f, limit: f32) -> bool {
  let a=(lo-ro)*invRay; let b=(hi-ro)*invRay; let nearT=min(a,b); let farT=max(a,b);
  return max(0.0,max(nearT.x,max(nearT.y,nearT.z)))<=min(limit,min(farT.x,min(farT.y,farT.z)));
}
fn clipBoxContains(mesh:i32,position:vec3f)->bool {
  let address=i32(materials[mesh*2+1].z);
  if(address<=0){return true;}
  let point=vec4f(position,1);
  let boxPos=vec3f(dot(materials[address],point),dot(materials[address+1],point),dot(materials[address+2],point));
  return all(abs(boxPos)<=vec3f(1));
}
fn traceBLAS(ro: vec3f, rd: vec3f, limit: f32, anyHit: bool, minT: f32, start: i32, end: i32, instance: i32) -> Hit {
  var hit=Hit(limit,vec3f(0),vec2f(0),-1,-1,-1,-1,instance);
  let invRay=vec3f(1)/select(rd,vec3f(1e-20),abs(rd)<vec3f(1e-20));
  var node=start; var visited=0;
  loop {
    if (node<0 || node>=end || visited>=end-start) { break; } visited++;
    let lo=nodes[node*3]; let hi=nodes[node*3+1];
    if (!boundsHit(ro,invRay,lo.xyz,hi.xyz,hit.t)) { node=i32(lo.w); continue; }
    let first=i32(hi.w); if (first<0) { node++; continue; }
    let count=i32(nodes[node*3+2].x);
    for (var j=0; j<16; j++) {
      if (j>=count) { break; }
      let address=(first+j)*3; let vertex=triangles[address]; let edge=triangles[address+1];
      let edgeC=triangles[address+2];let a=vertex.xyz; let ab=edge.xyz; let ac=edgeC.xyz;
      let p=cross(rd,ac); let det=dot(ab,p);var tolerance=1e-10;
      if(instance>=0){tolerance*=length(ab)*length(ac)*length(rd);}
      if (abs(det)<tolerance) { continue; }
      let s=ro-a; let bU=dot(s,p)/det; if (bU<0 || bU>1) { continue; }
      let q=cross(s,ab); let bV=dot(rd,q)/det; if (bV<0 || bU+bV>1) { continue; }
      let t=dot(ac,q)/det; if (t<=minT || t>=hit.t) { continue; }
      var mesh=select(instance,i32(vertex.w),instance<0);
      if(instance>=0){mesh=i32(materials[i32(u.environment.w)+mesh/4][mesh%4]);}
      if (lightingTraceDomain>=0 && i32(materials[mesh*2+1].w)!=lightingTraceDomain) {continue;}
      let materialInfo=materials[mesh*2+1];
      if (u.flags.w>0.5 && materialInfo.y<=0) { continue; }
      if(!clipBoxContains(mesh,ro+rd*t)){continue;}
      if(anyHit){return Hit(t,vec3f(0),vec2f(0),-1,mesh,address,-1,instance);}
      let localNormal=normalize(cross(ab,ac));
      let n=normalize(instanceNormal(instance,select(-localNormal,localNormal,dot(localNormal,rd)<0)));
      hit=Hit(t,n,vec2f(bU,bV),i32(edge.w)-1,mesh,address,(i32(edgeC.w)-1)*select(2,10,instance<0),instance);

    }
    node=i32(lo.w);
  }
  return hit;
}
fn trace(ro: vec3f, rd: vec3f, limit: f32, anyHit: bool, minT: f32) -> Hit {
  if(u.resolution.w<0.5){return traceBLAS(ro,rd,limit,anyHit,minT,0,i32(u.resolution.z),-1);}
  var hit=Hit(limit,vec3f(0),vec2f(0),-1,-1,-1,-1,-1);
  let invRay=vec3f(1)/select(rd,vec3f(1e-20),abs(rd)<vec3f(1e-20));
  var node=0;
  for(var visited=0;visited<i32(u.clip.w)&&node<i32(u.clip.w);visited++){
    let offset=i32(u.options.w)+node*3;let lo=materials[offset];let hi=materials[offset+1];
    if(!boundsHit(ro,invRay,lo.xyz,hi.xyz,hit.t)){node=i32(lo.w);continue;}
    let instance=i32(hi.w);if(instance<0){node++;continue;}
    let x=instanceData(instance,0);let y=instanceData(instance,1);let z=instanceData(instance,2);let range=instanceData(instance,6);
    let localOrigin=vec3f(dot(x,vec4f(ro,1)),dot(y,vec4f(ro,1)),dot(z,vec4f(ro,1)));
    // Deliberately unnormalized, preserving world-space t under any affine scale.
    let localDirection=vec3f(dot(x.xyz,rd),dot(y.xyz,rd),dot(z.xyz,rd));
    let candidate=traceBLAS(localOrigin,localDirection,hit.t,anyHit,minT,i32(range.x),i32(range.y),instance);
    if(candidate.mesh>=0){hit=candidate;if(anyHit){return hit;}}
    node=i32(lo.w);
  }
  return hit;
}

fn decodeOct(p: vec2f) -> vec3f {
  if(p.x>1.5){return vec3f(0);}
  var n=vec3f(p,1.0-abs(p.x)-abs(p.y));
  if(n.z<0){let xy=(vec2f(1)-abs(n.yx))*select(vec2f(1),vec2f(-1),n.xy<vec2f(0));n.x=xy.x;n.y=xy.y;}
  return normalize(n);
}
fn shadingNormal(hit: Hit, rd: vec3f) -> vec3f {
  let g=hit.geometricNormal; if (u.options.x<0.5 || hit.normals<0) { return g; }
  var n=vec3f(0);
  if(hit.instance<0){n=normals[hit.normals].xyz*(1.0-hit.uv.x-hit.uv.y)+normals[hit.normals+1].xyz*hit.uv.x+normals[hit.normals+2].xyz*hit.uv.y;}
  else {let a=normals[hit.normals];let b=normals[hit.normals+1];n=decodeOct(a.xy)*(1.0-hit.uv.x-hit.uv.y)+decodeOct(a.zw)*hit.uv.x+decodeOct(b.xy)*hit.uv.y;}
  n=instanceNormal(hit.instance,n);
  if (dot(n,n)<1e-10) { return g; } n=normalize(n);
  if (dot(n,g)<0) { n=-n; } return select(g,n,dot(n,-rd)>0);
}
fn domainVisibility(p:vec3f,n:vec3f,l:vec3f,distance:f32)->vec3f {
  if(u.flags.z<.5 || dot(n,l)<=0.0){return vec3f(1);}
  let ro=p+n*EPS*4.0;var minT=EPS;var result=vec3f(1);
  for(var i=0;i<32;i++){
    let hit=trace(ro,l,distance-EPS,false,minT);if(hit.mesh<0){return result;}
    let opacity=surfaceOpacity(hit,ro+l*hit.t);
    if(opacity>0.0){result*=surfaceTransmission(surfaceMaterial(hit,ro+l*hit.t),opacity,dot(hit.geometricNormal,-l));}
    if(max(result.x,max(result.y,result.z))<.001){return vec3f(0);}
    minT=hit.t+EPS;
  }
  return vec3f(0);
}
fn ambient(n: vec3f) -> vec3f {
  if (u.environment.x>0.5) { return textureSampleLevel(irradianceMap,environmentSampler,n,0).rgb*u.environment.y; }
  return vec3f(0.16+0.09*max(0.0,dot(n,u.worldUp.xyz)));
}
fn sky(d: vec3f) -> vec3f {
  if (u.environment.x>0.5) { return textureSampleLevel(environmentMap,environmentSampler,d,0).rgb*u.environment.y; }
  let color=mix(vec3f(0.48,0.58,0.61),vec3f(0.09,0.19,0.25),smoothstep(-0.2,0.9,dot(d,u.worldUp.xyz)));
  let panel=pow(max(0.0,dot(d,u.skyLight.xyz)),40.0);
  return color+vec3f(1,0.9,0.72)*panel*1.5;
}
fn shadowVisibility(ro: vec3f, rd: vec3f, limit: f32) -> vec3f {
  if (u.flags.w<0.5) { return select(vec3f(0),vec3f(1),trace(ro,rd,limit,true,EPS).mesh<0); }
  var visibility=vec3f(1); var minT=EPS;
  for (var layer=0; layer<16; layer++) {
    let hit=trace(ro,rd,limit,false,minT); if (hit.mesh<0) { return visibility; }
    let p=ro+rd*hit.t; let opacity=surfaceOpacity(hit,p);
    if (opacity>0) {
      if (pbr[hit.mesh*6+4].x>0) { visibility*=surfaceTransmission(surfaceMaterial(hit,p),opacity,dot(hit.geometricNormal,-rd)); }
      else { visibility*=1.0-opacity; }
    }
    if (strength(visibility)<0.002) { return vec3f(0); } minT=hit.t+EPS;
  }
  return vec3f(0);
}
fn ggx(nh: f32, roughness: f32) -> f32 {
  let a2=pow(roughness,4.0); let d=nh*nh*(a2-1.0)+1.0; return a2/max(PI*d*d,1e-8);
}
fn smith(cosine: f32, roughness: f32) -> f32 {
  let a2=pow(roughness,4.0); return 2.0*cosine/max(cosine+sqrt(a2+(1.0-a2)*cosine*cosine),1e-6);
}
fn roughSky(direction: vec3f, roughness: f32) -> vec3f {
  if (u.environment.x>0.5) { return textureSampleLevel(environmentMap,environmentSampler,direction,roughness*u.environment.z).rgb*u.environment.y; }
  let t=normalize(cross(direction,select(vec3f(1,0,0),vec3f(0,1,0),abs(direction.y)<0.95)));
  let b=cross(direction,t); let spread=roughness*roughness*1.5;
  return (sky(direction)*2.0+sky(normalize(direction+t*spread))+sky(normalize(direction-t*spread))+sky(normalize(direction+b*spread))+sky(normalize(direction-b*spread)))/6.0;
}
fn environmentSpecular(m: Material, nv: f32) -> vec3f {
  var specularFactor=fresnel(m.f0,nv);
  if (u.environment.x>0.5) { let brdf=textureSampleLevel(brdfMap,environmentSampler,vec2f(nv,m.roughness),0).rg; specularFactor=m.f0*brdf.x+vec3f(brdf.y); }
  return m.ao*specularFactor;
}
fn pbrLight(p: vec3f, n: vec3f, g: vec3f, rd: vec3f, m: Material, tracedShare: f32, specularFactor: vec3f${sharedShadow ? ", visibility: vec3f" : ""}) -> vec3f {
  let nv=max(dot(n,-rd),0.0001); let f=fresnel(m.f0,nv);
  var lighting=m.emission+m.ao*((vec3f(1)-f)*(1.0-m.metallic)*(1.0-m.transmission)*m.albedo*ambient(n))+specularFactor*(1.0-tracedShare)*roughSky(reflect(rd,n),m.roughness);
  let delta=u.light.xyz-p; let distanceToLight=length(delta); let l=delta/distanceToLight; let nl=max(dot(n,l),0.0);
  if (nl<=0 || dot(g,l)<=0) { return lighting; }
  ${sharedShadow ? "" : "var visibility=vec3f(1); if (u.flags.z>0.5) { visibility=shadowVisibility(p+g*EPS*4.0,l,distanceToLight-EPS); }"}
  if (strength(visibility)<=0) { return lighting; }
  let h=normalize(l-rd); let F=fresnel(m.f0,max(dot(h,-rd),0.0));
  let specular=ggx(max(dot(n,h),0.0),m.roughness)*smith(nv,m.roughness)*smith(nl,m.roughness)*F/max(4.0*nl*nv,1e-6);
  let diffuse=(vec3f(1)-F)*(1.0-m.metallic)*(1.0-m.transmission)*m.albedo/PI;
  lighting+=(diffuse+specular)*nl*visibility*vec3f(1,0.90,0.76)*(75.0*u.light.w*u.light.w/(distanceToLight*distanceToLight)); return lighting;
}
fn surfaceLighting(p: vec3f, n: vec3f, g: vec3f, rd: vec3f, material: vec4f, checkerEnabled: f32${sharedShadow ? ", visibility: vec3f" : ""}) -> vec3f {
  var albedo=pow(material.rgb,vec3f(2.2));
  if (checkerEnabled>0.5) { let sum=floor(p.x)+floor(p.z); var checker=sum-2.0*floor(sum/2.0); checker=mix(checker,0.5,smoothstep(15.0,45.0,length(p.xz-u.eye.xz))); albedo*=mix(0.55,1.0,checker); }
  var lighting=albedo*ambient(n); let delta=u.light.xyz-p; let distanceToLight=length(delta); let l=delta/distanceToLight; let diffuse=max(0.0,dot(n,l));
  if (diffuse<=0 || dot(g,l)<=0) { return lighting; }
  ${sharedShadow ? "" : "var visibility=vec3f(1); if (u.flags.z>0.5) { visibility=shadowVisibility(p+g*EPS*4.0,l,distanceToLight-EPS); }"}
  let halfway=normalize(l-rd); let specular=pow(max(0.0,dot(n,halfway)),72.0)*material.w;
  lighting+=visibility*(albedo*diffuse+vec3f(specular))*vec3f(1,0.9,0.76)*(24.0*u.light.w*u.light.w/(distanceToLight*distanceToLight)); return lighting;
}
fn radiance(ro: vec3f, rd: vec3f) -> vec3f {
  var color=vec3f(0); var ray=Ray(ro,rd,vec3f(1),0,0,max(EPS,u.clip.x/max(dot(rd,u.forward.xyz),1e-6)),0);
  var pending: array<Ray,4>; var pendingCount=0;
  for (var step=0; step<128; step++) {
    if (strength(ray.weight)>=0.002 && ray.layers<16) {
      var limit=FAR; if (ray.bounces==0) { limit=u.clip.y/max(dot(ray.direction,u.forward.xyz),1e-6); }
      let hit=trace(ray.origin,ray.direction,limit,false,ray.minT);
      if (hit.mesh<0) {
        if((fract(ray.layers)*2.0)>0){color+=ray.weight*roughSky(ray.direction,(fract(ray.layers)*2.0))*select(1.0,materials[max(ray.domain,0)].z,ray.domain>0);}
        else {color+=ray.weight*sky(ray.direction)*select(1.0,materials[max(ray.domain,0)].z,ray.domain>0);}
      }
      else {
        let p=ray.origin+ray.direction*hit.t; let g=hit.geometricNormal; var n=shadingNormal(hit,ray.direction);
        var material=materials[hit.mesh*2]; let properties=materials[hit.mesh*2+1]; let opacity=surfaceOpacity(hit,p);
        if (opacity<=0) { ray.minT=hit.t+EPS; continue; }
        let m=surfaceMaterial(hit,p); n=mappedNormal(hit,p,n,ray.direction);
        var reflection=0.0; var tracedShare=0.0;
        if (u.options.y>0) { reflection=material.w+(1.0-material.w)*0.5*pow(1.0-max(0.0,dot(n,-ray.direction)),5.0); tracedShare=pow(1.0-m.roughness,2.0); }
        // Use the same integrated IBL weight for filtered and traced shares.
        var specularFactor=vec3f(0); var reflectionWeight=vec3f(reflection);
        if (u.flags.x>0.5) { specularFactor=environmentSpecular(m,max(dot(n,-ray.direction),0.0001)); reflectionWeight=specularFactor*tracedShare; }
        else if (m.transmission*(1.0-m.metallic)>0) { reflectionWeight=mix(reflectionWeight,fresnel(m.f0,max(dot(n,-ray.direction),0.0)),m.transmission*(1.0-m.metallic)); }
        lightingTraceDomain=i32(properties.w);
        ${sharedShadow ? `// Compile one copy of flat-scene shadow traversal and material sampling.
        var visibility=vec3f(1);
        let lightDelta=u.light.xyz-p; let lightDistance=length(lightDelta); let lightDirection=lightDelta/lightDistance;
        if (u.flags.z>0.5 && dot(n,lightDirection)>0 && dot(g,lightDirection)>0 && properties.w==0.0) {
          visibility=shadowVisibility(p+g*EPS*4.0,lightDirection,lightDistance-EPS);
        }` : ""}
        if(properties.w>0.0){
          let env=ambient(n)*m.albedo*(1.0-m.metallic)*(1.0-m.transmission)+specularFactor*(1.0-tracedShare)*roughSky(reflect(ray.direction,n),m.roughness);
          color+=ray.weight*opacity*shadeLightingDomain(u32(properties.w)/2u,p,n,-ray.direction,m.albedo,m.roughness,m.metallic,pbr[hit.mesh*6].z,vec4f(0),u.flags.x>.5,m.transmission*(1.0-m.metallic),m.ao,m.emission,env);
        }
        else if (u.flags.x>0.5) { color+=ray.weight*opacity*pbrLight(p,n,g,ray.direction,m,tracedShare,specularFactor${sharedShadow ? ",visibility" : ""}); }
        else { material=vec4f(material.rgb*pow(sampleMap(hit,0,p,g).rgb,vec3f(1.0/2.2)),material.w); color+=ray.weight*opacity*(1.0-m.transmission*(1.0-m.metallic))*(1.0-reflection)*surfaceLighting(p,n,g,ray.direction,material,properties.x${sharedShadow ? ",visibility" : ""}); }
        lightingTraceDomain=-1;
        let reflected=ray.weight*opacity*reflectionWeight; let transmitted=ray.weight*surfaceTransmission(m,opacity,max(dot(n,-ray.direction),0.0));
        var reflectedDirection=reflect(ray.direction,n); if (dot(reflectedDirection,g)<=0) { reflectedDirection=reflect(ray.direction,g); }
        // Transparent continuations preserve this lobe; later mirrors cannot sharpen it.
        let environmentRoughness=select(0.0,max((fract(ray.layers)*2.0),m.roughness),u.flags.x>0.5);
        var reflectMore=strength(reflected)>=0.002; let transmitMore=strength(transmitted)>=0.002;
        if (ray.bounces>=i32(u.options.y)) {
          if (u.flags.x>0.5) { color+=reflected*roughSky(reflectedDirection,environmentRoughness)*select(1.0,materials[i32(properties.w)].z,properties.w>0.0); } else { color+=reflected*sky(reflectedDirection)*select(1.0,materials[i32(properties.w)].z,properties.w>0.0); } reflectMore=false;
        }
        if (reflectMore) {
          if (transmitMore) { pending[pendingCount]=Ray(ray.origin,ray.direction,transmitted,ray.bounces,ray.layers+1.0,hit.t+EPS,ray.domain); pendingCount++; }
          ray=Ray(p+g*EPS*4.0,reflectedDirection,reflected,ray.bounces+1,environmentRoughness*0.5,EPS,i32(properties.w)); continue;
        }
        if (transmitMore) { ray.weight=transmitted; ray.minT=hit.t+EPS; ray.layers+=1.0; continue; }
      }
    }
    if (pendingCount==0) { break; } pendingCount--; ray=pending[pendingCount];
  }
  return color;
}
fn cameraRay(pixel: vec2f) -> vec3f {
  let p=(2.0*pixel-u.resolution.xy)/u.resolution.y;
  return normalize(u.forward.xyz+(p.x*u.right.xyz+p.y*u.up.xyz)*u.forward.w);
}
fn cameraDepth(pixel: vec2f) -> f32 {
  let direction=cameraRay(pixel); let forwardDistance=max(dot(direction,u.forward.xyz),1e-6);
  var minT=max(EPS,u.clip.x/forwardDistance); let maxT=u.clip.y/forwardDistance;
  for (var layer=0; layer<128; layer++) {
    let hit=trace(u.eye.xyz,direction,maxT,false,minT); if (hit.mesh<0) { return 1; }
    if (surfaceOpacity(hit,u.eye.xyz+direction*hit.t)>0) {
      let viewDepth=hit.t*forwardDistance;
      if (u.clip.z>0) { return clamp(log2(1.0+viewDepth)*u.clip.z*0.5,0.0,1.0); }
      let clip=u.projection*vec4f(0,0,-viewDepth,1); return clamp(clip.z/clip.w*0.5+0.5,0.0,1.0);
    }
    minT=hit.t+EPS;
  }
  return 1;
}
@vertex fn vertexMain(@builtin(vertex_index) id: u32) -> @builtin(position) vec4f {
  let p=vec2f(f32((id<<1u)&2u),f32(id&2u)); return vec4f(p*2.0-vec2f(1),0,1);
}
struct Fragment { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 }
@fragment fn fragmentMain(@builtin(position) position: vec4f) -> Fragment {
  // WebGPU fragment Y starts at the top; camera basis uses positive-up pixels.
  let pixel=vec2f(position.x,u.resolution.y-position.y);
  var color=vec3f(0); let samples=select(1,4,u.options.z>0.5);
  for (var index=0; index<samples; index++) {
    var offset=vec2f(0); if (samples==4) { offset=vec2f(f32(index&1),f32(index>>1))*0.5-vec2f(0.25); }
    color+=radiance(u.eye.xyz,cameraRay(pixel+offset));
  }
  return Fragment(vec4f(max(color/f32(samples),vec3f(0)),1),cameraDepth(pixel));
}
`
  );
  if (!instanced) {
    code = code.replace(/fn trace\(ro:[\s\S]*?fn decodeOct/, "fn trace(ro: vec3f, rd: vec3f, limit: f32, anyHit: bool, minT: f32) -> Hit { return traceBLAS(ro,rd,limit,anyHit,minT,0,i32(u.resolution.z),-1); }\nfn decodeOct");
    code = code.replace(/fn instanceNormal\([\s\S]*?\n}/, "fn instanceNormal(instance: i32, n: vec3f) -> vec3f { return n; }");
    code = code.replace(/fn instanceVector\([\s\S]*?\n}/, "fn instanceVector(instance: i32, v: vec3f) -> vec3f { return v; }");
  }
  if (opaque) {
    code = code.replace("      if (lightingTraceDomain>=0 && i32(materials[mesh*2+1].w)!=lightingTraceDomain) {continue;}", "");
    code = code.replace("if(anyHit){return Hit(t,vec3f(0),vec2f(0),-1,mesh,address,-1,instance);}", "if(anyHit){return Hit(t,vec3f(0),vec2f(0),-1,0,address,-1,instance);}");
    code = code.replace("      let materialInfo=materials[mesh*2+1];\n      if (u.flags.w>0.5 && materialInfo.y<=0) { continue; }", "");
    code = code.replace(/fn shadowVisibility\([\s\S]*?\n}/, "fn shadowVisibility(ro:vec3f,rd:vec3f,limit:f32)->vec3f{return select(vec3f(0),vec3f(1),trace(ro,rd,limit,true,EPS).mesh<0);}");
    code = code.replace(/fn surfaceOpacity\([\s\S]*?\n}/, "fn surfaceOpacity(hit:Hit,p:vec3f)->f32{return 1.0;}");
  }
  if (sceneOnly) return code.slice(0, code.indexOf("fn ambient(")) + code.slice(code.indexOf("fn cameraRay("), code.indexOf("@vertex fn vertexMain"));
  if (progressive) {
    const binding = 16 + sharedCount * 2;
    code = code.replace("skyLight: vec4f,", "skyLight: vec4f, accumulation:vec4f,");
    code = code.replace("const EPS", `@group(0) @binding(${binding}) var history:texture_2d<f32>;
const EPS`);
    code = code.replace("@builtin(frag_depth) depth: f32", "@location(1) depth: f32");
    code = code.replace("cameraRay(pixel+offset)", "cameraRay(pixel+offset+u.accumulation.yz)");
    code = code.replace("  return Fragment(vec4f(max(color/f32(samples),vec3f(0)),1),cameraDepth(pixel));", `  color=max(color/f32(samples),vec3f(0));
  if(u.accumulation.x>0){let previous=textureLoad(history,vec2i(position.xy),0).rgb;color=previous+(color-previous)/(u.accumulation.x+1.0);}
  return Fragment(vec4f(color,1),cameraDepth(pixel));`);
    if (compute) {
      code = code.replace("@fragment fn fragmentMain(@builtin(position) position: vec4f)", "fn renderPixel(position: vec4f)");
      code += `
@group(0) @binding(${binding + 1}) var outputColor:texture_storage_2d<rgba16float,write>;
@group(0) @binding(${binding + 2}) var outputDepth:texture_storage_2d<r32float,write>;
@compute @workgroup_size(8,8) fn computeMain(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=u32(u.resolution.x)||id.y>=u32(u.resolution.y)){return;}
 let result=renderPixel(vec4f(vec2f(id.xy)+vec2f(.5),0,1));
 textureStore(outputColor,vec2i(id.xy),result.color);textureStore(outputDepth,vec2i(id.xy),vec4f(result.depth));
}`;
      code = code.replace("struct Fragment { @location(0) color: vec4f, @location(1) depth: f32 }", "struct Fragment { color:vec4f, depth:f32 }");
    }
  }
  return code;
}

// ../sdk-oct2/src/viewing/techniques/rayTracing/webGPU/pipelines.ts
var caches = /* @__PURE__ */ new WeakMap();
function acquirePipeline(context, key, create) {
  const { device, resourceLifetime: lifetime } = context;
  let owners = caches.get(device);
  if (!owners) {
    owners = /* @__PURE__ */ new WeakMap();
    caches.set(device, owners);
  }
  const owner = lifetime ?? {};
  let cache = owners.get(owner);
  if (!cache) {
    cache = new CompilationCache(() => {
    }, lifetime ? 4 : 0, lifetime);
    owners.set(owner, cache);
  }
  const lease = cache.acquire(key, create);
  void lease.value.then(() => lease.ready(), () => lease.invalidate());
  return { release: lease.release, wait: (signal) => awaitCompilation(awaitCompilation(lease.value, lifetime), signal) };
}
function acquireRayPipeline(context, sharedCount, instanced, progressive, compute, opaque, extension) {
  const { device, colorFormat, depthFormat } = context;
  const key = JSON.stringify([extension?.key ?? "ray", sharedCount, instanced, progressive, compute, opaque, colorFormat, depthFormat]);
  return acquirePipeline(context, key, () => buildRayPipeline(device, colorFormat, depthFormat, sharedCount, instanced, progressive, compute, opaque, extension));
}
async function buildRayPipeline(device, colorFormat, depthFormat, sharedCount, instanced, progressive, compute, opaque, extension) {
  if (compute ? !device.createComputePipelineAsync : !device.createRenderPipelineAsync) throw new Error("The WebGPU device wrapper must expose asynchronous pipeline creation.");
  device.pushErrorScope?.("out-of-memory");
  device.pushErrorScope?.("validation");
  let scopesOpen = true;
  const close = () => {
    scopesOpen = false;
    return device.popErrorScope ? Promise.all([device.popErrorScope(), device.popErrorScope()]) : Promise.resolve([]);
  };
  try {
    const module = device.createShaderModule({ label: "external WebGPU ray tracer", code: extension?.source(sharedCount, instanced) ?? createShaderSource(sharedCount, instanced, progressive, compute, opaque) });
    const entries = [
      { binding: 0, visibility: 2, buffer: { type: "uniform" } },
      ...Array.from({ length: 8 }, (_, i) => ({ binding: i + 1, visibility: 2, buffer: { type: "read-only-storage" } })),
      ...[9, 10].map((binding) => ({ binding, visibility: 2, texture: { viewDimension: "2d-array" } })),
      { binding: 11, visibility: 2, sampler: {} },
      ...[12, 13].map((binding) => ({ binding, visibility: 2, texture: { viewDimension: "cube" } })),
      { binding: 14, visibility: 2, texture: {} },
      { binding: 15, visibility: 2, sampler: {} },
      ...Array.from({ length: sharedCount }, (_, i) => [{ binding: 16 + i * 2, visibility: 2, texture: {} }, { binding: 17 + i * 2, visibility: 2, sampler: {} }]).flat()
    ];
    const historyBinding = 16 + sharedCount * 2;
    if (progressive) entries.push({ binding: historyBinding, visibility: 2, texture: { sampleType: "unfilterable-float" } });
    entries.push(...extension?.entries(historyBinding) ?? []);
    if (compute) {
      for (const entry of entries) entry.visibility = 4;
      entries.push(
        { binding: historyBinding + 1, visibility: 4, storageTexture: { access: "write-only", format: "rgba16float" } },
        { binding: historyBinding + 2, visibility: 4, storageTexture: { access: "write-only", format: "r32float" } }
      );
    }
    const layout = device.createBindGroupLayout({ entries });
    const descriptor = {
      label: "external WebGPU ray tracing",
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: "vertexMain" },
      fragment: { module, entryPoint: "fragmentMain", targets: extension ? extension.targets.map((format) => ({ format })) : progressive ? [{ format: "rgba16float" }, { format: "r32float" }] : [{ format: colorFormat }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: progressive ? void 0 : { format: depthFormat, depthWriteEnabled: true, depthCompare: "always" }
    };
    const compilation = module.getCompilationInfo?.();
    void compilation?.catch(() => {
    });
    const pending = compute ? device.createComputePipelineAsync({ label: "experimental ray tracing 8x8 compute", layout: descriptor.layout, compute: { module, entryPoint: "computeMain" } }) : device.createRenderPipelineAsync(descriptor);
    const errors = close();
    const [info, pipeline, validation] = await Promise.all([compilation, pending, errors]);
    const shaderErrors = info?.messages.filter((message) => message.type === "error");
    if (shaderErrors?.length) throw new Error(shaderErrors.map((message) => `WGSL ${message.lineNum}: ${message.message}`).join("\n"));
    if (validation.some(Boolean)) throw new Error(validation.filter(Boolean).map((error) => error.message).join("\n"));
    return { pipeline, layout };
  } catch (error) {
    if (scopesOpen) void close().catch(() => {
    });
    throw error;
  }
}

// ../sdk-oct2/src/viewing/techniques/rayTracing/webGPU/accumulation.ts
var shader = `
@group(0) @binding(0) var colorImage:texture_2d<f32>;
@group(0) @binding(1) var depthImage:texture_2d<f32>;
@vertex fn vertexMain(@builtin(vertex_index) id:u32)->@builtin(position) vec4f{
 let p=vec2f(f32((id<<1u)&2u),f32(id&2u));return vec4f(p*2.0-vec2f(1),0,1);
}
struct Fragment{@location(0) color:vec4f,@builtin(frag_depth) depth:f32}
@fragment fn fragmentMain(@builtin(position) p:vec4f)->Fragment{
 return Fragment(textureLoad(colorImage,vec2i(p.xy),0),textureLoad(depthImage,vec2i(p.xy),0).r);
}`;
async function createAccumulation(context, compute, signal) {
  const { device, colorFormat, depthFormat } = context;
  const lease = acquirePipeline(context, JSON.stringify(["composite", colorFormat, depthFormat]), async () => {
    device.pushErrorScope?.("out-of-memory");
    device.pushErrorScope?.("validation");
    let scopesOpen = true;
    const close = () => {
      scopesOpen = false;
      return device.popErrorScope ? Promise.all([device.popErrorScope(), device.popErrorScope()]) : Promise.resolve([]);
    };
    try {
      const layout2 = device.createBindGroupLayout({ entries: [0, 1].map((binding) => ({ binding, visibility: 2, texture: { sampleType: "unfilterable-float" } })) });
      const module = device.createShaderModule({ label: "ray accumulation composite", code: shader });
      const pending = device.createRenderPipelineAsync({
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout2] }),
        vertex: { module, entryPoint: "vertexMain" },
        fragment: { module, entryPoint: "fragmentMain", targets: [{ format: colorFormat }] },
        depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: "always" },
        primitive: { topology: "triangle-list" }
      });
      const [pipeline2, errors] = await Promise.all([pending, close()]);
      if (errors.some(Boolean)) throw new Error(errors.filter(Boolean).map((error) => error.message).join("\n"));
      return { layout: layout2, pipeline: pipeline2 };
    } catch (error) {
      if (scopesOpen) void close().catch(() => {
      });
      throw error;
    }
  });
  let compiled;
  try {
    compiled = await lease.wait(signal);
  } catch (error) {
    lease.release();
    throw error;
  }
  const { layout, pipeline } = compiled;
  const textures = [];
  let views = [], groups = [];
  let width = 0, height = 0, current = 0;
  const clearTargets = () => {
    textures.splice(0).forEach((t) => t.destroy?.());
    views = [];
    groups = [];
    width = height = 0;
  };
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTargets();
    lease.release();
  };
  return {
    resize(w, h) {
      if (disposed) throw new Error("Accumulation has been disposed.");
      if (width === w && height === h) return false;
      clearTargets();
      width = w;
      height = h;
      current = 0;
      try {
        for (const format of ["rgba16float", "rgba16float", "r32float"]) {
          const t = device.createTexture({ label: "ray accumulation", size: { width: w, height: h }, format, usage: 20 | (compute ? 8 : 0) });
          textures.push(t);
          views.push(t.createView());
        }
        groups = [0, 1].map((i) => device.createBindGroup({ layout, entries: [{ binding: 0, resource: views[i] }, { binding: 1, resource: views[2] }] }));
        return true;
      } catch (error) {
        clearTargets();
        throw error;
      }
    },
    get current() {
      return current;
    },
    get history() {
      return views[current];
    },
    get output() {
      return views[1 - current];
    },
    get depth() {
      return views[2];
    },
    finish() {
      current = 1 - current;
    },
    present(frame) {
      frame.pass.setPipeline(pipeline);
      frame.pass.setBindGroup(0, groups[current]);
      frame.pass.draw(3);
    },
    dispose
  };
}

// ../sdk-oct2/src/viewing/techniques/rayTracing/webGPU/tileBudget.ts
var TileBudget = class {
  constructor(limit = 1, targetMs = 12) {
    this.limit = limit;
    this.targetMs = targetMs;
  }
  limit;
  targetMs;
  count = 1;
  get tiles() {
    return this.count;
  }
  reset() {
    this.count = 1;
  }
  complete(tiles, elapsedMs) {
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || tiles < 1) return;
    const estimate = Math.max(1, Math.floor(tiles * this.targetMs / elapsedMs));
    this.count = Math.min(this.limit, estimate, tiles < this.count ? this.count : this.count * 2);
  }
};

// ../sdk-oct2/src/viewing/techniques/rayTracing/webGPU/renderer.ts
var geometryPools = /* @__PURE__ */ new WeakMap();
async function createSharedRenderer(context, data, lighting = { center: [0, 0, 0], scale: 1 }, signal, options = {}) {
  signal?.throwIfAborted();
  const device = context.device;
  const compute = !!options.experimentalCompute, progressive = !!options.progressive || compute;
  if (compute && !device.createComputePipelineAsync) throw new Error("This WebGPU device wrapper does not expose compute pipelines.");
  const kernel = options.kernel;
  const tileBudget = new TileBudget(kernel?.tileBatchLimit);
  const progress = kernel?.progress ?? new ProgressiveState();
  let pipelineLease;
  let accumulation;
  let currentStep, computePass;
  let gpuReady = true, submission = 0;
  let pendingTile;
  let tileRect;
  let frameSignature = [];
  let completedSamples = 0;
  let scheduled;
  const schedule = (view) => {
    if (scheduled !== void 0) return;
    scheduled = setTimeout(() => {
      scheduled = void 0;
      void (device.queue.onSubmittedWorkDone?.() ?? Promise.resolve()).then(() => {
        if (!disposed) view.needsRender();
      }).catch(() => {
      });
    }, kernel?.tileSize ? 0 : 16);
  };
  let pool = geometryPools.get(device);
  if (!pool) {
    pool = new ResourceLeases((value) => value.buffer.destroy?.());
    geometryPools.set(device, pool);
  }
  const geometryLeases = {};
  if (!device.createSampler || !device.queue.writeTexture) throw new Error("Ray tracing requires WebGPU samplers and texture uploads.");
  const buffers = [], textures = [];
  let disposed = false, frames = 0;
  let fallbackImages;
  let environment;
  let bindGroup;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    fallbackImages?.dispose();
    if (scheduled !== void 0) clearTimeout(scheduled);
    accumulation?.dispose();
    pipelineLease?.release();
    signal?.removeEventListener("abort", dispose);
    Object.values(geometryLeases).forEach((lease) => lease.release());
    buffers.forEach((buffer) => buffer.destroy?.());
    textures.forEach((texture) => texture.destroy?.());
    environment = void 0;
    bindGroup = void 0;
  };
  signal?.addEventListener("abort", dispose, { once: true });
  let scopesOpen = false;
  const closeScopes = () => {
    scopesOpen = false;
    return device.popErrorScope ? Promise.all([device.popErrorScope(), device.popErrorScope()]) : Promise.resolve([]);
  };
  let updates = 0, updatedBytes = 0, updateCalls = 0;
  try {
    const borrowed = [];
    const sharedLimit = Math.max(0, (device.limits?.maxSampledTexturesPerShaderStage ?? 16) - (kernel?.reservedTextures ?? (progressive ? 6 : 5)));
    let shared = new Float32Array(Math.max(8, (data.textureBindings?.length ?? 0) * 8));
    let bindings = data.bindings.slice();
    const images = [], imageIds = /* @__PURE__ */ new Map();
    const fallbackSlots = new Int32Array(Math.floor(bindings.length / 12)).fill(-1);
    let sharedBindingCount = 0;
    for (let i = 0; i < Math.floor(bindings.length / 12); i++) {
      const source = data.textureBindings?.[i];
      const resource = source && context.getMaterialTexture(source.mesh, source.slot);
      let index = resource ? borrowed.findIndex((item) => item.textureView === resource.textureView) : -1;
      if (resource && index < 0 && borrowed.length < sharedLimit) {
        index = borrowed.length;
        borrowed.push(resource);
      }
      shared[i * 8] = -1;
      if (resource && index >= 0) {
        shared.set([index, resource.flipY ? 1 : 0, resource.width, resource.height, resource.maxLod, 0, 0, 0], i * 8);
        sharedBindingCount++;
      } else {
        const old = bindings[i * 12];
        let layer = imageIds.get(old);
        if (layer === void 0) {
          layer = images.length;
          images.push(data.images[old]);
          imageIds.set(old, layer);
        }
        bindings[i * 12] = layer;
        fallbackSlots[i] = layer;
      }
    }
    fallbackImages = new FallbackImages(data, fallbackSlots);
    for (const [source, layer] of imageIds) if (!images[layer]) {
      const texture = data.imageSources?.[source];
      if (!texture) throw new Error("Missing ray-tracing fallback image.");
      images[layer] = await decodeTexture(texture, signal, data.textureSize);
    }
    signal?.throwIfAborted();
    device.pushErrorScope?.("out-of-memory");
    device.pushErrorScope?.("validation");
    scopesOpen = true;
    const writeData = (buffer, values, previous, track = false) => {
      for (const part of batchUploads(streamUploads(values, previous))) {
        device.queue.writeBuffer(buffer, part.offset * 4, part.values);
        if (track) {
          updatedBytes += part.values.byteLength;
          updateCalls++;
        }
      }
    };
    const createBuffer = (values, usage, label, track = false) => {
      const size = Math.max(16, values.byteLength);
      const limit = Math.min(device.limits?.maxBufferSize ?? 256 * 1024 * 1024, usage === 128 ? device.limits?.maxStorageBufferBindingSize ?? 128 * 1024 * 1024 : Infinity);
      if (size > limit) throw new Error(`${label} needs ${size} bytes; this device allows ${limit}. Use a smaller scene.`);
      const buffer = device.createBuffer({ label, size, usage: usage | 8 });
      try {
        writeData(buffer, values, void 0, track);
        return { buffer, capacity: size };
      } catch (error) {
        buffer.destroy?.();
        throw error;
      }
    };
    const uniforms = new Float32Array(kernel?.uniformFloats ?? (progressive ? 68 : 64));
    const uniformBuffer = createBuffer(uniforms, 64, "ray camera").buffer;
    buffers.push(uniformBuffer);
    const streams = dataStreams(data, bindings, shared);
    const capacities = [];
    const geometry = streams.map((values, i) => {
      let resource;
      if (mutableStreams.includes(i)) {
        resource = createBuffer(values, 128, `ray snapshot ${i}`);
        buffers.push(resource.buffer);
      } else {
        const lease = pool.acquire(values, () => createBuffer(values, 128, `ray snapshot ${i}`));
        geometryLeases[i] = lease;
        resource = lease.resource;
      }
      capacities[i] = resource.capacity;
      return resource.buffer;
    });
    const maxSize = Math.min(data.textureSize ?? 512, device.limits?.maxTextureDimension2D ?? 8192);
    let width = Math.max(1, ...images.map((image) => Math.min(maxSize, image.width)));
    let height = Math.max(1, ...images.map((image) => Math.min(maxSize, image.height)));
    const layers = Math.max(1, images.length);
    while (width * height * layers * 32 / 3 > 128 * 1024 * 1024 && (width > 1 || height > 1)) {
      width = Math.max(1, Math.floor(width / 2));
      height = Math.max(1, Math.floor(height / 2));
    }
    if (layers > (device.limits?.maxTextureArrayLayers ?? 256) || width * height * layers * 32 / 3 > 128 * 1024 * 1024) {
      throw new Error("Material textures exceed the ray tracer's 128 MiB array budget or device layer limit.");
    }
    const mipLevelCount = Math.floor(Math.log2(Math.max(width, height))) + 1;
    fallbackImages.initialize(images, width, height, maxSize);
    const resized = images.length ? images.map((image) => resizeTexturePixels(image, width, height)) : [new Uint8ClampedArray([255, 255, 255, 255])];
    const fallbackImageCount = images.length;
    images.length = 0;
    const fallbackTextures = [];
    const fallback = [false, true].map((srgb) => {
      const texture = device.createTexture({
        label: srgb ? "ray fallback sRGB" : "ray fallback linear",
        size: { width, height, depthOrArrayLayers: layers },
        format: srgb ? "rgba8unorm-srgb" : "rgba8unorm",
        mipLevelCount,
        usage: 6
      });
      textures.push(texture);
      fallbackTextures.push(texture);
      for (let layer = 0; layer < layers; layer++) {
        let pixels = resized[layer];
        let w = width, h = height;
        for (let level = 0; level < mipLevelCount; level++) {
          device.queue.writeTexture({ texture, mipLevel: level, origin: { x: 0, y: 0, z: layer } }, pixels, { bytesPerRow: w * 4, rowsPerImage: h }, { width: w, height: h, depthOrArrayLayers: 1 });
          if (level + 1 < mipLevelCount) {
            pixels = downsample(pixels, w, h, srgb);
            w = Math.max(1, w >> 1);
            h = Math.max(1, h >> 1);
          }
        }
      }
      return texture.createView({ dimension: "2d-array" });
    });
    resized.length = 0;
    const imageSampler = device.createSampler({ addressModeU: "repeat", addressModeV: "repeat", magFilter: "linear", minFilter: "linear", mipmapFilter: "linear" });
    const allocationErrors = closeScopes();
    const errors = await allocationErrors;
    signal?.throwIfAborted();
    if (errors.some(Boolean)) throw new Error(errors.filter(Boolean).map((error) => error.message).join("\n"));
    pipelineLease = acquireRayPipeline(context, borrowed.length, !!data.instances, progressive, compute, opaqueScene(data), kernel?.pipeline);
    const { pipeline, layout } = await pipelineLease.wait(signal);
    const historyBinding = 16 + borrowed.length * 2;
    if (progressive) {
      const created = await (kernel?.createAccumulation ?? createAccumulation)(context, compute, signal);
      if (disposed || signal?.aborted) {
        created.dispose();
        signal?.throwIfAborted();
        throw new Error("Ray tracing was disposed during initialization.");
      }
      accumulation = created;
    }
    signal?.throwIfAborted();
    signal?.removeEventListener("abort", dispose);
    const historyGroups = [];
    let kernelResources = [];
    const api = {
      async prepareUpdate(next, signal2) {
        if (!disposed && compatibleGeometry(data, next)) await fallbackImages.prepare(next, signal2);
      },
      get updateStats() {
        return { updates, bytes: updatedBytes, calls: updateCalls };
      },
      update(next) {
        if (disposed || !compatibleGeometry(data, next)) return false;
        const imageUpdate = fallbackImageCount ? fallbackImages.get(next) : void 0;
        if (fallbackImageCount && !imageUpdate) return false;
        const nextBindings = fallbackImageCount ? next.bindings.slice() : next.bindings;
        let nextSharedBindingCount = 0;
        const nextBorrowed = [], nextShared = new Float32Array(Math.max(8, (next.textureBindings?.length ?? 0) * 8));
        for (let i = 0; i < Math.floor(next.bindings.length / 12); i++) {
          if (fallbackSlots[i] >= 0) {
            nextBindings[i * 12] = fallbackSlots[i];
            nextShared[i * 8] = -1;
            continue;
          }
          const source = next.textureBindings?.[i], resource = source && context.getMaterialTexture(source.mesh, source.slot);
          if (!resource) return false;
          nextSharedBindingCount++;
          let index = nextBorrowed.findIndex((item) => item.textureView === resource.textureView);
          if (index < 0) {
            index = nextBorrowed.length;
            nextBorrowed.push(resource);
          }
          nextShared.set([index, resource.flipY ? 1 : 0, resource.width, resource.height, resource.maxLod, 0, 0, 0], i * 8);
        }
        if (nextBorrowed.length !== borrowed.length) return false;
        const nextStreams = dataStreams(next, nextBindings, nextShared);
        const replacements = /* @__PURE__ */ new Map(), newLeases = /* @__PURE__ */ new Map();
        try {
          for (let i = 0; i < streams.length; i++) {
            const resize = nextStreams[i].byteLength > capacities[i] || capacities[i] > Math.max(16384, streamLiveLength(nextStreams[i]) * 6), lease = geometryLeases[i];
            if (resize || lease && streams[i] !== nextStreams[i] && !lease.canRekey(nextStreams[i])) {
              if (lease) {
                const replacement = pool.acquire(nextStreams[i], () => createBuffer(nextStreams[i], 128, `ray snapshot ${i}`, true));
                newLeases.set(i, replacement);
                replacements.set(i, replacement.resource);
              } else replacements.set(i, createBuffer(nextStreams[i], 128, `ray snapshot ${i}`, true));
            }
          }
          for (let i = 0; i < streams.length; i++) if (!replacements.has(i)) writeData(geometry[i], nextStreams[i], streams[i], true);
          for (const [layer, base] of imageUpdate?.pixels ?? []) {
            for (let color = 0; color < 2; color++) {
              let pixels = base, w = width, h = height;
              for (let level = 0; level < mipLevelCount; level++) {
                device.queue.writeTexture({ texture: fallbackTextures[color], mipLevel: level, origin: { x: 0, y: 0, z: layer } }, pixels, { bytesPerRow: w * 4, rowsPerImage: h }, { width: w, height: h, depthOrArrayLayers: 1 });
                if (level + 1 < mipLevelCount) {
                  pixels = downsample(pixels, w, h, color === 1);
                  w = Math.max(1, w >> 1);
                  h = Math.max(1, h >> 1);
                }
              }
            }
          }
          const handlesChanged = nextBorrowed.some((item, i) => item.textureView !== borrowed[i].textureView || item.sampler !== borrowed[i].sampler);
          const buffersChanged = replacements.size > 0;
          for (const [i, resource] of replacements) {
            if (newLeases.has(i)) {
              geometryLeases[i].release();
              geometryLeases[i] = newLeases.get(i);
            } else {
              const old = geometry[i];
              buffers.splice(buffers.indexOf(old), 1, resource.buffer);
              old.destroy?.();
            }
            geometry[i] = resource.buffer;
            capacities[i] = resource.capacity;
          }
          geometryUnits.forEach((i) => {
            if (!replacements.has(i) && streams[i] !== nextStreams[i]) geometryLeases[i].rekey(nextStreams[i]);
          });
          replacements.clear();
          newLeases.clear();
          nextStreams.forEach((values, i) => {
            streams[i] = values;
          });
          borrowed.splice(0, borrowed.length, ...nextBorrowed);
          bindings = nextBindings;
          shared = nextShared;
          fallbackImages.commit(next);
          sharedBindingCount = nextSharedBindingCount;
          if (handlesChanged || buffersChanged) {
            bindGroup = void 0;
            historyGroups.length = 0;
          }
          data = next;
          progress.reset();
          currentStep = void 0;
          pendingTile = void 0;
          frameSignature = [];
          completedSamples = 0;
          updates++;
          return true;
        } catch (error) {
          for (const [i, resource] of replacements) {
            if (newLeases.has(i)) newLeases.get(i).release();
            else resource.buffer.destroy?.();
          }
          dispose();
          throw error;
        }
      },
      get sharedTextures() {
        return borrowed.map((item) => item.textureView);
      },
      get sharedBindingCount() {
        return sharedBindingCount;
      },
      fallbackImageCount,
      fallbackTextureSize: [width, height],
      get accumulatedSamples() {
        return kernel?.tileSize ? completedSamples : progress.samples;
      },
      get quality() {
        return pendingTile ? "refinement" : progressive ? progress.mode : "high-quality";
      },
      get samplingPending() {
        return !!pendingTile;
      },
      get progressive() {
        return progressive;
      },
      get compute() {
        return compute;
      },
      get frames() {
        return frames;
      },
      get disposed() {
        return disposed;
      },
      get environment() {
        return environment;
      },
      prepareFrame(camera, settings, frame) {
        if (!accumulation || disposed) return;
        const basis = camera.basis(frame.width / frame.height), ibl = context.getEnvironment(frame.view);
        const signature = [
          ...kernel?.signature(frame) ?? [],
          frame.width,
          frame.height,
          ...basis.eye,
          ...basis.forward,
          ...basis.right,
          ...basis.up,
          basis.tanHalfFov,
          ...frame.view.camera.projMatrix,
          settings.antialiasing,
          settings.bounces,
          settings.lightAngle,
          settings.shadows,
          settings.transparency,
          settings.smoothShading,
          settings.pbr,
          settings.textures,
          ...lighting.center,
          lighting.scale,
          frame.view.lights.ibl.applied,
          frame.view.lights.ibl.possible,
          ibl.irradiance,
          ibl.prefiltered,
          ibl.brdf,
          ibl.sampler,
          ibl.intensity,
          ibl.maxSpecularMipLevel,
          frame.output.logDepthCoefficient
        ];
        if (signature.length !== frameSignature.length || signature.some((v, i) => !Object.is(v, frameSignature[i]))) {
          frameSignature = signature;
          pendingTile = void 0;
          completedSamples = 0;
          tileBudget.reset();
        }
        currentStep = pendingTile?.step ?? progress.next(signature, performance.now(), settings.antialiasing === "4x", settings.bounces, gpuReady);
        if (accumulation.resize(frame.width, frame.height)) {
          historyGroups.length = 0;
          bindGroup = void 0;
        }
        if (currentStep.trace && gpuReady) {
          let tracedTiles = 0;
          const reduced = { ...settings, antialiasing: "none", bounces: currentStep.bounces };
          if (compute) {
            if (!frame.encoder.beginComputePass) throw new Error("This device wrapper does not expose compute passes.");
            computePass = frame.encoder.beginComputePass({ label: "ray trace sample" });
            try {
              api.draw(camera, reduced, { ...frame, pass: {} });
            } finally {
              computePass.end();
              computePass = void 0;
            }
          } else {
            const size = kernel?.tileSize;
            if (size) {
              pendingTile ??= { x: 0, y: 0, step: currentStep };
            }
            const first = !pendingTile || pendingTile.x === 0 && pendingTile.y === 0;
            const pass = frame.encoder.beginRenderPass({ label: "ray trace sample", timestampWrites: kernel?.timestampWrites?.(), colorAttachments: [accumulation.output, accumulation.depth].map((view) => ({ view, loadOp: first ? "clear" : "load", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } })) });
            try {
              const count = size ? tileBudget.tiles : 1;
              for (let i = 0; i < count; i++) {
                if (pendingTile) tileRect = [pendingTile.x, pendingTile.y, Math.min(size, frame.width - pendingTile.x), Math.min(size, frame.height - pendingTile.y)];
                api.draw(camera, reduced, { ...frame, pass });
                tracedTiles++;
                if (pendingTile) {
                  pendingTile.x += size;
                  if (pendingTile.x >= frame.width) {
                    pendingTile.x = 0;
                    pendingTile.y += size;
                  }
                  if (pendingTile.y >= frame.height) {
                    pendingTile = void 0;
                    frames++;
                    break;
                  }
                }
              }
            } finally {
              tileRect = void 0;
              pass.end?.();
            }
            kernel?.afterTrace?.(frame);
          }
          if (!pendingTile) {
            accumulation.finish();
            completedSamples = progress.samples;
          }
          gpuReady = false;
          const ticket = ++submission;
          const submittedSignature = frameSignature;
          queueMicrotask(() => {
            if (disposed || ticket !== submission) return;
            const started = performance.now();
            void (device.queue.onSubmittedWorkDone?.() ?? Promise.resolve()).then(() => {
              if (disposed || ticket !== submission) return;
              if (kernel?.tileSize && frameSignature === submittedSignature) tileBudget.complete(tracedTiles, performance.now() - started);
              gpuReady = true;
              schedule(frame.view);
            }).catch(() => {
            });
          });
        }
        if ((currentStep.pending || pendingTile) && gpuReady) schedule(frame.view);
      },
      present(frame) {
        if (!disposed) accumulation?.present(frame);
      },
      draw(camera, settings, frame) {
        if (disposed) return;
        const ibl = context.getEnvironment(frame.view);
        if (environment?.irradiance !== ibl.irradiance || environment?.prefiltered !== ibl.prefiltered || environment?.brdf !== ibl.brdf || environment?.sampler !== ibl.sampler) {
          bindGroup = void 0;
          historyGroups.length = 0;
        }
        const kernelEntries = kernel?.bindings(historyBinding) ?? [];
        const nextResources = kernelEntries.slice(1).map((entry) => entry.resource);
        if (nextResources.some((v, i) => v !== kernelResources[i])) {
          bindGroup = void 0;
          historyGroups.length = 0;
          kernelResources = nextResources;
        }
        if (accumulation) bindGroup = historyGroups[accumulation.current];
        if (!bindGroup) {
          bindGroup = device.createBindGroup({ layout, entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            ...geometry.map((buffer, i) => ({ binding: i + 1, resource: { buffer } })),
            { binding: 9, resource: fallback[0] },
            { binding: 10, resource: fallback[1] },
            { binding: 11, resource: imageSampler },
            { binding: 12, resource: ibl.prefiltered },
            { binding: 13, resource: ibl.irradiance },
            { binding: 14, resource: ibl.brdf },
            { binding: 15, resource: ibl.sampler },
            ...borrowed.flatMap((item, i) => [{ binding: 16 + i * 2, resource: item.textureView }, { binding: 17 + i * 2, resource: item.sampler }]),
            ...accumulation ? [{ binding: historyBinding, resource: accumulation.history }] : [],
            ...kernelEntries,
            ...compute && accumulation ? [{ binding: historyBinding + 1, resource: accumulation.output }, { binding: historyBinding + 2, resource: accumulation.depth }] : []
          ] });
          if (accumulation) historyGroups[accumulation.current] = bindGroup;
        }
        environment = ibl;
        const basis = camera.basis(frame.width / frame.height), origin = data.origin ?? [0, 0, 0], angle = settings.lightAngle * Math.PI / 180;
        uniforms[3] = data.instances?.transformOffset ?? 0;
        uniforms.set(basis.eye.map((value, axis) => value - origin[axis]), 0);
        uniforms.set([...basis.forward, basis.tanHalfFov], 4);
        uniforms.set(basis.right, 8);
        uniforms.set(basis.up, 12);
        const lightFrame = rayLightingFrame(lighting, angle, origin, frame.view.viewer?.scene?.coordinateSystem);
        uniforms.set([...lightFrame.position, lighting.scale], 16);
        uniforms.set([frame.width, frame.height, data.nodeCount, data.instances?.instanceCount ?? 0], 20);
        uniforms.set([settings.pbr !== false ? 1 : 0, settings.textures !== false ? 1 : 0, settings.shadows ? 1 : 0, settings.transparency ? 1 : 0], 24);
        uniforms.set([settings.smoothShading ? 1 : 0, Math.max(0, Math.min(3, Math.trunc(settings.bounces))), settings.antialiasing === "4x" ? 1 : 0, data.instances?.tlasOffset ?? 0], 28);
        uniforms.set([frame.view.lights.ibl.applied && frame.view.lights.ibl.possible ? 1 : 0, ibl.intensity, ibl.maxSpecularMipLevel, data.materialMapOffset ?? 0], 32);
        const projection = frame.view.camera.perspectiveProjection;
        uniforms.set([projection.near, projection.far, frame.output.logDepthCoefficient, data.instances?.tlasNodeCount ?? 0], 36);
        uniforms.set(frame.view.camera.projMatrix, 40);
        uniforms.set(lightFrame.up, 56);
        uniforms.set(lightFrame.skyLight, 60);
        if (currentStep) uniforms.set([currentStep.count, currentStep.jitter[0], currentStep.jitter[1], 0], 64);
        kernel?.writeUniforms(uniforms, frame, data);
        device.queue.writeBuffer(uniformBuffer, 0, uniforms);
        if (computePass) {
          computePass.setPipeline(pipeline);
          computePass.setBindGroup(0, bindGroup);
          computePass.dispatchWorkgroups(Math.ceil(frame.width / 8), Math.ceil(frame.height / 8));
        } else {
          frame.pass.setPipeline(pipeline);
          frame.pass.setBindGroup(0, bindGroup);
          if (tileRect) {
            if (!frame.pass.setScissorRect || !frame.pass.setViewport) throw new Error("Tiled path tracing requires WebGPU viewport/scissor support.");
            try {
              frame.pass.setViewport(...tileRect, 0, 1);
              frame.pass.setScissorRect(...tileRect);
              frame.pass.draw(3);
            } finally {
              frame.pass.setViewport(0, 0, frame.width, frame.height, 0, 1);
              frame.pass.setScissorRect(0, 0, frame.width, frame.height);
            }
          } else drawTraceTiles(frame.pass, frame.width, frame.height);
        }
        if (!tileRect) frames++;
      },
      dispose
    };
    return api;
  } catch (error) {
    if (scopesOpen) await closeScopes();
    dispose();
    throw error;
  }
}

export {
  createShaderSource,
  acquirePipeline,
  createSharedRenderer
};
