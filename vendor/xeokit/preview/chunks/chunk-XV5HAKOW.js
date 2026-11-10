import {
  CompilationCache,
  FallbackImages,
  MATERIAL_TEXTURE_SIZE,
  ProgressiveState,
  ResourceLeases,
  TRACING_DOMAINS_GLSL,
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
  streamUploads,
  uploadTextureRange
} from "./chunk-YHRG2W5D.js";

// ../sdk-oct2/src/viewing/techniques/rayTracing/webGL/materialShaders.ts
var materialShaders = `
vec3 srgbToLinear(vec3 c) {
  return mix(c/12.92,pow((c+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),c));
}
int mapBinding(int mesh, int slot) {
  return slot < 4 ? int(readData(uPBR,mesh*6+2)[slot]) : int(readData(uPBR,mesh*6+3).x);
}
vec2 wrapUV(vec2 uv, vec2 modes) {
  vec2 result = uv;
  for (int axis = 0; axis < 2; axis++) {
    if (modes[axis] > 1.5) result[axis] = 1.0-abs(mod(uv[axis],2.0)-1.0);
    else if (modes[axis] > 0.5) result[axis] = clamp(uv[axis],0.0,1.0);
  }
  return result;
}
vec4 sampleImage(int binding, vec2 uv, float footprint, bool colorMap) {
  vec4 meta = readData(uBindings,binding*3);
  vec4 flags = readData(uBindings,binding*3+2);
  vec2 size = vec2(textureSize(uImages,0).xy);
  float lod = flags.w > 0.5 ? max(0.0,log2(max(footprint*max(size.x,size.y),1.0))) : 0.0;
  lod = min(lod,floor(log2(max(size.x,size.y))));
  uv = wrapUV(uv,meta.yz);
  // REPEAT is native to the array; clamp/mirror stop at edge texel centers.
  vec2 halfTexel = 0.5/vec2(textureSize(uImages,int(ceil(lod))).xy);
  if (meta.y > 0.5) uv.x = clamp(uv.x,halfTexel.x,1.0-halfTexel.x);
  if (meta.z > 0.5) uv.y = clamp(uv.y,halfTexel.y,1.0-halfTexel.y);
  if (meta.w > 0.5) {
    ivec2 dimensions = textureSize(uImages,int(floor(lod))).xy;
    ivec3 texel = ivec3(ivec2(floor(fract(uv)*vec2(dimensions))),int(meta.x));
    return colorMap ? texelFetch(uColorImages,texel,int(floor(lod))) : texelFetch(uImages,texel,int(floor(lod)));
  }
  return colorMap ? textureLod(uColorImages,vec3(uv,meta.x),lod) : textureLod(uImages,vec3(uv,meta.x),lod);
}
vec2 transformedUV(int binding, vec2 uv) {
  vec4 m = readData(uBindings,binding*3+1), o = readData(uBindings,binding*3+2);
  uv = mat2(m.xy,m.zw)*uv+o.xy;
  if (o.z > 0.5) uv.y = 1.0-uv.y;
  return uv;
}
bool triangleUV(Hit hit, int slot, out vec2 a, out vec2 b, out vec2 c) {
  if (hit.texcoords < 0) return false;
  int address=hit.texcoords+slot*2;
  if(hit.instance>=0){address=int(readData(uUVs,hit.texcoords+slot/4)[slot%4]);if(address<0)return false;}
  vec4 ab = readData(uUVs,address), last = readData(uUVs,address+1);
  a = ab.xy; b = ab.zw; c = last.xy;
  return last.z > 0.5;
}
float pixelFootprint(Hit hit) { return max(1e-6,2.0*uTanHalfFov*hit.t/uResolution.y); }
vec4 sampleMap(Hit hit, int slot, vec3 p, vec3 g) {
  int binding = mapBinding(hit.mesh,slot);
  if (!uTextures || binding < 0) return vec4(1);
  bool colorMap = slot == 0 || slot == 3;
  vec2 a, b, c;
  if (triangleUV(hit,slot,a,b,c)) {
    vec3 ab = instanceVector(hit.instance,readData(uTriangles,hit.triangle+1).xyz), ac = instanceVector(hit.instance,readData(uTriangles,hit.triangle+2).xyz);
    float density = max(length(b-a)/max(length(ab),1e-6),length(c-a)/max(length(ac),1e-6));
    float footprint = pixelFootprint(hit)*density/max(abs(dot(g,normalize(p-uEye))),0.1);
    return sampleImage(binding,a*(1.0-hit.uv.x-hit.uv.y)+b*hit.uv.x+c*hit.uv.y,footprint,colorMap);
  }
  float scale = max(readData(uPBR,hit.mesh*6+3).y,0.0001);
  vec3 w = pow(abs(g),vec3(4)); w /= max(w.x+w.y+w.z,1e-6);
  vec3 q = p/scale;
  vec4 transform = readData(uBindings,binding*3+1);
  float footprint = pixelFootprint(hit)/scale*max(length(transform.xy),length(transform.zw));
  return sampleImage(binding,transformedUV(binding,vec2(g.x < 0.0 ? -q.z : q.z,q.y)),footprint,colorMap)*w.x+
    sampleImage(binding,transformedUV(binding,vec2(q.x,g.y < 0.0 ? -q.z : q.z)),footprint,colorMap)*w.y+
    sampleImage(binding,transformedUV(binding,vec2(g.z < 0.0 ? -q.x : q.x,q.y)),footprint,colorMap)*w.z;
}
float surfaceOpacity(Hit hit, vec3 p) {
  if (!uTransparency) return 1.0;
  float opacity = readData(uMaterials,hit.mesh*2+1).y;
  float mode = readData(uPBR,hit.mesh*6).w;
  if (mode > 0.5) opacity *= sampleMap(hit,0,p,hit.geometricNormal).a;
  if (mode > 0.5 && mode < 1.5) return opacity < readData(uPBR,hit.mesh*6+1).w ? 0.0 : 1.0;
  return opacity;
}
vec3 mappedNormal(Hit hit, vec3 p, vec3 n, vec3 rd) {
  int binding = mapBinding(hit.mesh,2);
  if (!uTextures || binding < 0) return n;
  vec2 a, b, c;
  vec3 mapped;
  if (triangleUV(hit,2,a,b,c)) {
    vec2 du = b-a, dv = c-a;
    float determinant = du.x*dv.y-du.y*dv.x;
    if (abs(determinant) < 1e-8) return n;
    vec3 ab = instanceVector(hit.instance,readData(uTriangles,hit.triangle+1).xyz), ac = instanceVector(hit.instance,readData(uTriangles,hit.triangle+2).xyz);
    vec3 t = (ab*dv.y-ac*du.y)/determinant, bitangent = (ac*du.x-ab*dv.x)/determinant;
    t -= n*dot(n,t);
    if (dot(t,t) < 1e-12) return n;
    t = normalize(t);
    vec3 bAxis = normalize(cross(n,t));
    if (dot(bAxis,bitangent) < 0.0) bAxis = -bAxis;
    mapped = mat3(t,bAxis,n)*(sampleMap(hit,2,p,hit.geometricNormal).xyz*2.0-1.0);
  } else {
    // Blend each projection's tangent-space perturbation in world space.
    vec3 g = hit.geometricNormal, q = p/max(readData(uPBR,hit.mesh*6+3).y,0.0001);
    vec3 w = pow(abs(g),vec3(4)); w /= max(w.x+w.y+w.z,1e-6);
    float sx = g.x < 0.0 ? -1.0 : 1.0, sy = g.y < 0.0 ? -1.0 : 1.0, sz = g.z < 0.0 ? -1.0 : 1.0;
    float footprint = pixelFootprint(hit)/max(readData(uPBR,hit.mesh*6+3).y,0.0001);
    vec3 nx = sampleImage(binding,transformedUV(binding,vec2(sx*q.z,q.y)),footprint,false).xyz*2.0-1.0;
    vec3 ny = sampleImage(binding,transformedUV(binding,vec2(q.x,sy*q.z)),footprint,false).xyz*2.0-1.0;
    vec3 nz = sampleImage(binding,transformedUV(binding,vec2(sz*q.x,q.y)),footprint,false).xyz*2.0-1.0;
    // Rotate/flip map tangents along with per-binding UV transforms.
    vec4 m = readData(uBindings,binding*3+1), o = readData(uBindings,binding*3+2);
    if (dot(m.xz,m.xz) < 1e-12 || dot(m.yw,m.yw) < 1e-12) return n;
    vec2 tu = normalize(vec2(m.x,m.z)), tv = normalize(vec2(m.y,m.w));
    if (o.z > 0.5) tv = -tv;
    nx.xy = tu*nx.x+tv*nx.y; ny.xy = tu*ny.x+tv*ny.y; nz.xy = tu*nz.x+tv*nz.y;
    mapped = n+vec3(0.0,nx.y,sx*nx.x)*w.x+vec3(ny.x,0.0,sy*ny.y)*w.y+vec3(sz*nz.x,nz.y,0.0)*w.z;
  }
  if (dot(mapped,mapped) < 1e-10) return n;
  mapped = normalize(mapped);
  return dot(mapped,hit.geometricNormal) > 0.0 && dot(mapped,-rd) > 0.0 ? mapped : n;
}
struct Material { vec3 albedo; float metallic; float roughness; vec3 f0; vec3 emission; float ao; float transmission; vec3 transmissionTint; };
Material surfaceMaterial(Hit hit, vec3 p) {
  vec4 color = readData(uMaterials,hit.mesh*2), factors = readData(uPBR,hit.mesh*6);
  vec3 albedo = color.rgb*sampleMap(hit,0,p,hit.geometricNormal).rgb;
  if (readData(uMaterials,hit.mesh*2+1).x > 0.5) {
    float checker = mod(floor(p.x)+floor(p.z),2.0);
    checker = mix(checker,0.5,smoothstep(15.0,45.0,length(p.xz-uEye.xz)));
    albedo *= mix(0.55,1.0,checker);
  }
  vec4 mr = sampleMap(hit,1,p,hit.geometricNormal);
  float metallic = clamp(factors.x*mr.b,0.0,1.0), roughness = clamp(factors.y*mr.g,0.045,1.0);
  float dielectric = pow((factors.z-1.0)/(factors.z+1.0),2.0);
  vec3 emission = readData(uPBR,hit.mesh*6+1).rgb*sampleMap(hit,3,p,hit.geometricNormal).rgb;
  vec4 optical = readData(uPBR,hit.mesh*6+4);
  // Alpha coverage and optical transmission are independent. An OPAQUE-alpha
  // dielectric can transmit all non-reflected light (as in the chessboard XGF).
  float transmission = uTransparency ? optical.x : 0.0;
  vec3 attenuation = readData(uPBR,hit.mesh*6+5).rgb;
  vec3 absorption = pow(max(attenuation,vec3(1e-6)),vec3(optical.y*optical.z));
  return Material(albedo,metallic,roughness,mix(vec3(dielectric),albedo,metallic),emission,
    sampleMap(hit,4,p,hit.geometricNormal).r,transmission,albedo*absorption);
}
vec3 fresnel(vec3 f0, float cosine) { return f0+(1.0-f0)*pow(1.0-clamp(cosine,0.0,1.0),5.0); }
vec3 surfaceTransmission(Material m, float opacity, float cosine) {
  return vec3(1.0-opacity)+opacity*m.transmission*(1.0-m.metallic)*m.transmissionTint*(1.0-fresnel(m.f0,cosine));
}
`;
var pbrLighting = `
const float PI = 3.14159265359;
float ggx(float nh, float roughness) {
  float a2 = pow(roughness,4.0), d = nh*nh*(a2-1.0)+1.0;
  return a2/max(PI*d*d,1e-8);
}
float smith(float cosine, float roughness) {
  float a2 = pow(roughness,4.0);
  return 2.0*cosine/max(cosine+sqrt(a2+(1.0-a2)*cosine*cosine),1e-6);
}
vec3 roughSky(vec3 direction, float roughness) {
  if (uIBL) return textureLod(uEnvironment,direction,roughness*uEnvironmentMaxLod).rgb*uIBLIntensity;
  // A deterministic low-cost approximation to convolving the procedural sky.
  vec3 t = normalize(cross(direction,abs(direction.y) < 0.95 ? vec3(0,1,0) : vec3(1,0,0)));
  vec3 b = cross(direction,t);
  float spread = roughness*roughness*1.5;
  return (sky(direction)*2.0+sky(normalize(direction+t*spread))+sky(normalize(direction-t*spread))+
    sky(normalize(direction+b*spread))+sky(normalize(direction-b*spread)))/6.0;
}
vec3 environmentSpecular(Material m, float nv) {
  vec2 brdf = uIBL ? texture(uBRDF,vec2(nv,m.roughness)).rg : vec2(1.0,0.0);
  return m.ao*(uIBL ? m.f0*brdf.x+brdf.y : fresnel(m.f0,nv));
}
vec3 pbrLight(vec3 p, vec3 n, vec3 g, vec3 rd, Material m, float tracedShare, vec3 specularFactor, vec3 visibility) {
  float nv = max(dot(n,-rd),0.0001);
  vec3 f = fresnel(m.f0,nv);
  vec3 lighting = m.emission + m.ao*((1.0-f)*(1.0-m.metallic)*(1.0-m.transmission)*m.albedo*ambient(n))+
    specularFactor*(1.0-tracedShare)*roughSky(reflect(rd,n),m.roughness);
  // One centered point light casts one shadow per occluder.
  vec3 delta = uLight-p;
  float distanceToLight = length(delta);
  vec3 l = delta/distanceToLight;
  float nl = max(dot(n,l),0.0);
  if (nl <= 0.0 || dot(g,l) <= 0.0) return lighting;
  if (max(visibility.x,max(visibility.y,visibility.z)) <= 0.0) return lighting;
  vec3 h = normalize(l-rd);
  vec3 F = fresnel(m.f0,max(dot(h,-rd),0.0));
  vec3 specular = ggx(max(dot(n,h),0.0),m.roughness)*smith(nv,m.roughness)*smith(nl,m.roughness)*F/max(4.0*nl*nv,1e-6);
  vec3 diffuse = (1.0-F)*(1.0-m.metallic)*(1.0-m.transmission)*m.albedo/PI;
  lighting += (diffuse+specular)*nl*visibility*vec3(1.0,0.90,0.76)*
    (75.0*uLightScale*uLightScale/(distanceToLight*distanceToLight));
  return lighting;
}
`;

// ../sdk-oct2/src/viewing/techniques/rayTracing/webGL/shaders.ts
var vertexShader = `#version 300 es
// A single covering triangle. All model visibility is resolved by rays below.
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
var fragmentShader = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp samplerCube;
uniform sampler2D uTriangles;
uniform sampler2D uMaterials;
uniform sampler2D uNodes;
uniform sampler2D uNormals, uPBR, uUVs, uBindings;
uniform highp sampler2DArray uImages, uColorImages;
uniform bool uPbr, uTextures;
uniform samplerCube uEnvironment, uIrradiance;
uniform sampler2D uBRDF;
uniform bool uIBL;
uniform float uIBLIntensity, uEnvironmentMaxLod;
uniform int uNodeCount;
uniform int uInstanceCount, uTransformOffset, uMaterialMapOffset, uTLASOffset, uTLASCount;
uniform vec2 uResolution;
uniform vec3 uEye, uForward, uRight, uUp, uLight, uWorldUp, uSkyLight;
uniform float uTanHalfFov;
uniform float uLightScale;
uniform int uBounces;
uniform int uAntialiasing, uToneMapping;
uniform float uExposure;
uniform bool uLinearHDR, uSRGBEncode;
uniform float uLogDepthCoefficient;
uniform mat4 uProjection;
uniform vec2 uClipRange;
uniform bool uShadows;
uniform bool uTransparency;
uniform bool uSmoothShading;
out vec4 outColor;
const float EPS = 0.0003;
const float FAR = 1000.0;
struct Hit { float t; vec3 geometricNormal; vec2 uv; int normals; int mesh; int triangle; int texcoords; int instance; };

vec4 readData(sampler2D data, int address) {
  int width = textureSize(data,0).x;
  return texelFetch(data,ivec2(address % width,address / width),0);
}
${TRACING_DOMAINS_GLSL}


vec4 instanceData(int instance, int row) {
  return readData(uMaterials,uTransformOffset+instance*7+row);
}
vec3 instanceNormal(int instance, vec3 n) {
  if (instance < 0) return n;
  return instanceData(instance,0).xyz*n.x+instanceData(instance,1).xyz*n.y+instanceData(instance,2).xyz*n.z;
}
vec3 instanceVector(int instance, vec3 v) {
  if (instance < 0) return v;
  return vec3(dot(instanceData(instance,3).xyz,v),dot(instanceData(instance,4).xyz,v),dot(instanceData(instance,5).xyz,v));
}

${materialShaders}

bool boundsHit(vec3 ro, vec3 invRay, vec3 lo, vec3 hi, float limit) {
  vec3 a = (lo-ro)*invRay, b = (hi-ro)*invRay;
  vec3 nearT = min(a,b), farT = max(a,b);
  return max(0.0,max(nearT.x,max(nearT.y,nearT.z))) <=
    min(limit,min(farT.x,min(farT.y,farT.z)));
}

// Double-sided Moller-Trumbore intersections with a stackless BVH. Each miss
// jumps over a whole subtree; leaves contain at most sixteen actual triangles.
bool clipBoxContains(int mesh, vec3 position) {
  int address = int(readData(uMaterials,mesh*2+1).z);
  if (address <= 0) return true;
  vec4 point = vec4(position,1.0);
  vec3 boxPos = vec3(dot(readData(uMaterials,address),point),dot(readData(uMaterials,address+1),point),dot(readData(uMaterials,address+2),point));
  return all(lessThanEqual(abs(boxPos),vec3(1.0)));
}
Hit traceBLAS(vec3 ro, vec3 rd, float limit, bool anyHit, float minT, int start, int end, int instance) {
  Hit hit = Hit(limit,vec3(0),vec2(0),-1,-1,-1,-1,instance);
  // A finite reciprocal also handles exactly parallel rays without 0*infinity.
  vec3 invRay = 1.0 / mix(rd,vec3(1e-20),lessThan(abs(rd),vec3(1e-20)));
  int node = start;
  int visited = 0;
  while (node >= 0 && node < end && visited++ < end-start) {
    vec4 lo = readData(uNodes,node*3), hi = readData(uNodes,node*3+1);
    if (!boundsHit(ro,invRay,lo.xyz,hi.xyz,hit.t)) { node = int(lo.w); continue; }
    int first = int(hi.w);
    if (first < 0) { node++; continue; }
    int count = int(readData(uNodes,node*3+2).x);
    for (int j = 0; j < 16; j++) {
      if (j >= count) break;
      int address = (first+j)*3;
      vec4 vertex = readData(uTriangles,address);
      vec4 edge = readData(uTriangles,address+1);
      vec4 edgeC=readData(uTriangles,address+2);
      vec3 a = vertex.xyz, ab = edge.xyz, ac = edgeC.xyz;
      vec3 p = cross(rd,ac);
      float det = dot(ab,p);
      if (abs(det) < (instance<0 ? 1e-10 : 1e-10*length(ab)*length(ac)*length(rd))) continue;
      vec3 s = ro-a;
      float u = dot(s,p)/det;
      if (u < 0.0 || u > 1.0) continue;
      vec3 q = cross(s,ab);
      float v = dot(rd,q)/det;
      if (v < 0.0 || u+v > 1.0) continue;
      float t = dot(ac,q)/det;
      if (t <= minT || t >= hit.t) continue;
      // Alpha zero is invisible even to reflections and shadow rays, and does
      // not consume the transparent-layer budget.
      int mesh = instance < 0 ? int(vertex.w) : instance;
      if(instance>=0)mesh=int(readData(uMaterials,uMaterialMapOffset+mesh/4)[mesh%4]);
      vec4 materialInfo=readData(uMaterials,mesh*2+1);
      if (uTransparency && materialInfo.y <= 0.0) continue;
      if (lightingTraceDomain >= 0 && int(readData(uMaterials,mesh*2+1).w) != lightingTraceDomain) continue;
      if (!clipBoxContains(mesh, ro + rd*t)) continue;
      if (anyHit) return Hit(t,vec3(0),vec2(0),-1,mesh,address,-1,instance);
      vec3 n = normalize(cross(ab,ac));
      n = normalize(instanceNormal(instance,dot(n,rd) < 0.0 ? n : -n));
      Hit candidate = Hit(t,n,vec2(u,v),int(edge.w)-1,mesh,address,
        (int(edgeC.w)-1)*(instance<0?10:2),instance);
      hit = candidate;
    }
    node = int(lo.w);
  }
  return hit;
}

Hit trace(vec3 ro, vec3 rd, float limit, bool anyHit, float minT) {
  // Layout is selected at compilation; flat snapshots replace this routine.
  Hit hit = Hit(limit,vec3(0),vec2(0),-1,-1,-1,-1,-1);
  vec3 invRay = 1.0/mix(rd,vec3(1e-20),lessThan(abs(rd),vec3(1e-20)));
  int node=0;
  for (int visited=0;visited<uTLASCount && node<uTLASCount;visited++) {
    vec4 lo=readData(uMaterials,uTLASOffset+node*3), hi=readData(uMaterials,uTLASOffset+node*3+1);
    if (!boundsHit(ro,invRay,lo.xyz,hi.xyz,hit.t)) { node=int(lo.w); continue; }
    int instance=int(hi.w);
    if (instance<0) { node++; continue; }
    vec4 x=instanceData(instance,0),y=instanceData(instance,1),z=instanceData(instance,2),range=instanceData(instance,6);
    vec3 localOrigin=vec3(dot(x,vec4(ro,1)),dot(y,vec4(ro,1)),dot(z,vec4(ro,1)));
    // Do not normalize: local and world intersections must have identical t.
    vec3 localDirection=vec3(dot(x.xyz,rd),dot(y.xyz,rd),dot(z.xyz,rd));
    Hit candidate=traceBLAS(localOrigin,localDirection,hit.t,anyHit,minT,int(range.x),int(range.y),instance);
    if (candidate.mesh>=0) { hit=candidate; if(anyHit)return hit; }
    node=int(lo.w);
  }
  return hit;
}

vec3 decodeOct(vec2 p) {
  if(p.x>1.5)return vec3(0);
  vec3 n=vec3(p,1.0-abs(p.x)-abs(p.y));
  if(n.z<0.0)n.xy=(1.0-abs(n.yx))*mix(vec2(1),vec2(-1),lessThan(n.xy,vec2(0)));
  return normalize(n);
}
// Only shading rays fetch normals; shadow intersections need geometry/opacity.
vec3 shadingNormal(Hit hit, vec3 rd) {
  vec3 g = hit.geometricNormal;
  if (!uSmoothShading || hit.normals < 0) return g;
  vec3 n=vec3(0);
  if(hit.instance<0)n = readData(uNormals,hit.normals).xyz*(1.0-hit.uv.x-hit.uv.y)+
    readData(uNormals,hit.normals+1).xyz*hit.uv.x+readData(uNormals,hit.normals+2).xyz*hit.uv.y;
  if(hit.instance>=0){
    vec4 a=readData(uNormals,hit.normals),b=readData(uNormals,hit.normals+1);
    n=decodeOct(a.xy)*(1.0-hit.uv.x-hit.uv.y)+decodeOct(a.zw)*hit.uv.x+decodeOct(b.xy)*hit.uv.y;
  }
  n = instanceNormal(hit.instance,n);
  if (dot(n,n) < 1e-10) return g;
  n = normalize(n);
  // Match the intersected side, including mirrored instances and back faces.
  if (dot(n,g) < 0.0) n = -n;
  return dot(n,-rd) > 0.0 ? n : g;
}

vec3 domainVisibility(vec3 p,vec3 n,vec3 l,float distance) {
  if(!uShadows || dot(n,l)<=0.0)return vec3(1);
  vec3 ro=p+n*EPS*4.0;float minT=EPS;vec3 result=vec3(1);
  for(int i=0;i<32;i++){
    Hit hit=trace(ro,l,distance-EPS,false,minT);if(hit.mesh<0)return result;
    float opacity=surfaceOpacity(hit,ro+l*hit.t);
    if(opacity>0.0)result*=surfaceTransmission(surfaceMaterial(hit,ro+l*hit.t),opacity,dot(hit.geometricNormal,-l));
    if(max(result.x,max(result.y,result.z))<.001)return vec3(0);
    minT=hit.t+EPS;
  }
  return vec3(0);
}
vec3 ambient(vec3 n) {
  return uIBL ? textureLod(uIrradiance,n,0.0).rgb*uIBLIntensity : vec3(0.16+0.09*max(0.0,dot(n,uWorldUp)));
}
vec3 sky(vec3 d) {
  if (uIBL) return textureLod(uEnvironment,d,0.0).rgb*uIBLIntensity;
  vec3 color = mix(vec3(0.48,0.58,0.61),vec3(0.09,0.19,0.25),smoothstep(-0.2,0.9,dot(d,uWorldUp)));
  float panel = pow(max(0.0,dot(d,uSkyLight)),40.0);
  return color + vec3(1.0,0.9,0.72)*panel*1.5;
}

// A shadow ray accumulates transmittance in depth order, stopping at the
// light. Two 50%-opaque surfaces pass 25% of the incident light.
vec3 shadowVisibility(vec3 ro, vec3 rd, float limit) {
  if (!uTransparency) return trace(ro,rd,limit,true,EPS).mesh < 0 ? vec3(1) : vec3(0);
  vec3 visibility = vec3(1);
  float minT = EPS;
  for (int layer = 0; layer < 16; layer++) {
    Hit hit = trace(ro,rd,limit,false,minT);
    if (hit.mesh < 0) return visibility;
    vec3 p = ro+rd*hit.t;
    float opacity = surfaceOpacity(hit,p);
    if (opacity > 0.0) visibility *= readData(uPBR,hit.mesh*6+4).x > 0.0
      ? surfaceTransmission(surfaceMaterial(hit,p),opacity,dot(hit.geometricNormal,-rd)) : vec3(1.0-opacity);
    if (max(visibility.x,max(visibility.y,visibility.z)) < 0.002) return vec3(0);
    minT = hit.t+EPS;
  }
  // Conservatively block unresolved layers instead of leaking light through
  // an opaque surface beyond the work limit.
  return vec3(0);
}

${pbrLighting}

vec3 surfaceLighting(vec3 p, vec3 n, vec3 g, vec3 rd, vec4 material, float checkerEnabled, vec3 visibility) {
  vec3 albedo = pow(material.rgb,vec3(2.2));
  if (checkerEnabled > 0.5) {
    float checker = mod(floor(p.x)+floor(p.z),2.0);
    checker = mix(checker,0.5,smoothstep(15.0,45.0,length(p.xz-uEye.xz)));
    albedo *= mix(0.55,1.0,checker);
  }
  vec3 lighting = albedo*ambient(n);
  // One centered point light casts one shadow per occluder.
  vec3 delta = uLight-p;
  float distanceToLight = length(delta);
  vec3 l = delta/distanceToLight;
  float diffuse = max(0.0,dot(n,l));
  if (diffuse <= 0.0 || dot(g,l) <= 0.0) return lighting;
  if (max(visibility.x,max(visibility.y,visibility.z)) <= 0.0) return lighting;
  vec3 halfway = normalize(l-rd);
  float specular = pow(max(0.0,dot(n,halfway)),72.0)*material.w;
  lighting += visibility*(albedo*diffuse+vec3(specular))*vec3(1.0,0.90,0.76)*
    (24.0*uLightScale*uLightScale/(distanceToLight*distanceToLight));
  return lighting;
}

struct Ray {
  vec3 origin;
  vec3 direction;
  vec3 weight;
  int bounces;
  int layers;
  float minT;
  float environmentRoughness;
  int domain;
};
float strength(vec3 weight) { return max(weight.x,max(weight.y,weight.z)); }

vec3 radiance(vec3 ro, vec3 rd) {
  vec3 color = vec3(0);
  Ray ray = Ray(ro,rd,vec3(1),0,0,uLinearHDR ? max(EPS,uClipRange.x/max(dot(rd,uForward),1e-6)) : EPS,0.0,0);
  // Follow reflections first, saving straight-through continuations. Every
  // push increases reflection depth, so three bounces need at most three slots.
  Ray pending[4];
  int pendingCount = 0;
  for (int step = 0; step < 128; step++) {
    if (strength(ray.weight) >= 0.002 && ray.layers < 16) {
      float limit = uLinearHDR && ray.bounces == 0 ? uClipRange.y/max(dot(ray.direction,uForward),1e-6) : FAR;
      Hit hit = trace(ray.origin,ray.direction,limit,false,ray.minT);
      if (hit.mesh < 0) {
        color += ray.weight*(ray.environmentRoughness > 0.0 ? roughSky(ray.direction,ray.environmentRoughness) : sky(ray.direction))*(ray.domain>0?domainRecord(ray.domain).z:1.0);
      } else {
        vec3 p = ray.origin+ray.direction*hit.t, g = hit.geometricNormal;
        vec3 n = shadingNormal(hit,ray.direction);
        vec4 material = readData(uMaterials,hit.mesh*2);
        vec4 properties = readData(uMaterials,hit.mesh*2+1);
        float opacity = surfaceOpacity(hit,p);
        if (opacity <= 0.0) { ray.minT = hit.t+EPS; continue; }
        Material pbr = surfaceMaterial(hit,p);
        n = mappedNormal(hit,p,n,ray.direction);
        float reflection = uBounces > 0 ? material.w+(1.0-material.w)*0.5*
          pow(1.0-max(0.0,dot(n,-ray.direction)),5.0) : 0.0;
        // Rough surfaces use more of the broad sky lobe and less of the sharp
        // geometry reflection. This remains a deterministic Whitted tracer.
        float tracedShare = uBounces > 0 ? pow(1.0-pbr.roughness,2.0) : 0.0;
        // Split one IBL BRDF weight between the filtered environment and
        // traced geometry; enabling bounces must not add specular energy.
        vec3 specularFactor = uPbr ? environmentSpecular(pbr,max(dot(n,-ray.direction),0.0001)) : vec3(0);
        vec3 reflectionWeight = uPbr ? specularFactor*tracedShare : vec3(reflection);
        // Retain the glass Fresnel reflection even in the simple shading mode.
        if (!uPbr && pbr.transmission*(1.0-pbr.metallic) > 0.0) reflectionWeight = mix(reflectionWeight,
          fresnel(pbr.f0,max(dot(n,-ray.direction),0.0)),pbr.transmission*(1.0-pbr.metallic));
        // Both lighting modes use the same shadow. Keep its traversal and
        // material sampling outside the branch so drivers only compile one copy.
        vec3 lightDelta = uLight-p;
        float lightDistance = length(lightDelta);
        vec3 lightDirection = lightDelta/lightDistance;
        vec3 visibility = vec3(1);
        lightingTraceDomain=int(properties.w);
        if (uShadows && dot(n,lightDirection) > 0.0 && dot(g,lightDirection) > 0.0 && properties.w==0.0) {
          visibility = shadowVisibility(p+g*EPS*4.0,lightDirection,lightDistance-EPS);
        }
        if(properties.w>0.0) {
          vec3 env=ambient(n)*pbr.albedo*(1.0-pbr.metallic)*(1.0-pbr.transmission)+specularFactor*(1.0-tracedShare)*roughSky(reflect(ray.direction,n),pbr.roughness);
          color+=ray.weight*opacity*shadeLightingDomain(int(properties.w)/2,p,n,-ray.direction,pbr.albedo,pbr.roughness,pbr.metallic,readData(uPBR,hit.mesh*6).z,vec4(0),uPbr,pbr.transmission*(1.0-pbr.metallic),pbr.ao,pbr.emission,env);
        }
        else if (uPbr) color += ray.weight*opacity*pbrLight(p,n,g,ray.direction,pbr,tracedShare,specularFactor,visibility);
        else {
          material.rgb *= pow(sampleMap(hit,0,p,g).rgb,vec3(1.0/2.2));
          color += ray.weight*opacity*(1.0-pbr.transmission*(1.0-pbr.metallic))*(1.0-reflection)*surfaceLighting(p,n,g,ray.direction,material,properties.x,visibility);
        }
        lightingTraceDomain=-1;
        vec3 reflected = ray.weight*opacity*reflectionWeight;
        vec3 transmitted = ray.weight*surfaceTransmission(pbr,opacity,max(dot(n,-ray.direction),0.0));
        vec3 reflectedDirection = reflect(ray.direction,n);
        // Interpolated normals must not send reflections through the triangle.
        if (dot(reflectedDirection,g) <= 0.0) reflectedDirection = reflect(ray.direction,g);
        // Retain the originating lobe when a reflected ray escapes to the
        // environment, including through transparent continuations.
        float environmentRoughness = uPbr ? max(ray.environmentRoughness,pbr.roughness) : 0.0;
        bool reflectMore = strength(reflected) >= 0.002;
        bool transmitMore = strength(transmitted) >= 0.002;
        if (ray.bounces >= uBounces) {
          color += reflected*(uPbr ? roughSky(reflectedDirection,environmentRoughness) : sky(reflectedDirection))*(properties.w>0.0?domainRecord(int(properties.w)).z:1.0);
          reflectMore = false;
        }
        if (reflectMore) {
          if (transmitMore) {
            pending[pendingCount++] = Ray(ray.origin,ray.direction,transmitted,ray.bounces,ray.layers+1,hit.t+EPS,ray.environmentRoughness,ray.domain);
          }
          ray = Ray(p+g*EPS*4.0,reflectedDirection,reflected,ray.bounces+1,0,EPS,environmentRoughness,int(properties.w));
          continue;
        }
        if (transmitMore) {
          ray.weight = transmitted; ray.minT = hit.t+EPS; ray.layers++;
          continue;
        }
      }
    }
    if (pendingCount == 0) break;
    ray = pending[--pendingCount];
  }
  return color;
}

vec3 cameraSample(vec2 pixel) {
  vec2 p = (2.0*pixel-uResolution)/uResolution.y;
  vec3 ray = normalize(uForward+(p.x*uRight+p.y*uUp)*uTanHalfFov);
  return radiance(uEye,ray);
}

// A single center ray supplies depth, independent of color supersampling.
// Use the first nonzero-opacity surface, including glass. Fully transparent
// texels are skipped; reflections and surfaces behind glass do not replace it.
float cameraDepth() {
  vec2 pixel = (2.0*gl_FragCoord.xy-uResolution)/uResolution.y;
  vec3 direction = normalize(uForward+(pixel.x*uRight+pixel.y*uUp)*uTanHalfFov);
  float forwardDistance = max(dot(direction,uForward),1e-6);
  float minT = max(EPS,uClipRange.x/forwardDistance);
  float maxT = uClipRange.y/forwardDistance;
  for (int layer = 0; layer < 128; layer++) {
    Hit hit = trace(uEye,direction,maxT,false,minT);
    if (hit.mesh < 0) return 1.0;
    if (surfaceOpacity(hit,uEye+direction*hit.t) > 0.0) {
      float viewDepth = hit.t*forwardDistance;
      if (uLogDepthCoefficient > 0.0) return clamp(log2(1.0+viewDepth)*uLogDepthCoefficient*0.5,0.0,1.0);
      vec4 clip = uProjection*vec4(0,0,-viewDepth,1);
      return clamp(clip.z/clip.w*0.5+0.5,0.0,1.0);
    }
    minT = hit.t+EPS;
  }
  return 1.0;
}

void main() {
  vec3 color = vec3(0);
  int samples = uAntialiasing == 1 ? 4 : 1;
  for (int sampleIndex = 0; sampleIndex < samples; sampleIndex++) {
    // Average four pixel quadrants in linear HDR, before display transforms.
    vec2 offset = samples == 1 ? vec2(0) : vec2(float(sampleIndex & 1),float(sampleIndex >> 1))*0.5-0.25;
    color += cameraSample(gl_FragCoord.xy+offset);
  }
  color = max(color/float(samples),vec3(0.0));
  gl_FragDepth = uLinearHDR ? cameraDepth() : 1.0;
  if (uLinearHDR) {
    // The host owns exposure, bloom, depth effects and final display conversion.
    outColor = vec4(color,1.0);
    return;
  }
  color *= uExposure;
  if (uToneMapping == 1) {
    color = color/(color+vec3(1.0));
  } else if (uToneMapping == 2) {
    // ACES filmic approximation, matching the SDK raster tone-map curve.
    color = clamp((color*(2.51*color+0.03))/(color*(2.43*color+0.59)+0.14),0.0,1.0);
  }
  // This technique writes to the canvas: encode exactly once.
  outColor = vec4(uSRGBEncode ? pow(color,vec3(1.0/2.2)) : color,1.0);
}`;
function sharedFragmentShader(atlasCount, hasFallbackImages = true, instanced = false, progressive = false, opaque = false) {
  let shader = fragmentShader.replace("uniform sampler2D uTriangles;", "uniform highp sampler2D uTriangles, uAtlasBindings;");
  if (!instanced) {
    shader = shader.replace(/Hit trace\(vec3 ro,[\s\S]*?vec3 decodeOct/, "Hit trace(vec3 ro, vec3 rd, float limit, bool anyHit, float minT) { return traceBLAS(ro,rd,limit,anyHit,minT,0,uNodeCount,-1); }\nvec3 decodeOct");
    shader = shader.replace(/vec3 instanceNormal\([\s\S]*?\n}/, "vec3 instanceNormal(int instance, vec3 n) { return n; }");
    shader = shader.replace(/vec3 instanceVector\([\s\S]*?\n}/, "vec3 instanceVector(int instance, vec3 v) { return v; }");
  }
  if (opaque) {
    shader = shader.replace("      if (lightingTraceDomain >= 0 && int(readData(uMaterials,mesh*2+1).w) != lightingTraceDomain) continue;", "");
    shader = shader.replace("if (anyHit) return Hit(t,vec3(0),vec2(0),-1,mesh,address,-1,instance);", "if (anyHit) return Hit(t,vec3(0),vec2(0),-1,0,address,-1,instance);");
    shader = shader.replace("      vec4 materialInfo=readData(uMaterials,mesh*2+1);\n      if (uTransparency && materialInfo.y <= 0.0) continue;", "");
    shader = shader.replace(/vec3 shadowVisibility\([\s\S]*?\n}/, "vec3 shadowVisibility(vec3 ro, vec3 rd, float limit) { return trace(ro,rd,limit,true,EPS).mesh<0 ? vec3(1) : vec3(0); }");
    shader = shader.replace(/float surfaceOpacity\([\s\S]*?\n}/, "float surfaceOpacity(Hit hit, vec3 p) { return 1.0; }");
  }
  if (progressive) {
    shader = shader.replace("out vec4 outColor;", "layout(location=0) out vec4 outColor;\nlayout(location=1) out float outDepth;\nuniform sampler2D uHistory;\nuniform vec3 uAccumulation;");
    shader = shader.replace("gl_FragCoord.xy+offset", "gl_FragCoord.xy+offset+uAccumulation.yz");
    shader = shader.replace("gl_FragDepth = uLinearHDR ? cameraDepth() : 1.0;", "outDepth = cameraDepth();\n  if(uAccumulation.x>0.0) {vec3 previous=texelFetch(uHistory,ivec2(gl_FragCoord.xy),0).rgb;color=previous+(color-previous)/(uAccumulation.x+1.0);}");
  }
  const declarations = Array.from({ length: atlasCount }, (_, i) => `uniform sampler2D uAtlas${i};`).join("\n");
  const sample = `
vec4 sampleAtlas(int binding, vec2 uv, float footprint) {
  vec4 rect = readData(uAtlasBindings,binding*2), info = readData(uAtlasBindings,binding*2+1);
  vec4 meta = readData(uBindings,binding*3), flags = readData(uBindings,binding*3+2);
  if (info.y > 0.5) uv.y = 1.0-uv.y;
  uv = wrapUV(uv,meta.yz);
  if (meta.y < 0.5) uv.x = fract(uv.x);
  if (meta.z < 0.5) uv.y = fract(uv.y);
  vec2 size = rect.zw*info.w;
  float lod = flags.w > 0.5 ? clamp(log2(max(footprint*max(size.x,size.y),1.0)),0.0,info.z) : 0.0;
  vec2 halfTexel = 0.5*exp2(ceil(lod))/size;
  uv = clamp(uv,min(halfTexel,vec2(0.5)),max(vec2(1)-halfTexel,vec2(0.5)));
  vec2 atlasUV = rect.xy+uv*rect.zw;
  if (meta.w > 0.5) {
    lod = floor(lod);
    vec2 dimensions = vec2(info.w/exp2(lod));
    atlasUV = (floor(atlasUV*dimensions)+0.5)/dimensions;
  }
  switch (int(info.x)) {
    ${Array.from({ length: atlasCount }, (_, i) => `case ${i}: return textureLod(uAtlas${i},atlasUV,lod);`).join("\n")}
  }
  return vec4(1);
}
`;
  if (!hasFallbackImages) {
    const start = shader.indexOf("vec4 sampleImage(");
    const end = shader.indexOf("vec2 transformedUV", start);
    shader = shader.slice(0, start) + "vec4 sampleImage(int binding, vec2 uv, float footprint, bool colorMap) { return sampleAtlas(binding,uv,footprint); }\n" + shader.slice(end);
  }
  shader = shader.replace("vec4 sampleImage(int binding", `${declarations}
${sample}
vec4 sampleImage(int binding`);
  return shader.replace(
    "  vec2 size = vec2(textureSize(uImages,0).xy);",
    "  if (readData(uAtlasBindings,binding*2+1).x >= 0.0) return sampleAtlas(binding,uv,footprint);\n  vec2 size = vec2(textureSize(uImages,0).xy);"
  );
}

// ../sdk-oct2/src/viewing/techniques/rayTracing/webGL/programs.ts
var caches = /* @__PURE__ */ new WeakMap();
function acquireProgram(gl, vertex, fragment, lifetime, parallel = false) {
  let owners = caches.get(gl);
  if (!owners) {
    owners = /* @__PURE__ */ new WeakMap();
    caches.set(gl, owners);
  }
  const owner = lifetime ?? {};
  let cache = owners.get(owner);
  if (!cache) {
    cache = new CompilationCache((value) => value.destroy(), lifetime ? 4 : 0, lifetime);
    owners.set(owner, cache);
  }
  if (gl.isContextLost()) {
    cache.dispose();
    owners.delete(owner);
    throw new Error("WebGL context is lost.");
  }
  const lease = cache.acquire(vertex + "\0" + fragment, () => {
    const shaders = [];
    let program = null, ready = false, destroyed = false;
    const clearShaders = () => {
      if (!gl.isContextLost()) for (const shader of shaders) gl.deleteShader(shader);
      shaders.length = 0;
    };
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      clearShaders();
      if (program && !gl.isContextLost()) gl.deleteProgram(program);
    };
    try {
      program = gl.createProgram();
      if (!program) throw new Error("Could not allocate a WebGL program.");
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error("Could not allocate a WebGL shader.");
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      const extension = gl.getExtension("KHR_parallel_shader_compile");
      const isReady = () => {
        if (destroyed || gl.isContextLost()) throw new Error("WebGL compilation is no longer available.");
        if (ready) return true;
        if (parallel && extension && !gl.getProgramParameter(program, extension.COMPLETION_STATUS_KHR)) return false;
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Shader linking failed.");
        for (const shader of shaders) gl.detachShader(program, shader);
        clearShaders();
        ready = true;
        return true;
      };
      if (!parallel) isReady();
      return { program, isReady, destroy };
    } catch (error) {
      destroy();
      throw error;
    }
  });
  return { program: lease.value.program, release: lease.release, isReady: () => {
    try {
      if (!lease.value.isReady()) return false;
      lease.ready();
      return true;
    } catch (error) {
      lease.invalidate();
      throw error;
    }
  } };
}

// ../sdk-oct2/src/viewing/techniques/rayTracing/webGL/accumulation.ts
function createAccumulation(gl, lifetime) {
  const textures = [], fbos = [];
  let lease;
  let program = null, vao = null, width = 0, height = 0, current = 0;
  const clearTargets = () => {
    fbos.splice(0).forEach((f) => gl.deleteFramebuffer(f));
    textures.splice(0).forEach((t) => gl.deleteTexture(t));
    width = height = 0;
  };
  const dispose = () => {
    clearTargets();
    lease?.release();
    if (vao) gl.deleteVertexArray(vao);
    program = null;
    vao = null;
  };
  try {
    lease = acquireProgram(gl, vertexShader, `#version 300 es
precision highp float;
uniform sampler2D colorImage, depthImage;
out vec4 color;
void main(){ivec2 p=ivec2(gl_FragCoord.xy);color=texelFetch(colorImage,p,0);gl_FragDepth=texelFetch(depthImage,p,0).r;}`, lifetime);
    lease.isReady();
    program = lease.program;
    const colorUniform = gl.getUniformLocation(program, "colorImage"), depthUniform = gl.getUniformLocation(program, "depthImage");
    vao = gl.createVertexArray();
    if (!vao) throw new Error("Accumulation VAO allocation failed.");
    return {
      resize(w, h) {
        if (width === w && height === h) return;
        clearTargets();
        width = w;
        height = h;
        current = 0;
        try {
          for (const format of [gl.RGBA16F, gl.RGBA16F, gl.R32F]) {
            const texture = gl.createTexture();
            if (!texture) throw new Error("Accumulation image allocation failed.");
            textures.push(texture);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          }
          for (let i = 0; i < 2; i++) {
            const fbo = gl.createFramebuffer();
            if (!fbo) throw new Error("Accumulation framebuffer allocation failed.");
            fbos.push(fbo);
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textures[i], 0);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, textures[2], 0);
            gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Progressive HDR targets are unavailable.");
          }
        } catch (error) {
          clearTargets();
          throw error;
        }
      },
      begin(unit) {
        const next = 1 - current;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[next]);
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, textures[current]);
        current = next;
      },
      present(target) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target);
        gl.viewport(0, 0, width, height);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.ALWAYS);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        gl.useProgram(program);
        gl.bindVertexArray(vao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, textures[current]);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, textures[2]);
        gl.uniform1i(colorUniform, 0);
        gl.uniform1i(depthUniform, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      dispose
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

// ../sdk-oct2/src/viewing/techniques/rayTracing/webGL/renderer.ts
var geometryPools = /* @__PURE__ */ new WeakMap();
function createSharedRenderer(context, data, lighting = { center: [0, 0, 0], scale: 1 }, standaloneCanvas, progressive = false, kernel) {
  const gl = context.gl;
  let pool = geometryPools.get(gl);
  if (!pool) {
    pool = new ResourceLeases((value) => gl.deleteTexture(value.texture));
    geometryPools.set(gl, pool);
  }
  const geometryLeases = {};
  progressive = progressive && !standaloneCanvas && !!gl.getExtension("EXT_color_buffer_float");
  const progress = kernel?.progress ?? new ProgressiveState();
  let fence = null;
  let accumulation;
  let scheduled;
  const schedule = (view) => {
    if (view && scheduled === void 0) scheduled = setTimeout(() => {
      scheduled = void 0;
      if (!disposed) view.needsRender();
    }, 16);
  };
  let origin = data.origin ?? [0, 0, 0];
  const atlases = [];
  const limit = Math.max(0, gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) - (kernel?.reservedTextures ?? (progressive ? 14 : 13)));
  let atlasBindings = new Float32Array(Math.max(8, (data.textureBindings?.length ?? 0) * 8));
  let bindings = data.bindings.slice();
  const images = [], imageIds = /* @__PURE__ */ new Map();
  const fallbackSlots = new Int32Array(Math.floor(bindings.length / 12)).fill(-1);
  for (let i = 0; i < Math.floor(bindings.length / 12); i++) {
    const source = data.textureBindings?.[i];
    const borrowed = source && context.getMaterialTexture(source.mesh, source.slot);
    let atlas = borrowed ? atlases.findIndex((item) => item.texture === borrowed.texture) : -1;
    if (borrowed && atlas < 0 && atlases.length < limit) {
      atlas = atlases.length;
      atlases.push(borrowed);
    }
    atlasBindings[i * 8 + 4] = atlas;
    if (borrowed && atlas >= 0) {
      atlasBindings.set(borrowed.rect, i * 8);
      atlasBindings.set([atlas, borrowed.flipY ? 1 : 0, borrowed.maxLod, borrowed.size], i * 8 + 4);
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
  const fallbackImages = new FallbackImages(data, fallbackSlots);
  const decoding = new AbortController();
  let imagesReady = true, imageError;
  for (const [, layer] of imageIds) if (!images[layer]) imagesReady = false;
  if (!imagesReady) void (async () => {
    for (const [source, layer] of imageIds) if (!images[layer]) {
      const texture = data.imageSources?.[source];
      if (!texture) throw new Error("Missing ray-tracing fallback image.");
      images[layer] = await decodeTexture(texture, decoding.signal, data.textureSize);
    }
    imagesReady = true;
  })().catch((error) => {
    imageError = error;
  });
  const textures = [], ownedTextures = [];
  let programLease;
  let program = null, vao = null;
  let frames = 0, disposed = false;
  let fallbackEnvironment = null;
  let environment;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    decoding.abort();
    fallbackImages.dispose();
    if (scheduled !== void 0) clearTimeout(scheduled);
    accumulation?.dispose();
    if (fence) {
      gl.deleteSync(fence);
      fence = null;
    }
    if (gl.isContextLost()) geometryPools.delete(gl);
    Object.values(geometryLeases).forEach((lease) => lease.release());
    for (const texture of ownedTextures) gl.deleteTexture(texture);
    if (fallbackEnvironment) gl.deleteTexture(fallbackEnvironment);
    environment = void 0;
    programLease?.release();
    if (vao) gl.deleteVertexArray(vao);
  };
  let updates = 0, updatedBytes = 0, updateCalls = 0;
  try {
    programLease = acquireProgram(gl, vertexShader, kernel ? kernel.source(atlases.length, images.length > 0, !!data.instances, opaqueScene(data)) : sharedFragmentShader(atlases.length, images.length > 0, !!data.instances, progressive, opaqueScene(data)), context.resourceLifetime, !standaloneCanvas);
    program = programLease.program;
    vao = gl.createVertexArray();
    if (!vao) throw new Error("Could not allocate a vertex array.");
    const sizes = [];
    const streams = dataStreams(data, bindings, atlasBindings);
    const uploadData = (values, unit, resource, previous, track = false) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, resource.texture);
      for (const part of batchUploads(streamUploads(values, previous, 4))) {
        const calls = uploadTextureRange(gl, resource.width, part.values, part.offset, part.offset + part.values.length, 0);
        if (track) {
          updatedBytes += part.values.byteLength;
          updateCalls += calls;
        }
      }
    };
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const textureShape = (values) => {
      const texels = Math.max(1, Math.ceil(values.length / 4));
      const width2 = Math.min(maxTextureSize, 2 ** Math.ceil(Math.log2(Math.sqrt(texels)))), height2 = Math.ceil(texels / width2);
      if (height2 > maxTextureSize) throw new Error("Scene exceeds the device texture limit.");
      return { width: width2, height: height2, capacity: width2 * height2 * 4 };
    };
    const createTexture = (values, unit, track = false) => {
      const { width: width2, height: height2, capacity } = textureShape(values);
      const texture = gl.createTexture();
      if (!texture) throw new Error("Could not allocate a geometry texture.");
      try {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width2, height2);
        const resource = { texture, width: width2, capacity };
        uploadData(values, unit, resource, void 0, track);
        return resource;
      } catch (error) {
        gl.deleteTexture(texture);
        throw error;
      }
    };
    streams.forEach((values, unit) => {
      let resource;
      if (mutableStreams.includes(unit)) {
        resource = createTexture(values, unit);
        ownedTextures.push(resource.texture);
      } else {
        const lease = pool.acquire(values, () => createTexture(values, unit));
        geometryLeases[unit] = lease;
        resource = lease.resource;
      }
      textures[unit] = resource.texture;
      sizes[unit] = resource;
    });
    let width = 1, height = 1, imagesUploaded = false;
    const uploadImages = () => {
      const maxSize = Math.min(data.textureSize ?? MATERIAL_TEXTURE_SIZE, gl.getParameter(gl.MAX_TEXTURE_SIZE));
      width = Math.max(1, ...images.map((image) => Math.min(maxSize, image.width)));
      height = Math.max(1, ...images.map((image) => Math.min(maxSize, image.height)));
      const layers = Math.max(1, images.length);
      while (width * height * layers * 32 / 3 > 128 * 1024 * 1024 && (width > 1 || height > 1)) {
        width = Math.max(1, Math.floor(width / 2));
        height = Math.max(1, Math.floor(height / 2));
      }
      if (layers > gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) || width * height * layers * 32 / 3 > 128 * 1024 * 1024) {
        throw new Error("Material textures exceed the ray tracer's 128 MiB texture-array budget or device layer limit.");
      }
      fallbackImages.initialize(images, width, height, maxSize);
      const resized = images.length ? images.map((image) => resizeTexturePixels(image, width, height)) : [new Uint8ClampedArray([255, 255, 255, 255])];
      for (const colorMap of [false, true]) {
        const imageArray = gl.createTexture();
        if (!imageArray) throw new Error("Could not allocate material textures.");
        textures.push(imageArray);
        ownedTextures.push(imageArray);
        gl.activeTexture(gl.TEXTURE0 + (colorMap ? 9 : 8));
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, imageArray);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
        const levels = Math.floor(Math.log2(Math.max(width, height))) + 1;
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, colorMap ? gl.SRGB8_ALPHA8 : gl.RGBA8, width, height, layers);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        for (let layer = 0; layer < layers; layer++) {
          const pixels = resized[layer];
          gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, width, height, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        }
        gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      }
      if (gl.getError() !== gl.NO_ERROR) throw new Error("Uploading ray-tracing material textures failed.");
      imagesUploaded = true;
      images.length = 0;
    };
    const fallbackImageCount = imageIds.size;
    if (imagesReady) uploadImages();
    fallbackEnvironment = gl.createTexture();
    if (!fallbackEnvironment) throw new Error("Could not allocate the fallback environment.");
    gl.activeTexture(gl.TEXTURE0 + 10);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, fallbackEnvironment);
    for (let face = 0; face < 6; face++) gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (gl.getError() !== gl.NO_ERROR) throw new Error("Uploading ray-tracing geometry or material textures failed.");
    let atlasUniforms;
    let ready = false;
    let u;
    const isReady = () => {
      if (disposed || context.resourceLifetime?.aborted || gl.isContextLost()) return false;
      if (ready) return true;
      if (imageError) throw imageError;
      if (!imagesReady) return false;
      if (!imagesUploaded) uploadImages();
      if (disposed || context.resourceLifetime?.aborted || gl.isContextLost()) return false;
      if (!programLease.isReady()) return false;
      u = Object.fromEntries([
        "TransformOffset",
        "MaterialMapOffset",
        "History",
        "Accumulation",
        "InstanceCount",
        "TLASOffset",
        "TLASCount",
        "LinearHDR",
        "LogDepthCoefficient",
        "Projection",
        "ClipRange",
        "SRGBEncode",
        "Antialiasing",
        "ToneMapping",
        "Exposure",
        "Environment",
        "Irradiance",
        "BRDF",
        "IBL",
        "IBLIntensity",
        "EnvironmentMaxLod",
        "AtlasBindings",
        "Triangles",
        "Materials",
        "Nodes",
        "NodeCount",
        "Resolution",
        "Eye",
        "Forward",
        "Right",
        "Up",
        "PBR",
        "UVs",
        "Bindings",
        "Images",
        "ColorImages",
        "Pbr",
        "Textures",
        "Normals",
        "Light",
        "LightScale",
        "WorldUp",
        "SkyLight",
        "TanHalfFov",
        "Bounces",
        "Shadows",
        "Transparency",
        "SmoothShading"
      ].map((name) => [name, gl.getUniformLocation(program, `u${name}`)]));
      atlasUniforms = atlases.map((_, i) => gl.getUniformLocation(program, `uAtlas${i}`));
      ready = true;
      return true;
    };
    return {
      gl,
      isReady,
      async prepareUpdate(next, signal) {
        if (!disposed && ready && compatibleGeometry(data, next)) await fallbackImages.prepare(next, signal);
      },
      get updateStats() {
        return { updates, bytes: updatedBytes, calls: updateCalls };
      },
      update(next) {
        if (disposed || !ready || gl.isContextLost() || !compatibleGeometry(data, next)) return false;
        const imageUpdate = fallbackImageCount ? fallbackImages.get(next) : void 0;
        if (fallbackImageCount && !imageUpdate) return false;
        const nextBindings = fallbackImageCount ? next.bindings.slice() : next.bindings;
        const nextAtlases = [], nextShared = new Float32Array(Math.max(8, (next.textureBindings?.length ?? 0) * 8));
        for (let i = 0; i < Math.floor(next.bindings.length / 12); i++) {
          if (fallbackSlots[i] >= 0) {
            nextBindings[i * 12] = fallbackSlots[i];
            nextShared[i * 8 + 4] = -1;
            continue;
          }
          const source = next.textureBindings?.[i], borrowed = source && context.getMaterialTexture(source.mesh, source.slot);
          if (!borrowed) return false;
          let atlas = nextAtlases.findIndex((item) => item.texture === borrowed.texture);
          if (atlas < 0) {
            atlas = nextAtlases.length;
            nextAtlases.push(borrowed);
          }
          nextShared.set(borrowed.rect, i * 8);
          nextShared.set([atlas, borrowed.flipY ? 1 : 0, borrowed.maxLod, borrowed.size], i * 8 + 4);
        }
        if (nextAtlases.length !== atlases.length) return false;
        const nextStreams = dataStreams(next, nextBindings, nextShared);
        const replacements = /* @__PURE__ */ new Map(), newLeases = /* @__PURE__ */ new Map();
        try {
          for (let i = 0; i < streams.length; i++) {
            const excess = sizes[i].capacity > Math.max(4096, streamLiveLength(nextStreams[i]) * 1.5);
            const resize = nextStreams[i].length > sizes[i].capacity || excess && sizes[i].capacity > textureShape(nextStreams[i]).capacity;
            const lease = geometryLeases[i];
            if (resize || lease && streams[i] !== nextStreams[i] && !lease.canRekey(nextStreams[i])) {
              if (lease) {
                const replacement = pool.acquire(nextStreams[i], () => createTexture(nextStreams[i], i, true));
                newLeases.set(i, replacement);
                replacements.set(i, replacement.resource);
              } else replacements.set(i, createTexture(nextStreams[i], i, true));
            }
          }
          for (let i = 0; i < streams.length; i++) if (!replacements.has(i)) uploadData(nextStreams[i], i, { texture: textures[i], ...sizes[i] }, streams[i], true);
          if (imageUpdate?.pixels.size) {
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            for (const unit of [8, 9]) {
              gl.activeTexture(gl.TEXTURE0 + unit);
              gl.bindTexture(gl.TEXTURE_2D_ARRAY, textures[unit]);
              for (const [layer, pixels] of imageUpdate.pixels) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, width, height, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
              gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
            }
          }
          if (gl.getError() !== gl.NO_ERROR) throw new Error("Updating ray-tracing data textures failed.");
          for (const [i, resource] of replacements) {
            if (newLeases.has(i)) {
              geometryLeases[i].release();
              geometryLeases[i] = newLeases.get(i);
            } else {
              const old = textures[i];
              ownedTextures.splice(ownedTextures.indexOf(old), 1, resource.texture);
              gl.deleteTexture(old);
            }
            textures[i] = resource.texture;
            sizes[i] = resource;
          }
          geometryUnits.forEach((i) => {
            if (!replacements.has(i) && streams[i] !== nextStreams[i]) geometryLeases[i].rekey(nextStreams[i]);
          });
          replacements.clear();
          newLeases.clear();
          nextStreams.forEach((values, i) => {
            streams[i] = values;
          });
          atlases.splice(0, atlases.length, ...nextAtlases);
          bindings = nextBindings;
          atlasBindings = nextShared;
          fallbackImages.commit(next);
          data = next;
          origin = next.origin ?? [0, 0, 0];
          progress.reset();
          updates++;
          if (fence) {
            gl.deleteSync(fence);
            fence = null;
          }
          return true;
        } catch (error) {
          for (const [i, resource] of replacements) {
            if (newLeases.has(i)) newLeases.get(i).release();
            else gl.deleteTexture(resource.texture);
          }
          dispose();
          throw error;
        }
      },
      get sharedTextures() {
        return atlases.map((atlas) => atlas.texture);
      },
      get sharedBindingCount() {
        return Array.from({ length: data.textureBindings?.length ?? 0 }, (_, i) => atlasBindings[i * 8 + 4]).filter((id) => id >= 0).length;
      },
      fallbackImageCount,
      get fallbackTextureSize() {
        return [width, height];
      },
      get frames() {
        return frames;
      },
      get accumulatedSamples() {
        return progress.samples;
      },
      get quality() {
        return progressive ? progress.mode : "high-quality";
      },
      get disposed() {
        return disposed;
      },
      /** Borrowed host IBL handles from the most recent draw. */
      get environment() {
        return environment;
      },
      draw(camera, settings, target, ibl) {
        if (disposed || gl.isContextLost() || !isReady()) return;
        environment = ibl;
        const canvas = standaloneCanvas;
        const width2 = target?.width ?? Math.max(1, canvas.clientWidth), height2 = target?.height ?? Math.max(1, canvas.clientHeight);
        const scale = target ? 1 : Math.min(settings.scale, 1600 / width2, 1100 / height2);
        const w = Math.max(1, Math.round(width2 * scale)), h = Math.max(1, Math.round(height2 * scale));
        if (canvas && (canvas.width !== w || canvas.height !== h)) {
          canvas.width = w;
          canvas.height = h;
        }
        const basis = camera.basis(width2 / height2), angle = settings.lightAngle * Math.PI / 180;
        const hdr = target?.output?.colorSpace === "linear-hdr";
        if (progressive && !hdr) throw new Error("Progressive ray tracing requires a linear-HDR host target.");
        const hostTarget = progressive ? gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) : null;
        let gpuReady = true;
        if (fence) {
          gpuReady = gl.clientWaitSync(fence, 0, 0) !== gl.TIMEOUT_EXPIRED;
          if (gpuReady) {
            gl.deleteSync(fence);
            fence = null;
          }
        }
        const projection = target?.view?.camera.projMatrix;
        const step = progressive && hdr ? progress.next([
          ...kernel?.signature() ?? [],
          w,
          h,
          ...basis.eye,
          ...basis.forward,
          ...basis.right,
          ...basis.up,
          basis.tanHalfFov,
          ...projection ?? [],
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
          ibl?.irradiance,
          ibl?.prefiltered,
          ibl?.brdf,
          ibl?.intensity,
          ibl?.maxSpecularMipLevel,
          target?.output?.colorSpace === "linear-hdr" ? target.output.logDepthCoefficient : 0
        ], performance.now(), settings.antialiasing === "4x", settings.bounces, gpuReady) : void 0;
        if (step) {
          accumulation ??= kernel?.createAccumulation() ?? createAccumulation(gl, context.resourceLifetime);
          accumulation.resize(w, h);
          if (!step.trace) {
            accumulation.present(hostTarget);
            if (step.pending) schedule(target?.view);
            frames++;
            return;
          }
        }
        gl.viewport(0, 0, w, h);
        if (hdr) {
          gl.enable(gl.DEPTH_TEST);
          gl.depthFunc(gl.ALWAYS);
          gl.depthMask(true);
        } else gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.disable(gl.CULL_FACE);
        gl.useProgram(program);
        gl.bindVertexArray(vao);
        textures.forEach((texture, i) => {
          gl.activeTexture(gl.TEXTURE0 + i);
          gl.bindTexture(i >= 8 ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D, texture);
        });
        ["Triangles", "Materials", "Nodes", "Normals", "PBR", "UVs", "Bindings", "AtlasBindings"].forEach((name, i) => gl.uniform1i(u[name], i));
        gl.uniform1i(u.NodeCount, data.nodeCount);
        gl.uniform1i(u.TransformOffset, data.instances?.transformOffset ?? 0);
        gl.uniform1i(u.MaterialMapOffset, data.materialMapOffset ?? 0);
        gl.uniform1i(u.InstanceCount, data.instances?.instanceCount ?? 0);
        gl.uniform1i(u.TLASOffset, data.instances?.tlasOffset ?? 0);
        gl.uniform1i(u.TLASCount, data.instances?.tlasNodeCount ?? 0);
        gl.uniform1i(u.Images, 8);
        gl.uniform1i(u.ColorImages, 9);
        gl.activeTexture(gl.TEXTURE0 + 10);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, ibl?.prefiltered ?? fallbackEnvironment);
        gl.activeTexture(gl.TEXTURE0 + 11);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, ibl?.irradiance ?? fallbackEnvironment);
        gl.activeTexture(gl.TEXTURE0 + 12);
        gl.bindTexture(gl.TEXTURE_2D, ibl?.brdf ?? textures[1]);
        gl.uniform1i(u.Environment, 10);
        gl.uniform1i(u.Irradiance, 11);
        gl.uniform1i(u.BRDF, 12);
        gl.uniform1i(u.IBL, ibl ? 1 : 0);
        gl.uniform1f(u.IBLIntensity, ibl?.intensity ?? 0);
        gl.uniform1f(u.EnvironmentMaxLod, ibl?.maxSpecularMipLevel ?? 0);
        atlases.forEach((atlas, i) => {
          gl.activeTexture(gl.TEXTURE0 + 13 + i);
          gl.bindTexture(gl.TEXTURE_2D, atlas.texture);
          gl.uniform1i(atlasUniforms[i], 13 + i);
        });
        gl.uniform1i(u.LinearHDR, hdr ? 1 : 0);
        gl.uniform1i(u.SRGBEncode, target?.view?.effects.tonemap.sRGBEncode === false ? 0 : 1);
        gl.uniform1f(u.LogDepthCoefficient, target?.output?.colorSpace === "linear-hdr" ? target.output.logDepthCoefficient : 0);
        if (target?.view) {
          gl.uniformMatrix4fv(u.Projection, false, new Float32Array(target.view.camera.projMatrix));
          const projection2 = target.view.camera.perspectiveProjection;
          gl.uniform2f(u.ClipRange, projection2.near, projection2.far);
        }
        gl.uniform1i(u.Antialiasing, !step && settings.antialiasing === "4x" ? 1 : 0);
        gl.uniform1i(u.ToneMapping, settings.toneMapping === "aces" ? 2 : settings.toneMapping === "none" ? 0 : 1);
        const exposure = settings.exposure ?? 1;
        gl.uniform1f(u.Exposure, Number.isFinite(exposure) ? Math.max(0, Math.min(16, exposure)) : 1);
        gl.uniform1i(u.Pbr, settings.pbr !== false ? 1 : 0);
        gl.uniform1i(u.Textures, settings.textures !== false ? 1 : 0);
        gl.uniform2f(u.Resolution, w, h);
        gl.uniform3fv(u.Eye, basis.eye.map((value, axis) => value - origin[axis]));
        gl.uniform3fv(u.Forward, basis.forward);
        gl.uniform3fv(u.Right, basis.right);
        gl.uniform3fv(u.Up, basis.up);
        gl.uniform1f(u.TanHalfFov, basis.tanHalfFov);
        const lightFrame = rayLightingFrame(lighting, angle, origin, target?.view?.viewer?.scene?.coordinateSystem);
        gl.uniform3fv(u.Light, lightFrame.position);
        gl.uniform3fv(u.WorldUp, lightFrame.up);
        gl.uniform3fv(u.SkyLight, lightFrame.skyLight);
        gl.uniform1f(u.LightScale, lighting.scale);
        gl.uniform1i(u.Bounces, Math.max(0, Math.min(3, Math.trunc(step?.bounces ?? settings.bounces))));
        gl.uniform1i(u.Shadows, settings.shadows ? 1 : 0);
        gl.uniform1i(u.Transparency, settings.transparency ? 1 : 0);
        gl.uniform1i(u.SmoothShading, settings.smoothShading ? 1 : 0);
        if (step) {
          accumulation.begin(13 + atlases.length);
          gl.uniform1i(u.History, 13 + atlases.length);
          gl.uniform3f(u.Accumulation, step.count, step.jitter[0], step.jitter[1]);
        }
        kernel?.bind(program, 13 + atlases.length);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (step) {
          accumulation.present(hostTarget);
          fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          if (step.pending) schedule(target?.view);
        }
        frames++;
      },
      dispose
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

export {
  vertexShader,
  sharedFragmentShader,
  acquireProgram,
  createSharedRenderer
};
