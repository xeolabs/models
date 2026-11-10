import {
  acquirePipeline,
  createShaderSource,
  createSharedRenderer
} from "./chunk-2TLBS7OK.js";
import {
  acquireProgram,
  createSharedRenderer as createSharedRenderer2,
  sharedFragmentShader,
  vertexShader
} from "./chunk-AOCZUIY4.js";
import {
  createScenePacker,
  materialTextureSize,
  opaqueScene,
  uploadTextureRange
} from "./chunk-3HYABQVT.js";
import {
  PerspectiveProjectionType
} from "./chunk-NFE4WVL6.js";

// ../sdk-oct2/src/viewing/techniques/rayTracing/webGPU/tables.ts
function uploadTable(context, values, width, height) {
  if (width > (context.device.limits?.maxTextureDimension2D ?? 8192) || height > (context.device.limits?.maxTextureDimension2D ?? 8192)) throw new Error("Path lighting table exceeds device texture limits.");
  const texture = context.device.createTexture({ label: "path light sampling table", size: { width, height }, format: "rgba32float", usage: 6 });
  try {
    const rows = Math.floor(values.length / (width * 4));
    if (rows) context.device.queue.writeTexture({ texture }, values.subarray(0, rows * width * 4), { bytesPerRow: width * 16, rowsPerImage: rows }, { width, height: rows });
    const rest = values.length - rows * width * 4;
    if (rest) {
      const row = new Float32Array(width * 4);
      row.set(values.subarray(rows * width * 4));
      context.device.queue.writeTexture({ texture, origin: { x: 0, y: rows, z: 0 } }, row, { bytesPerRow: width * 16 }, { width, height: 1 });
    }
    return { texture, view: texture.createView() };
  } catch (error) {
    texture.destroy?.();
    throw error;
  }
}

// ../sdk-oct2/src/viewing/techniques/pathTracing/shared/sampling.ts
var samplingWGSL = (
  /* wgsl */
  `
fn pilotSamples(count:f32,minimum:f32)->f32 {return min(floor(count/4.0),max(32.0,minimum));}
fn takePilotSample(count:f32,minimum:f32,adaptive:bool)->bool {
 return adaptive&&pilotSamples(count,minimum)<max(32.0,minimum)&&u32(count)%4u==3u;
}
fn samplingConverged(count:f32,mean:f32,m2:f32,minimum:f32,threshold:f32)->bool {
 let pilots=max(32.0,minimum);
 if(threshold<=0||pilotSamples(count,minimum)<pilots||mean<=.001){return false;}
 let variance=max(m2,0.0)/(pilots-1.0);
 return count>=max(pilots,ceil(6.635*variance/pow(threshold*max(mean,.01),2.0)));
}
fn meanVariance(count:f32,m2:f32,minimum:f32,adaptive:bool)->f32 {
 let moments=select(count,pilotSamples(count,minimum),adaptive);
 return max(m2,0.0)/max(count*(moments-1.0),1.0);
}
`
);

// ../sdk-oct2/src/viewing/techniques/pathTracing/webGPU/accumulation.ts
var shader = (
  /* wgsl */
  `${samplingWGSL}

@group(0) @binding(0) var history:texture_2d<f32>;
@group(0) @binding(1) var guides:texture_2d<f32>;
@group(0) @binding(2) var auxiliary:texture_2d<f32>;
@group(0) @binding(3) var inputImage:texture_2d<f32>;
struct Settings {balance:vec4f,sampling:vec4f,overlay:vec4f,projection:vec4f,right:vec4f,up:vec4f,forward:vec4f,wavelet:vec4f};
@group(0) @binding(4) var<uniform> settings:Settings;
@vertex fn vertexMain(@builtin(vertex_index) id:u32)->@builtin(position) vec4f{
 let p=vec2f(f32((id<<1u)&2u),f32(id&2u));return vec4f(p*2.0-vec2f(1),0,1);
}
fn normal(encoded:f32)->vec3f {let bits=u32(encoded);let p=vec2f(f32(bits%4096u),f32(bits/4096u))/4095.0*2.0-vec2f(1);var n=vec3f(p,1.0-abs(p.x)-abs(p.y));if(n.z<0){n=vec3f((vec2f(1)-abs(n.yx))*select(vec2f(1),vec2f(-1),n.xy<vec2f(0)),n.z);}return normalize(n);}
fn albedo(encoded:f32)->vec3f {let bits=u32(encoded);return pow(vec3f(f32(bits%256u),f32((bits/256u)%256u),f32(bits/65536u))/255.0,vec3f(2.2));}
fn finiteColor(value:vec3f)->bool {return all((bitcast<vec3u>(value)&vec3u(0x7f800000u))!=vec3u(0x7f800000u));}
fn variance(count:f32,g:vec4f)->f32 {
 return meanVariance(count,g.w,settings.sampling.x,settings.sampling.y>.5);
}
// Rare display paths need bandwidth even when independent variance pilots miss them.
fn filterVariance(h:vec4f,g:vec4f,m:vec4f)->f32 {
 let peak=max(0.0,m.w-dot(h.rgb,vec3f(.2126,.7152,.0722)))/max(h.a,1.0);
 return max(variance(h.a,g),peak*peak);
}
fn position(pixel:vec2i,depth:f32)->vec3f {
 let size=vec2f(textureDimensions(history));let xy=(vec2f(pixel)+vec2f(.5))/size*2.0-vec2f(1);
 return depth*(settings.forward.xyz+settings.right.xyz*xy.x*settings.projection.w*size.x/size.y-settings.up.xyz*xy.y*settings.projection.w);
}
@fragment fn filterMain(@builtin(position) p:vec4f)->@location(0) vec4f {
 let pixel=vec2i(p.xy);let center=textureLoad(inputImage,pixel,0).rgb;let h=textureLoad(history,pixel,0);
 let guide=textureLoad(guides,pixel,0);let material=textureLoad(auxiliary,pixel,0);
 let step=i32(settings.wavelet.x);let roughness=f32(u32(material.y)%256u)/255.0;let transmission=f32((u32(material.y)/256u)%256u)/255.0;
 // Preserve fine reflections and transmitted detail: only the smallest scale
 // operates on smooth or transmissive surfaces. No temporal feedback.
 let detailed=roughness<.15||transmission>0||u32(material.y)>=8388608u||settings.wavelet.y>.5;
 // Scratch alpha carries reconstructed uncertainty, never the raw sample count.
 // Later scales must not keep blurring with the original, noisier bandwidth.
 let centerVariance=select(textureLoad(inputImage,pixel,0).a,filterVariance(h,guide,material),step==1);
 if(h.a<4||guide.x<=0||(step>1&&detailed)){return vec4f(center,centerVariance);}
 let size=vec2i(textureDimensions(history));let n=normal(guide.y);let a=albedo(material.x);
 let point=position(pixel,guide.x);let footprint=2.0*guide.x*settings.projection.w/f32(size.y);
 var sum=center;var weight=1.0;var filteredVariance=centerVariance;
 for(var y=-2;y<=2;y++){for(var x=-2;x<=2;x++){
  if((x==0&&y==0)||(detailed&&(abs(x)>1||abs(y)>1))){continue;}let q=pixel+vec2i(x,y)*step;if(any(q<vec2i(0))||any(q>=size)){continue;}
  let other=textureLoad(inputImage,q,0).rgb;let g=textureLoad(guides,q,0);let m=textureLoad(auxiliary,q,0);let oh=textureLoad(history,q,0);
  if(g.x<=0||oh.a<=0||!finiteColor(other)){continue;}
  let plane=abs(dot(n,position(q,g.x)-point));
  let geometry=pow(max(dot(n,normal(g.y)),0.0),32.0)*exp(-plane/max(footprint*.2,1e-6));
  let difference=albedo(m.x)-a;let materialWeight=exp(-dot(difference,difference)/.02)*select(0.0,1.0,abs(m.y-material.y)<.5);
  let otherVariance=select(textureLoad(inputImage,q,0).a,filterVariance(oh,g,m),step==1);
  let colorDifference=dot(other-center,vec3f(.2126,.7152,.0722));
  let range=exp(-colorDifference*colorDifference/max(8.0*(centerVariance+otherVariance),1e-8));
  let wx=select(select(1.0/6.0,2.0/3.0,abs(x)==1),1.0,x==0);
  let wy=select(select(1.0/6.0,2.0/3.0,abs(y)==1),1.0,y==0);let spatial=wx*wy;let w=spatial*geometry*materialWeight*range;
  if(!finiteColor(vec3f(w))||w<=0){continue;}sum+=other*w;weight+=w;filteredVariance+=w*w*otherVariance;
 }}
 return vec4f(sum/weight,filteredVariance/(weight*weight));
}
fn heat(t:f32)->vec3f {return clamp(vec3f(1.5)-abs(vec3f(4.0*t)-vec3f(3,2,1)),vec3f(0),vec3f(1));}
struct Fragment{@location(0) color:vec4f,@builtin(frag_depth) depth:f32}
@fragment fn fragmentMain(@builtin(position) p:vec4f)->Fragment {
 let pixel=vec2i(p.xy);let h=textureLoad(history,pixel,0);let g=textureLoad(guides,pixel,0);let a=textureLoad(auxiliary,pixel,0);
 // inputImage is raw history when denoising is off; never add raw noise back.
 var color=textureLoad(inputImage,pixel,0).rgb*settings.balance.rgb;
 let mode=i32(settings.sampling.w);
 if(mode==1){color=heat(h.a/max(settings.sampling.z,1.0));}
 if(mode==2){color=heat(clamp(log2(1.0+sqrt(variance(h.a,g)))/4.0,0.0,1.0));}
 if(mode==3){color=heat(a.z/max(settings.overlay.y+1.0,1.0));}
 if(mode==4){color=heat(clamp(a.w/settings.overlay.x,0.0,1.0));}
 var depth=1.0;
 if(g.x>0){
  depth=clamp(((-g.x*settings.projection.x+settings.projection.y)/g.x)*.5+.5,0.0,1.0);
  if(settings.projection.z>0){depth=clamp(log2(1.0+g.x)*settings.projection.z*.5,0.0,1.0);}
 }
 return Fragment(vec4f(min(max(color,vec3f(0)),vec3f(65504)),1),depth);
}`
);
async function createPathAccumulation(context, settings, signal) {
  const { device, colorFormat, depthFormat } = context;
  const lease = acquirePipeline(context, JSON.stringify(["path-composite-v3", colorFormat, depthFormat]), async () => {
    const layout2 = device.createBindGroupLayout({ entries: [...[0, 1, 2, 3].map((binding) => ({ binding, visibility: 2, texture: { sampleType: "unfilterable-float" } })), { binding: 4, visibility: 2, buffer: { type: "uniform" } }] });
    const module = device.createShaderModule({ label: "path guided multiscale display", code: shader });
    const common = { layout: device.createPipelineLayout({ bindGroupLayouts: [layout2] }), vertex: { module, entryPoint: "vertexMain" }, primitive: { topology: "triangle-list" } };
    const pipeline2 = await device.createRenderPipelineAsync({ ...common, fragment: { module, entryPoint: "fragmentMain", targets: [{ format: colorFormat }] }, depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: "always" } });
    const filter2 = await device.createRenderPipelineAsync({ ...common, fragment: { module, entryPoint: "filterMain", targets: [{ format: "rgba32float" }] } });
    return { layout: layout2, pipeline: pipeline2, filter: filter2 };
  });
  let compiled;
  try {
    compiled = await lease.wait(signal);
  } catch (error) {
    lease.release();
    throw error;
  }
  const { layout, pipeline } = compiled;
  const filter = compiled.filter;
  const buffers = [];
  try {
    for (let i = 0; i < 4; i++) buffers.push(device.createBuffer({ label: "path display settings", size: 128, usage: 72 }));
  } catch (error) {
    buffers.forEach((b) => b.destroy?.());
    lease.release();
    throw error;
  }
  const textures = [];
  let views = [];
  let displayGroups = [], filterGroups = [];
  let width = 0, height = 0, current = 0, disposed = false, revision = 0, filteredRevision = -1;
  const clear = () => {
    textures.splice(0).forEach((t) => t.destroy?.());
    views = [];
    displayGroups = [];
    filterGroups = [];
    width = height = 0;
    filteredRevision = -1;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clear();
    buffers.forEach((b) => b.destroy?.());
    lease.release();
  };
  const bind = (i, input, buffer) => device.createBindGroup({ layout, entries: [{ binding: 0, resource: views[i] }, { binding: 1, resource: views[i + 2] }, { binding: 2, resource: views[i + 4] }, { binding: 3, resource: views[input] }, { binding: 4, resource: { buffer: buffers[buffer] } }] });
  return {
    resize(w, h) {
      if (disposed) throw new Error("Path accumulation disposed.");
      if (width === w && height === h) return false;
      clear();
      width = w;
      height = h;
      current = 0;
      try {
        for (let i = 0; i < 7; i++) {
          const t = device.createTexture({ label: i === 6 ? "path filtered display" : i < 4 ? "path HDR mean and moments" : "path material and diagnostics", size: { width: w, height: h }, format: "rgba32float", usage: i === 4 || i === 5 ? 12 : 20 });
          textures.push(t);
          views.push(t.createView());
        }
        displayGroups = [0, 1].map((i) => [bind(i, i, 3), bind(i, 6, 3)]);
        filterGroups = [0, 1].map((i) => [bind(i, i, 0), bind(i, 1 - i, 1), bind(i, 3 - i, 2)]);
        return true;
      } catch (error) {
        clear();
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
    get guideHistory() {
      return views[current + 2];
    },
    get depth() {
      return views[3 - current];
    },
    get auxiliaryHistory() {
      return views[current + 4];
    },
    get auxiliaryOutput() {
      return views[5 - current];
    },
    finish() {
      current = 1 - current;
      revision++;
    },
    filter(frame, samplingPending = false) {
      const camera = frame.view.camera, m = camera.inverseViewMatrix, p = camera.projMatrix;
      const values = new Float32Array(32);
      values.set([...settings.whiteBalance, 0, Math.max(32, settings.minSamples), settings.adaptive && settings.convergenceThreshold > 0 ? 1 : 0, settings.maxSamples, ["none", "samples", "variance", "pathLength", "radiance"].indexOf(settings.diagnostic ?? "none"), settings.diagnosticRadianceThreshold ?? 10, settings.maxBounces, 0, 0, p[10], p[14], frame.output.logDepthCoefficient, 1 / p[5], m[0], m[1], m[2], 0, m[4], m[5], m[6], 0, -m[8], -m[9], -m[10], 0]);
      device.queue.writeBuffer(buffers[3], 0, values);
      if (samplingPending || !settings.denoise || settings.diagnostic && settings.diagnostic !== "none" || revision === filteredRevision) return;
      for (let i = 0; i < 3; i++) {
        values[28] = 1 << i;
        values[29] = settings.aperture > 0 ? 1 : 0;
        device.queue.writeBuffer(buffers[i], 0, values);
        const pass = frame.encoder.beginRenderPass({ label: `path denoise ${1 << i}`, colorAttachments: [{ view: views[i === 2 ? 6 : i === 0 ? 1 - current : 3 - current], loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
        pass.setPipeline(filter);
        pass.setBindGroup(0, filterGroups[current][i]);
        pass.draw(3);
        pass.end?.();
      }
      filteredRevision = revision;
    },
    present(frame) {
      frame.pass.setPipeline(pipeline);
      frame.pass.setBindGroup(0, displayGroups[current][settings.denoise && filteredRevision === revision ? 1 : 0]);
      frame.pass.draw(3);
    },
    dispose
  };
}

// ../sdk-oct2/src/viewing/techniques/pathTracing/shared/domainSampling.ts
var DOMAIN_SAMPLING_GLSL = `
int pathLightingDomain=0;
vec3 domainEnvironment(vec3 d) {
  if(pathLightingDomain==0)return environmentRadiance(d);
  return domainRecord(pathLightingDomain+1).rgb+environmentRadiance(d)*domainRecord(pathLightingDomain).z;
}
LightSample sampleDomainLight(vec3 p) {
  vec4 header=domainRecord(pathLightingDomain);int count=int(header.y);
  int choice=min(count,int(random()*float(count+1)));float pdf=1.0/float(count+1);
  if(choice==count){vec3 d=sampleEnvironment();return LightSample(d,domainEnvironment(d),environmentPDF(d)*pdf,1e30,false);}
  int address=int(domainRecord(int(header.x)+choice).x);
  vec4 position=domainRecord(address),direction=domainRecord(address+1),color=domainRecord(address+2);
  vec3 d=-direction.xyz;float distance=1e30;float attenuation=1.0;
  if(position.w>.5){
    vec3 delta=position.xyz-p;distance=max(length(delta),1e-6);d=delta/distance;attenuation=1.0/(distance*distance);
    if(direction.w>0.0)attenuation*=pow(max(1.0-pow(distance/direction.w,4.0),0.0),2.0);
    if(position.w>1.5)attenuation*=smoothstep(color.w,domainRecord(address+3).x,dot(-d,direction.xyz));
  }
  return LightSample(d,color.rgb*attenuation,pdf,distance,true);
}
`;
var DOMAIN_SAMPLING_WGSL = `
var<private> pathLightingDomain:i32=0;
fn domainEnvironment(d:vec3f)->vec3f {
  if(pathLightingDomain==0){return environmentRadiance(d);}
  return materials[pathLightingDomain+1].rgb+environmentRadiance(d)*materials[pathLightingDomain].z;
}
fn sampleDomainLight(p:vec3f)->LightSample {
  let header=materials[pathLightingDomain];let count=i32(header.y);
  let choice=min(count,i32(random()*f32(count+1)));let pdf=1.0/f32(count+1);
  if(choice==count){let d=sampleEnvironment();return LightSample(d,domainEnvironment(d),environmentPDF(d)*pdf,1e30,false);}
  let address=i32(materials[i32(header.x)+choice].x);
  let position=materials[address];let direction=materials[address+1];let color=materials[address+2];
  var d=-direction.xyz;var distance=1e30;var attenuation=1.0;
  if(position.w>.5){
    let delta=position.xyz-p;distance=max(length(delta),1e-6);d=delta/distance;attenuation=1.0/(distance*distance);
    if(direction.w>0.0){attenuation*=pow(max(1.0-pow(distance/direction.w,4.0),0.0),2.0);}
    if(position.w>1.5){attenuation*=smoothstep(color.w,materials[address+3].x,dot(-d,direction.xyz));}
  }
  return LightSample(d,color.rgb*attenuation,pdf,distance,true);
}
`;

// ../sdk-oct2/src/viewing/techniques/pathTracing/shared/bsdf.ts
var bsdfWGSL = (
  /* wgsl */
  `
var<private> rng:u32;
var<private> lobeMask:vec3f=vec3f(1);
fn random()->f32 {
  rng=rng*747796405u+2891336453u;
  let word=((rng>>((rng>>28u)+4u))^rng)*277803737u;
  return f32(((word>>22u)^word)>>8u)*(1.0/16777216.0);
}
fn basis(n:vec3f)->mat3x3f {
  let t=normalize(cross(select(vec3f(1,0,0),vec3f(0,1,0),abs(n.y)<.9),n));
  return mat3x3f(t,cross(n,t),n);
}
fn finiteColor(value:vec3f)->bool {return all((bitcast<vec3u>(value)&vec3u(0x7f800000u))!=vec3u(0x7f800000u));}
fn powerWeight(a:f32,b:f32)->f32 {
  // PDFs are densities, not probabilities: smooth lobes can exceed 1e20.
  let scale=max(a,b);if(scale<=0){return 0;}
  let x=a/scale;let y=b/scale;return x*x/(x*x+y*y);
}
// Algebraically f*cos*w_light/p_light, with the common PDF scale cancelled
// before multiplying HDR emission. A finite result must not overflow f * Li.
fn directWeight(f:vec3f,cosine:f32,lightPdf:f32,bsdfPdf:f32,delta:bool)->vec3f {
  if(lightPdf<=0||bsdfPdf<=0){return vec3f(0);}
  if(delta){return (f/lightPdf)*cosine;}
  let scale=max(lightPdf,bsdfPdf);let a=lightPdf/scale;let b=bsdfPdf/scale;
  return (f/bsdfPdf)*(cosine*(a*b/(a*a+b*b)));
}
fn hasContinuousBSDF(m:Material,eta:f32,thin:bool)->bool {
  let substrate=(1.0-m.metallic)*(1.0-m.transmission);
  if(substrate*lobeMask.x>0){return true;}
  if(m.roughness<.001){return false;}
  let glass=(1.0-m.metallic)*m.transmission;
  return (m.metallic*lobeMask.y>0)||(eta!=1.0&&(substrate*lobeMask.y>0||(glass>0&&(lobeMask.y>0||lobeMask.z>0))));
}
fn dielectric(c:f32,eta:f32)->f32 {
  if(eta==1.0){return 0;}
  let cosine=clamp(c,0.0,1.0);
  let sin2=max(0.0,1.0-cosine*cosine)/(eta*eta);if(sin2>=1){return 1;}
  let ct=sqrt(1.0-sin2);let rs=(cosine-eta*ct)/(cosine+eta*ct);let rp=(eta*cosine-ct)/(eta*cosine+ct);
  return .5*(rs*rs+rp*rp);
}
fn distribution(n:vec3f,h:vec3f,a:f32)->f32 {
  // The cross product retains small angles when dot(n,h) has rounded to one.
  let tangent=cross(n,h);let cosine=dot(n,h);
  let d=dot(tangent,tangent)+cosine*cosine*a*a;return a*a/(PI*d*d);
}
fn masking(c:f32,a:f32)->f32 {return 2.0*c/max(c+sqrt(a*a+(1.0-a*a)*c*c),1e-20);}
fn visibleNormal(wo:vec3f,n:vec3f,a:f32)->vec3f {
  let frame=basis(n);let local=transpose(frame)*wo;
  let view=normalize(vec3f(a*local.xy,local.z));
  let length2=dot(view.xy,view.xy);var tangent=vec3f(1,0,0);
  if(length2>0){tangent=vec3f(-view.y,view.x,0)/sqrt(length2);}
  let bitangent=cross(view,tangent);
  let radius=sqrt(random());let phi=2.0*PI*random();let x=radius*cos(phi);
  let blend=.5*(1.0+view.z);
  let y=mix(sqrt(max(0.0,1.0-x*x)),radius*sin(phi),blend);
  let hemisphere=tangent*x+bitangent*y+view*sqrt(max(0.0,1.0-x*x-y*y));
  return normalize(frame*normalize(vec3f(a*hemisphere.xy,max(hemisphere.z,0.0))));
}
struct BSDF {f:vec3f,pdf:f32}
struct Scatter {direction:vec3f,weight:vec3f,pdf:f32,delta:bool,transmitted:bool,diffuse:bool}
fn glassF(c:f32,eta:f32,thin:bool)->f32 {let f=dielectric(c,eta);return select(f,2.0*f/(1.0+f),thin);}
fn evaluateBSDF(m:Material,wo:vec3f,wi:vec3f,n:vec3f,eta:f32,thin:bool)->BSDF {
  let no=dot(n,wo);let ni=dot(n,wi);if(no<=0||abs(ni)<1e-7){return BSDF(vec3f(0),0);}
  let metal=m.metallic;let glass=(1.0-metal)*m.transmission;let diffuse=(1.0-metal)*(1.0-m.transmission);
  let a=max(m.roughness*m.roughness,.0001);
  // Index-matched transmission is a delta event even on a rough interface.
  if(ni<0&&eta==1.0){return BSDF(vec3f(0),0);}
  var halfVector=wo+wi;if(ni<0){halfVector=wo+select(wi*eta,-wi,thin);}
  if(dot(halfVector,halfVector)<1e-20){return BSDF(vec3f(0),0);}
  var h=normalize(halfVector);
  if(dot(h,n)<0){h=-h;}
  let oh=dot(wo,h);let ih=dot(wi,h);if(oh<=0){return BSDF(vec3f(0),0);}
  let d=distribution(n,h,a);let g1=masking(no,a);let g=g1*masking(abs(ni),a);
  let halfPdf=d*g1*oh/no;
  let f=glassF(oh,eta,thin);
  if(ni>0){
    let specular=(metal*fresnel(m.albedo,oh)+vec3f(diffuse*dielectric(oh,eta)+glass*f))*lobeMask.y;
    let fd=lobeMask.x*diffuse*(1.0-dielectric(no,eta))*(1.0-dielectric(ni,eta))*m.albedo/PI;
    if(m.roughness<.001){return BSDF(fd,lobeMask.x*diffuse*.5*ni/PI);}
    return BSDF(fd+specular*d*g/(4.0*no*ni),lobeMask.x*diffuse*.5*ni/PI+lobeMask.y*(metal+diffuse*.5+glass*f)*halfPdf/(4.0*oh));
  }
  if(glass<=0||m.roughness<.001||lobeMask.z<.5){return BSDF(vec3f(0),0);}
  if(thin){return BSDF(glass*(1.0-f)*m.albedo*d*g/(4.0*no*abs(ni)),glass*(1.0-f)*halfPdf/(4.0*oh));}
  if(ih>=0){return BSDF(vec3f(0),0);}
  let denominator=oh+eta*ih;
  let jacobian=eta*eta*abs(ih)/max(denominator*denominator,1e-30);
  return BSDF(vec3f(glass*(1.0-f)*d*g*abs(ih*oh)/max(no*abs(ni)*denominator*denominator,1e-30)),
    glass*(1.0-f)*halfPdf*jacobian);
}
fn sampleBSDF(m:Material,wo:vec3f,n:vec3f,eta:f32,thin:bool)->Scatter {
  if(dot(wo,n)<=0){return Scatter(vec3f(0),vec3f(0),0,false,false,false);}
  let metal=m.metallic;let glass=(1.0-metal)*m.transmission;let diffuse=(1.0-metal)*(1.0-m.transmission);
  let choice=random();var wi:vec3f;var transmitted=false;var isDiffuse=false;
  let chooseDiffuse=choice>=metal+glass+diffuse*.5;
  if(chooseDiffuse){
    if(lobeMask.x<.5){return Scatter(vec3f(0),vec3f(0),0,false,false,false);}
    let r=sqrt(random());let phi=2.0*PI*random();wi=basis(n)*vec3f(r*cos(phi),r*sin(phi),sqrt(max(0.0,1.0-r*r)));isDiffuse=true;
  }else{
    let a=max(m.roughness*m.roughness,.0001);var h=visibleNormal(wo,n,a);
    let chooseGlass=choice>=metal&&choice<metal+glass;
    if(chooseGlass&&eta==1.0){
      return Scatter(-wo,select(vec3f(1),m.albedo,thin)*lobeMask.z,0,true,true,false);
    }
    let delta=m.roughness<.001;
    if(delta){h=n;}
    let oh=dot(wo,h);if(oh<=0){return Scatter(vec3f(0),vec3f(0),0,false,false,false);}
    var reflectEvent=true;
    if(chooseGlass){reflectEvent=random()<glassF(oh,eta,thin);}
    wi=reflect(-wo,h);
    if(!reflectEvent){wi=select(refract(-wo,h,1.0/eta),-wi,thin);transmitted=true;}
    if(dot(wi,wi)<1e-10||((dot(wi,n)<0)!=transmitted)){return Scatter(vec3f(0),vec3f(0),0,false,false,false);}
    if(select(lobeMask.y,lobeMask.z,transmitted)<.5){return Scatter(vec3f(0),vec3f(0),0,false,false,false);}
    if(delta){
      var weight=vec3f(1);if(choice<metal){weight=fresnel(m.albedo,oh);}else if(!chooseGlass){weight=vec3f(2.0*dielectric(oh,eta));}else if(transmitted){weight=select(vec3f(1.0/(eta*eta)),m.albedo,thin);}
      return Scatter(wi,weight,0,true,transmitted,false);
    }
  }
  let value=evaluateBSDF(m,wo,wi,n,eta,thin);
  return Scatter(wi,value.f*abs(dot(n,wi))/max(value.pdf,1e-30),value.pdf,false,transmitted,isDiffuse);
}
`
);

// ../sdk-oct2/src/viewing/techniques/pathTracing/shared/lightSelection.ts
function lightSelectionTable(power) {
  const count = power.length;
  if (count < 1 || count > 16777216) throw new Error("Invalid path light count.");
  let maximum = 0;
  for (let i = 0; i < count; i++) {
    if (!Number.isFinite(power[i]) || power[i] < 0) throw new Error("Invalid path light power.");
    maximum = Math.max(maximum, power[i]);
  }
  let total = 0;
  if (maximum > 0) for (let i = 0; i < count; i++) total += power[i] / maximum;
  const table = new Float32Array(count * 4), scaled = new Float64Array(count);
  const small = [], large = [];
  for (let i = 0; i < count; i++) {
    const probability = total > 0 ? 0.99 * (power[i] / maximum) / total + 0.01 / count : 1 / count;
    table[i * 4] = probability;
    table[i * 4 + 2] = i;
    scaled[i] = probability * count;
    (scaled[i] < 1 ? small : large).push(i);
  }
  while (small.length && large.length) {
    const low = small.pop(), high = large.pop();
    table[low * 4 + 1] = scaled[low];
    table[low * 4 + 2] = high;
    scaled[high] += scaled[low] - 1;
    (scaled[high] < 1 ? small : large).push(high);
  }
  for (const i of small) table[i * 4 + 1] = 1;
  for (const i of large) table[i * 4 + 1] = 1;
  const actual = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    actual[i] += table[i * 4 + 1] / count;
    actual[table[i * 4 + 2]] += (1 - table[i * 4 + 1]) / count;
  }
  for (let i = 0; i < count; i++) table[i * 4] = actual[i];
  return table;
}
var lightSelectionWGSL = (
  /* wgsl */
  `
fn lightSelectionPDF(index:i32)->f32 {return lightRow(index,5).x;}
fn selectLight(count:i32)->i32 {
  let column=min(i32(random()*f32(count)),count-1);
  let record=lightRow(column,5);
  return select(i32(record.z),column,random()<record.y);
}
`
);

// ../sdk-oct2/src/viewing/techniques/pathTracing/webGPU/shaders.ts
function pathTransportShader(sharedCount, instanced, declarations, extraUniforms = "", rayLimit, thinShadowTransmission = false, primarySun = true) {
  let core = createShaderSource(sharedCount, instanced, false, false, false, true);
  core = core.replace("skyLight: vec4f,", "skyLight: vec4f, accumulation:vec4f, path:vec4f, limits:vec4f, convergence:vec4f, lighting:vec4f, lens:vec4f," + extraUniforms);
  core = core.replace("clamp(factors.y*mr.g,0.045,1.0)", "clamp(factors.y*mr.g,0.0,1.0)");
  core = core.replace(/  if \(materials\[hit.mesh\*2\+1\].x>0.5\) \{[\s\S]*?\n  }/, "");
  const source = core + bsdfWGSL + samplingWGSL + /* wgsl */
  `
${declarations}
var<private> pathLength:f32;
fn lightRow(index:i32,row:i32)->vec4f {let p=index*6+row;return textureLoad(lightTable,vec2i(p%1024,p/1024),0);}
${lightSelectionWGSL}
fn environmentCell(index:i32)->vec4f {let size=textureDimensions(environmentTable);return textureLoad(environmentTable,vec2i(index%i32(size.x),index/i32(size.x)),0);}
fn environmentFrame()->mat3x3f {
  let up=normalize(u.worldUp.xyz);let reference=select(vec3f(0,1,0),vec3f(1,0,0),abs(up.x)<.9);
  let east=normalize(cross(up,reference));return mat3x3f(cross(east,up),up,east);
}
fn toEnvironment(d:vec3f)->vec3f {
  let v=transpose(environmentFrame())*d;let a=u.lighting.y;
  return vec3f(cos(a)*v.x+sin(a)*v.z,v.y,-sin(a)*v.x+cos(a)*v.z);
}
fn fromEnvironment(d:vec3f)->vec3f {
  let a=-u.lighting.y;let v=vec3f(cos(a)*d.x+sin(a)*d.z,d.y,-sin(a)*d.x+cos(a)*d.z);
  return environmentFrame()*v;
}
fn environmentIndex(d:vec3f)->i32 {
  let v=toEnvironment(d);let size=textureDimensions(environmentTable);
  let uv=vec2f(atan2(v.z,v.x)/(2.0*PI)+.5,acos(clamp(v.y,-1.0,1.0))/PI);
  let p=min(vec2u(uv*vec2f(size)),size-vec2u(1));return i32(p.y*size.x+p.x);
}
fn environmentPDF(d:vec3f)->f32 {
  if(u.lighting.w<.5){return 1.0/(4.0*PI);}
  let size=textureDimensions(environmentTable);let index=environmentIndex(d);let y=index/i32(size.x);
  var previous=0.0;if(index>0){previous=environmentCell(index-1).w;}
  let area=2.0*PI/f32(size.x)*(cos(PI*f32(y)/f32(size.y))-cos(PI*f32(y+1)/f32(size.y)));
  return max(0.0,environmentCell(index).w-previous)/max(area,1e-20);
}
// Filter radiance only. The CDF and its solid-angle PDF remain discrete;
// MIS uses the actual proposal PDF even though radiance is reconstructed smoothly.
fn environmentTexel(p:vec2i)->vec3f {
  let size=vec2i(textureDimensions(environmentTable));
  let q=vec2i((p.x%size.x+size.x)%size.x,clamp(p.y,0,size.y-1));
  return textureLoad(environmentTable,q,0).rgb;
}
fn filteredEnvironment(d:vec3f)->vec3f {
  let v=toEnvironment(d);let size=vec2f(textureDimensions(environmentTable));
  let uv=vec2f(atan2(v.z,v.x)/(2.0*PI)+.5,acos(clamp(v.y,-1.0,1.0))/PI);
  let p=uv*size-vec2f(.5);let base=vec2i(floor(p));let f=fract(p);
  return mix(mix(environmentTexel(base),environmentTexel(base+vec2i(1,0)),f.x),
    mix(environmentTexel(base+vec2i(0,1)),environmentTexel(base+vec2i(1,1)),f.x),f.y);
}
fn environmentRadiance(d:vec3f)->vec3f {
  if(u.environment.x<.5){return vec3f(0);}
  if(u.lighting.w>.5){return filteredEnvironment(d)*u.environment.y*u.lighting.x;}
  return textureSampleLevel(environmentMap,environmentSampler,environmentFrame()*toEnvironment(d),0).rgb*u.environment.y*u.lighting.x;
}
fn sampleEnvironment()->vec3f {
  if(u.lighting.w<.5){let z=1.0-2.0*random();let phi=2.0*PI*random();return vec3f(sqrt(1.0-z*z)*cos(phi),z,sqrt(1.0-z*z)*sin(phi));}
  let size=textureDimensions(environmentTable);var lo=0;var hi=i32(size.x*size.y)-1;let r=random();
  loop{if(lo>=hi){break;}let mid=(lo+hi)/2;if(environmentCell(mid).w<r){lo=mid+1;}else{hi=mid;}}
  let x=lo%i32(size.x);let y=lo/i32(size.x);
  let phi=2.0*PI*((f32(x)+random())/f32(size.x)-.5);
  let cosine=mix(cos(PI*f32(y)/f32(size.y)),cos(PI*f32(y+1)/f32(size.y)),random());
  return fromEnvironment(vec3f(sqrt(max(0.0,1.0-cosine*cosine))*cos(phi),cosine,sqrt(max(0.0,1.0-cosine*cosine))*sin(phi)));
}
fn offsetOrigin(p:vec3f,g:vec3f,d:vec3f)->vec3f {
  // RTC keeps positions small; retain several float ULPs at larger local scales.
  let epsilon=max(1e-5,2e-7*max(abs(p.x),max(abs(p.y),abs(p.z))));
  return p+g*select(-epsilon,epsilon,dot(g,d)>0);
}
struct AreaHit {t:f32,radiance:vec3f,pdf:f32}
fn analyticAreaHit(ro:vec3f,rd:vec3f,limit:f32)->AreaHit {
  var result=AreaHit(limit,vec3f(0),0);
  if(pathLightingDomain>0){return result;}
  for(var i=0;i<i32(u.lens.z);i++){
    let a=lightRow(i,0);let b=lightRow(i,1);if(a.w>.5||b.w>=0){continue;}let c=lightRow(i,2);
    let q=cross(rd,c.xyz);let determinant=dot(b.xyz,q);if(abs(determinant)<1e-12){continue;}
    let s=ro-a.xyz;let uBary=dot(s,q)/determinant;if(uBary<0||uBary>1){continue;}
    let r=cross(s,b.xyz);let vBary=dot(rd,r)/determinant;if(vBary<0||uBary+vBary>1){continue;}
    let t=dot(c.xyz,r)/determinant;if(t<=1e-6||t>=result.t){continue;}
    let info=lightRow(i,4);result=AreaHit(t,lightRow(i,3).rgb,lightSelectionPDF(i)*t*t/max(info.w*abs(dot(info.xyz,rd)),1e-20));
  }
  return result;
}
fn visibility(ro:vec3f,rd:vec3f,distance:f32)->${thinShadowTransmission ? "vec3f" : "f32"} {
  if(analyticAreaHit(ro,rd,distance).t<distance){return ${thinShadowTransmission ? "vec3f(0)" : "0"};}
  if(u.limits.w>.5){return ${thinShadowTransmission ? "vec3f(" : ""}select(1.0,0.0,trace(ro,rd,distance,true,1e-6).mesh>=0)${thinShadowTransmission ? ")" : ""};}
  var transmittance=${thinShadowTransmission ? "vec3f(1)" : "1.0"};var minT=1e-6;
  for(var i=0;i<256;i++){
    let hit=trace(ro,rd,distance,false,minT);if(hit.mesh<0){return transmittance;}
    ${thinShadowTransmission ? `let p=ro+rd*hit.t;let m=surfaceMaterial(hit,p);let opacity=surfaceOpacity(hit,p);
    transmittance*=vec3f(1.0-opacity)+opacity*m.transmission*(1.0-m.metallic)*m.transmissionTint*(vec3f(1)-m.f0);` : `transmittance*=1.0-surfaceOpacity(hit,ro+rd*hit.t);`}
    if(${thinShadowTransmission ? "strength(transmittance)" : "transmittance"}<=0){return ${thinShadowTransmission ? "vec3f(0)" : "0"};}minT=hit.t+max(1e-6,abs(hit.t)*1e-6);
  }
  return ${thinShadowTransmission ? "vec3f(0)" : "0"};
}
struct LightSample {direction:vec3f,radiance:vec3f,pdf:f32,distance:f32,delta:bool}
${DOMAIN_SAMPLING_WGSL}
fn sampleLight(p:vec3f)->LightSample {
  if(pathLightingDomain>0){return sampleDomainLight(p);}
  let count=i32(u.path.w);let choice=selectLight(count+1);let selectPdf=lightSelectionPDF(choice);
  if(choice==count){let d=sampleEnvironment();return LightSample(d,environmentRadiance(d),environmentPDF(d)*selectPdf,1e30,false);}
  let a=lightRow(choice,0);let b=lightRow(choice,1);let c=lightRow(choice,2);let emission=lightRow(choice,3);let info=lightRow(choice,4);
  if(a.w>1.5){let delta=a.xyz-p;let distance=max(length(delta),1e-6);return LightSample(delta/distance,emission.rgb/(distance*distance),selectPdf,distance,true);}
  if(a.w>.5){
    let radius=u.lighting.z;let cosine=cos(radius);var d=a.xyz;
    if(radius>0){let z=mix(cosine,1.0,random());let phi=2.0*PI*random();d=basis(d)*vec3f(sqrt(1.0-z*z)*cos(phi),sqrt(1.0-z*z)*sin(phi),z);}
    let solidAngle=select(4.0*PI*pow(sin(radius*.5),2.0),1.0,radius<=0);
    // A directional light stores irradiance; a finite sun disk stores its matching radiance.
    if(radius>0){return LightSample(d,sunRadiance(d),sunPDF(d),1e30,false);}
    return LightSample(d,emission.rgb,selectPdf,1e30,true);
  }
  let r=sqrt(random());let bary=vec2f(1.0-r,random()*r);let point=a.xyz+b.xyz*bary.x+c.xyz*bary.y;
  let delta=point-p;let distance=length(delta);let d=delta/distance;let cosLight=abs(dot(info.xyz,d));
  var radiance=emission.rgb;
  if(b.w>=0){
    let fake=Hit(distance,info.xyz,bary,i32(triangles[i32(c.w)+1].w)-1,i32(b.w),i32(c.w),(i32(triangles[i32(c.w)+2].w)-1)*select(2,10,emission.w<0),i32(emission.w));
    var clipPoint=point;
    if(fake.instance>=0){let v=vec4f(point,1);clipPoint=vec3f(dot(instanceData(fake.instance,0),v),dot(instanceData(fake.instance,1),v),dot(instanceData(fake.instance,2),v));}
    if(i32(materials[fake.mesh*2+1].w)!=pathLightingDomain){radiance=vec3f(0);}
    if(clipBoxContains(fake.mesh,clipPoint)){radiance*=sampleMap(fake,3,point,info.xyz).rgb*surfaceOpacity(fake,point);}
    else{radiance=vec3f(0);}
  }
  return LightSample(d,radiance,selectPdf*distance*distance/max(info.w*cosLight,1e-20),distance,false);
}
fn emissionPDF(hit:Hit,ro:vec3f,rd:vec3f)->f32 {
  var lo=i32(u.lens.z);var hi=i32(u.path.w);
  loop{
    if(lo>=hi){break;}let mid=lo+(hi-lo)/2;
    let triangle=i32(lightRow(mid,2).w);let instance=i32(lightRow(mid,3).w);
    if(instance<hit.instance||(instance==hit.instance&&triangle<hit.triangle)){lo=mid+1;}else{hi=mid;}
  }
  if(lo<i32(u.path.w)&&i32(lightRow(lo,3).w)==hit.instance&&i32(lightRow(lo,2).w)==hit.triangle&&i32(lightRow(lo,1).w)==hit.mesh){
    let info=lightRow(lo,4);return hit.t*hit.t/max(info.w*abs(dot(info.xyz,rd)),1e-20)*lightSelectionPDF(lo);
  }
  return 0.0;
}
fn sunRadiance(d:vec3f)->vec3f {
  var result=vec3f(0);let radius=u.lighting.z;if(radius<=0){return result;}
  for(var i=0;i<i32(u.lens.z);i++){let a=lightRow(i,0);if(a.w>.5&&a.w<1.5&&dot(d,a.xyz)>=cos(radius)){result+=lightRow(i,3).rgb/(4.0*PI*pow(sin(radius*.5),2.0));}}
  return result;
}
fn sunPDF(d:vec3f)->f32 {
  var result=0.0;let radius=u.lighting.z;if(radius<=0){return result;}
  for(var i=0;i<i32(u.lens.z);i++){let a=lightRow(i,0);if(a.w>.5&&a.w<1.5&&dot(d,a.xyz)>=cos(radius)){result+=lightSelectionPDF(i)/(4.0*PI*pow(sin(radius*.5),2.0));}}
  return result;
}
fn pathRadiance(origin:vec3f,direction:vec3f)->vec3f {
  pathLength=0; pathLightingDomain=0; lightingTraceDomain=${rayLimit ? "0" : "-1"};
  var ro=origin;var rd=direction;var throughput=vec3f(1);var result=vec3f(0);var lastPdf=0.0;var lastDelta=true;
  var mediumEta:array<f32,32>;var mediumAbsorption:array<vec3f,32>;var media=0;var etaCompensation=1.0;
  var diffuseDepth=0;var specularDepth=0;var transmissionDepth=0;
  var depth=0;var skips=0;var lastPoint=origin;
  loop{
    if(depth>i32(u.path.x)){break;}
    let viewDistance=dot(ro-u.eye.xyz,u.forward.xyz);
    let near=${rayLimit ? "1e-6" : "select(1e-6,max(1e-6,(u.clip.x-viewDistance)/max(dot(rd,u.forward.xyz),1e-6)),depth==0)"};
    let limit=${rayLimit ?? "select(1e30,(u.clip.y-viewDistance)/max(dot(rd,u.forward.xyz),1e-6),depth==0)"};
    let hit=trace(ro,rd,limit,false,near);lightingTraceDomain=-1;pathLength+=1;
    let area=analyticAreaHit(ro,rd,hit.t);
    if(area.t<hit.t){
      if(media>0){throughput*=exp(-mediumAbsorption[media-1]*area.t);}
      result+=throughput*area.radiance*select(powerWeight(lastPdf,area.pdf),1.0,lastDelta);break;
    }
    if(hit.mesh<0){
      let env=domainEnvironment(rd);var sun=${primarySun ? "sunRadiance(rd)" : "select(vec3f(0),sunRadiance(rd),depth>0)"};
      var envPdf=environmentPDF(rd)*lightSelectionPDF(i32(u.path.w));var lightPdf=sunPDF(rd);
      if(pathLightingDomain>0){envPdf=environmentPDF(rd)/(materials[pathLightingDomain].y+1.0);sun=vec3f(0);lightPdf=0;}
      result+=throughput*(env*select(powerWeight(lastPdf,envPdf),1.0,lastDelta)+sun*select(powerWeight(lastPdf,lightPdf),1.0,lastDelta));break;
    }
    let p=ro+rd*hit.t;let g=hit.geometricNormal;
    if(media>0){throughput*=exp(-mediumAbsorption[media-1]*hit.t);}
    let opacity=surfaceOpacity(hit,p);
    if(random()>=opacity){ro=offsetOrigin(p,g,rd);skips++;if(skips>256){break;}continue;}
    skips=0;
    let previousDomain=pathLightingDomain;pathLightingDomain=i32(materials[hit.mesh*2+1].w);
    let m=surfaceMaterial(hit,p);
    if(strength(m.emission)>0){
      var mis=1.0;if(!lastDelta && previousDomain==0 && pathLightingDomain==0){mis=powerWeight(lastPdf,emissionPDF(Hit(length(p-lastPoint),hit.geometricNormal,hit.uv,hit.normals,hit.mesh,hit.triangle,hit.texcoords,hit.instance),lastPoint,rd));}
      result+=throughput*(m.emission*mis);
    }
    if(depth>=i32(u.path.x)){break;}
    let outward=normalize(instanceNormal(hit.instance,cross(triangles[hit.triangle+1].xyz,triangles[hit.triangle+2].xyz)));
    let entering=dot(rd,outward)<0;
    let ior=max(1.0,pbr[hit.mesh*6].z);let thin=pbr[hit.mesh*6+4].y<=0;
    var etaI=1.0;var etaT=ior;if(media>0){etaI=mediumEta[media-1];}
    if(!entering&&!thin){etaT=1.0;if(media>1){etaT=mediumEta[media-2];}if(media==0){etaI=ior;}}
    let eta=etaT/etaI;let n=mappedNormal(hit,p,shadingNormal(hit,rd),rd);let wo=-rd;
    lobeMask=vec3f(select(0.0,1.0,diffuseDepth<i32(u.limits.x)),select(0.0,1.0,specularDepth<i32(u.limits.y)),select(0.0,1.0,transmissionDepth<i32(u.limits.z)));
    if(hasContinuousBSDF(m,eta,thin)){
      let light=sampleLight(p);
      if(light.pdf>0&&strength(light.radiance)>0&&dot(g,light.direction)*dot(n,light.direction)>0){
        let bsdf=evaluateBSDF(m,wo,light.direction,n,eta,thin);
        let weight=directWeight(bsdf.f,abs(dot(n,light.direction)),light.pdf,bsdf.pdf,light.delta);
        if(strength(weight)>0){
          lightingTraceDomain=pathLightingDomain;
          let vis=visibility(offsetOrigin(p,g,light.direction),light.direction,light.distance-max(1e-5,light.distance*1e-6));
          lightingTraceDomain=-1;
          result+=throughput*(weight*vis)*light.radiance;
        }
      }
    }
    let scatter=sampleBSDF(m,wo,n,eta,thin);
    if(strength(scatter.weight)<=0||dot(g,scatter.direction)*dot(n,scatter.direction)<=0){break;}
    if(scatter.transmitted){transmissionDepth++;if(transmissionDepth>i32(u.limits.z)){break;}}
    else if(scatter.diffuse){diffuseDepth++;if(diffuseDepth>i32(u.limits.x)){break;}}
    else{specularDepth++;if(specularDepth>i32(u.limits.y)){break;}}
    throughput*=scatter.weight;
    if(scatter.transmitted&&!thin){
      etaCompensation*=eta*eta;
      if(entering){if(media==32){break;}mediumEta[media]=ior;mediumAbsorption[media]=-log(max(pbr[hit.mesh*6+5].rgb,vec3f(1e-6)))*pbr[hit.mesh*6+4].z;media++;}
      else if(media>0){media--;}
    }
    if(depth+1>=i32(u.path.y)){
      let survive=clamp(strength(throughput)*etaCompensation,.05,.95);if(random()>=survive){break;}throughput/=survive;
    }
    lightingTraceDomain=select(-1,pathLightingDomain,scatter.diffuse);
    lastPdf=scatter.pdf;lastDelta=scatter.delta;lastPoint=p;ro=offsetOrigin(p,g,scatter.direction);rd=scatter.direction;depth++;
  }
  lightingTraceDomain=-1;
  return result;
}
`;
  if (!rayLimit) return source;
  return source.replace("var<private> lightingTraceDomain:i32 = -1;", "const lightingTraceDomain:i32 = 0;").replace("var<private> pathLightingDomain:i32=0;", "const pathLightingDomain:i32=0;").replace("pathLightingDomain=0;", "").replace("let previousDomain=pathLightingDomain;pathLightingDomain=i32(materials[hit.mesh*2+1].w);", "let previousDomain=0;").replace(/lightingTraceDomain=(?:0|-1|pathLightingDomain|select\(-1,pathLightingDomain,scatter.diffuse\));/g, "");
}
function pathShader(sharedCount, instanced) {
  const binding = 16 + sharedCount * 2;
  return pathTransportShader(sharedCount, instanced, `@group(0) @binding(${binding}) var history:texture_2d<f32>;
@group(0) @binding(${binding + 1}) var guideHistory:texture_2d<f32>;
@group(0) @binding(${binding + 2}) var lightTable:texture_2d<f32>;
@group(0) @binding(${binding + 3}) var environmentTable:texture_2d<f32>;
@group(0) @binding(${binding + 4}) var auxiliaryHistory:texture_2d<f32>;
@group(0) @binding(${binding + 5}) var auxiliaryOutput:texture_storage_2d<rgba32float,write>;
`) + /* wgsl */
  `
fn octEncode(n:vec3f)->vec2f {let v=n/(abs(n.x)+abs(n.y)+abs(n.z));return select(v.xy,(vec2f(1)-abs(v.yx))*select(vec2f(1),vec2f(-1),v.xy<vec2f(0)),v.z<0);}
@vertex fn vertexMain(@builtin(vertex_index) id:u32)->@builtin(position) vec4f{
  let p=vec2f(f32((id<<1u)&2u),f32(id&2u));return vec4f(p*2.0-vec2f(1),0,1);
}
struct Fragment {@location(0) color:vec4f,@location(1) guide:vec4f}
@fragment fn fragmentMain(@builtin(position) position:vec4f)->Fragment {
  let pixel=vec2i(position.xy);let cameraPixel=vec2f(position.x,u.resolution.y-position.y);
  var previous=vec4f(0);var guide=vec4f(0);var auxiliary=vec4f(0);
  if(u.accumulation.x>0){previous=textureLoad(history,pixel,0);guide=textureLoad(guideHistory,pixel,0);auxiliary=textureLoad(auxiliaryHistory,pixel,0);}
  let count=previous.a;
  let adaptive=u.convergence.x>.5&&u.convergence.z>0;
  let pilots=pilotSamples(count,u.convergence.y);
  // Only independent pilots decide when the radiance stream may stop.
  if(adaptive&&samplingConverged(count,guide.z,guide.w,u.convergence.y,u.convergence.z)){
    textureStore(auxiliaryOutput,pixel,auxiliary);return Fragment(previous,guide);
  }
  // Use attempted passes, so rejecting an invalid sample never repeats it forever.
  let baseSeed=u32(pixel.x)+u32(pixel.y)*u32(u.resolution.x)+bitcast<u32>(u.path.z)*1664525u+u32(u.accumulation.x)*1013904223u;
  var sampleColor=vec3f(0);var pilotMean=guide.z;var pilotM2=guide.w;var sampleLength=0.0;
  // Adaptive pilots are independent and scheduled only every fourth display
  // sample. Uniform rendering uses ordinary Welford moments without extra rays.
  let takePilot=takePilotSample(count,u.convergence.y,adaptive);
  let iterations=select(1,2,takePilot);
  // One transport call site keeps textured shader compilation bounded. The
  // independent pilot uses the same camera/lens distribution as the display.
  for(var iteration=0;iteration<iterations;iteration++){
    rng=baseSeed^select(0u,0x9e3779b9u,iteration==1);_=random();_=random();
    let jitter=vec2f(random(),random())-vec2f(.5);var ro=u.eye.xyz;var rd=cameraRay(cameraPixel+jitter);
    if(u.lens.x>0){let r=sqrt(random())*u.lens.x;let phi=2.0*PI*random();let focus=ro+rd*u.lens.y/max(dot(rd,u.forward.xyz),1e-6);
      ro+=u.right.xyz*r*cos(phi)+u.up.xyz*r*sin(phi);rd=normalize(focus-ro);}
    let radiance=pathRadiance(ro,rd);
    // Keep exceptional arithmetic out of persistent HDR history. Do not clip
    // finite highlights or allow one invalid path to poison nearby display pixels.
    if(!finiteColor(radiance)){textureStore(auxiliaryOutput,pixel,auxiliary);return Fragment(previous,guide);}
    if(iteration==0){sampleColor=radiance;sampleLength=pathLength;}
    if(iteration==1||!adaptive){
      let momentCount=select(count,pilots,adaptive);
      let luminance=dot(radiance,vec3f(.2126,.7152,.0722));
      let nextMean=pilotMean+(luminance-pilotMean)/(momentCount+1.0);
      let nextM2=pilotM2+(luminance-pilotMean)*(luminance-nextMean);
      pilotM2=select(3.402823e38,nextM2,finiteColor(vec3f(nextM2)));pilotMean=nextMean;
    }
  }
  let mean=previous.rgb+(sampleColor-previous.rgb)/(count+1.0);
  if(!finiteColor(mean)){textureStore(auxiliaryOutput,pixel,auxiliary);return Fragment(previous,guide);}
  if(count==0){
    let ray=cameraRay(cameraPixel);let forwardDistance=max(dot(ray,u.forward.xyz),1e-6);
    var minT=max(1e-6,u.clip.x/forwardDistance);let maxT=u.clip.y/forwardDistance;
    for(var layer=0;layer<128;layer++){
      let hit=trace(u.eye.xyz,ray,maxT,false,minT);if(hit.mesh<0){break;}
      let p=u.eye.xyz+ray*hit.t;
      if(surfaceOpacity(hit,p)>0){
        let m=surfaceMaterial(hit,p);let normal=octEncode(hit.geometricNormal);
        let encoded=vec2u(round((normal*.5+vec2f(.5))*4095.0));
        guide=vec4f(hit.t*forwardDistance,f32(encoded.x+encoded.y*4096u),0,0);
        // Display guides only: gamma-encoded albedo, roughness, transmission and metallic.
        // Transport continues using the full authored material precision.
        let rgb=vec3u(round(pow(clamp(m.albedo,vec3f(0),vec3f(1)),vec3f(1.0/2.2))*255.0));
        auxiliary.x=f32(rgb.x+rgb.y*256u+rgb.z*65536u);
        auxiliary.y=f32(u32(round(m.roughness*255.0))+u32(round(m.transmission*255.0))*256u+u32(round(m.metallic*127.0))*65536u+select(0u,8388608u,mapBinding(hit.mesh,2)>=0));
        break;
      }
      minT=hit.t+max(1e-6,abs(hit.t)*1e-6);
    }
  }
  auxiliary.z+=(sampleLength-auxiliary.z)/(count+1.0);
  auxiliary.w=max(auxiliary.w,dot(sampleColor,vec3f(.2126,.7152,.0722)));
  textureStore(auxiliaryOutput,pixel,auxiliary);
  return Fragment(vec4f(mean,count+1.0),vec4f(guide.xy,pilotMean,max(pilotM2,0.0)));
}
`;
}

// ../sdk-oct2/src/viewing/techniques/pathTracing/shared/settings.ts
var base = {
  maxSamples: 256,
  minSamples: 32,
  maxBounces: 6,
  diffuseBounces: 6,
  specularBounces: 6,
  transmissionBounces: 6,
  diagnostic: "none",
  diagnosticRadianceThreshold: 10,
  rouletteStart: 3,
  adaptive: true,
  convergenceThreshold: 0.02,
  denoise: true,
  seed: 1,
  exposure: 1,
  toneMapping: "aces",
  environmentIntensity: 1,
  environmentRotation: 0,
  sunAngularDiameter: 0.533,
  whiteBalance: [1, 1, 1],
  aperture: 0,
  focusDistance: 10
};
function pathTracingPreset(preset = "high") {
  const [samples, bounces, roulette] = { preview: [32, 3, 2], high: [256, 6, 3], ultra: [1024, 10, 4], final: [4096, 16, 5], custom: [256, 6, 3] }[preset];
  return {
    ...base,
    whiteBalance: [1, 1, 1],
    maxSamples: samples,
    maxBounces: bounces,
    diffuseBounces: bounces,
    specularBounces: bounces,
    transmissionBounces: bounces,
    rouletteStart: roulette,
    adaptive: preset !== "preview"
  };
}
function validatePathTracingSettings(s) {
  if (s.diagnostic !== void 0 && !["none", "samples", "variance", "pathLength", "radiance"].includes(s.diagnostic)) throw new Error("Invalid path tracing diagnostic");
  if (s.diagnosticRadianceThreshold !== void 0 && (!Number.isFinite(s.diagnosticRadianceThreshold) || s.diagnosticRadianceThreshold <= 0)) throw new Error("Invalid path tracing diagnostic threshold");
  for (const key of ["adaptive", "denoise"]) if (typeof s[key] !== "boolean") throw new Error(`Invalid path tracing ${key}`);
  for (const key of ["maxSamples", "minSamples", "maxBounces", "diffuseBounces", "specularBounces", "transmissionBounces", "rouletteStart", "seed"])
    if (!Number.isSafeInteger(s[key]) || s[key] < (key === "seed" ? 0 : 1) || s[key] > (key.includes("Samples") ? 16777216 : key === "seed" ? 4294967295 : 1024)) throw new Error(`Invalid path tracing ${key}`);
  if (s.minSamples > s.maxSamples) throw new Error("Minimum samples must not exceed maximum samples.");
  for (const key of ["convergenceThreshold", "exposure", "environmentIntensity", "sunAngularDiameter", "aperture", "focusDistance"])
    if (!Number.isFinite(s[key]) || s[key] < 0) throw new Error(`Invalid path tracing ${key}`);
  if (!Number.isFinite(s.environmentRotation) || s.sunAngularDiameter > 90 || s.focusDistance <= 0) throw new Error("Invalid path tracing camera or environment settings.");
  if (!["aces", "reinhard", "none"].includes(s.toneMapping) || s.whiteBalance.length !== 3 || s.whiteBalance.some((v) => !Number.isFinite(v) || v <= 0)) throw new Error("Invalid path tracing display settings.");
}
var PathProgress = class {
  constructor(settings) {
    this.settings = settings;
  }
  settings;
  signature = [];
  samples = 0;
  mode = "refinement";
  reset() {
    this.signature = [];
    this.samples = 0;
    this.mode = "refinement";
  }
  next(signature, _now, _aa, _bounces, ready = true) {
    if (signature.length !== this.signature.length || signature.some((v, i) => !Object.is(v, this.signature[i]))) {
      this.signature = Array.from(signature);
      this.samples = 0;
    }
    const count = this.samples, trace = ready && count < this.settings.maxSamples;
    if (trace) this.samples++;
    const pending = this.samples < this.settings.maxSamples;
    this.mode = pending ? "refinement" : "high-quality";
    return { trace, count, jitter: [0, 0], bounces: this.settings.maxBounces, pending };
  }
};
function radianceSettings(s) {
  return [
    s.maxBounces,
    s.diffuseBounces,
    s.specularBounces,
    s.transmissionBounces,
    s.rouletteStart,
    s.seed,
    s.environmentIntensity,
    s.environmentRotation,
    s.sunAngularDiameter,
    s.aperture,
    s.focusDistance,
    s.adaptive,
    s.minSamples,
    s.convergenceThreshold
  ];
}

// ../sdk-oct2/src/viewing/techniques/pathTracing/shared/distribution.ts
function environmentDistribution(width, height, rgba, measurement) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || rgba.length !== width * height * 4) throw new Error("Invalid HDR environment dimensions.");
  const values = new Float32Array(rgba.length), weights = new Float64Array(width * height);
  let total = 0;
  for (let y = 0; y < height; y++) {
    const area = 2 * Math.PI / width * (Math.cos(Math.PI * y / height) - Math.cos(Math.PI * (y + 1) / height));
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      for (let c = 0; c < 3; c++) {
        const v = rgba[i * 4 + c];
        if (!Number.isFinite(v) || v < 0) throw new Error("HDR radiance must be finite and nonnegative.");
        values[i * 4 + c] = v;
      }
      total += weights[i] = area * (0.2126 * values[i * 4] + 0.7152 * values[i * 4 + 1] + 0.0722 * values[i * 4 + 2]);
    }
  }
  let cdf = 0;
  for (let i = 0; i < weights.length; i++) {
    const y = Math.floor(i / width), areaFraction = (Math.cos(Math.PI * y / height) - Math.cos(Math.PI * (y + 1) / height)) / (2 * width);
    cdf += total > 0 ? 0.99 * weights[i] / total + 0.01 * areaFraction : areaFraction;
    values[i * 4 + 3] = cdf;
  }
  values[values.length - 1] = 1;
  if (measurement) measurement.integral = total;
  return values;
}

// ../sdk-oct2/src/viewing/techniques/pathTracing/shared/lights.ts
var cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function packPathLights(data, lights = []) {
  const records = [], origin = data.origin ?? [0, 0, 0];
  function add(a, b, c, radiance, type, mesh = -1, triangle2 = -1, instance = -1) {
    if ([...a, ...b, ...c, ...radiance].some((v) => !Number.isFinite(v)) || radiance.some((v) => v < 0)) throw new Error("Invalid path tracing light.");
    const n = cross(b, c), area = Math.hypot(...n) / 2;
    if (type === 0 && area <= 1e-15) return;
    const len = Math.hypot(...n) || 1;
    records.push(...a, type, ...b, mesh, ...c, triangle2, ...radiance, instance, n[0] / len, n[1] / len, n[2] / len, area, 0, 0, 0, 0);
  }
  for (const light of lights) {
    if (light.type === "directional") {
      const length = Math.hypot(...light.direction);
      if (length === 0) continue;
      add(light.direction.map((v) => -v / length), [0, 0, 0], [0, 0, 0], light.irradiance, 1);
    } else if (light.type === "point") add(light.position.map((v, i) => v - origin[i]), [0, 0, 0], [0, 0, 0], light.intensity, 2);
    else {
      const a = light.position.map((v, i) => v - origin[i]);
      add(a, light.edgeU, light.edgeV, light.radiance, 0);
      add(a.map((v, i) => v + light.edgeU[i] + light.edgeV[i]), light.edgeU.map((v) => -v), light.edgeV.map((v) => -v), light.radiance, 0);
    }
  }
  const analyticCount = records.length / 24;
  function triangle(face, material, instance) {
    const emission = Array.from(data.pbr.subarray(material * 24 + 4, material * 24 + 7));
    if (!emission.some((v) => v > 0)) return;
    const offset = face * 12, a = Array.from(data.triangles.subarray(offset, offset + 3)), b = Array.from(data.triangles.subarray(offset + 4, offset + 7)), c = Array.from(data.triangles.subarray(offset + 8, offset + 11));
    if (instance >= 0) {
      const m = data.materials;
      const base2 = (data.instances.transformOffset + instance * 7 + 3) * 4;
      for (const [vector, position] of [[a, true], [b, false], [c, false]]) {
        const [x, y, z] = vector;
        for (let axis = 0; axis < 3; axis++) vector[axis] = m[base2 + axis * 4] * x + m[base2 + axis * 4 + 1] * y + m[base2 + axis * 4 + 2] * z + (position ? m[base2 + axis * 4 + 3] : 0);
      }
    }
    add(a, b, c, emission, 0, material, face * 3, instance);
  }
  if (data.instances) {
    for (let i = 0; i < data.instances.instanceCount; i++) {
      const offset = (data.instances.transformOffset + i * 7 + 6) * 4;
      const material = data.materials[(data.materialMapOffset ?? 0) * 4 + i];
      if (!data.pbr.subarray(material * 24 + 4, material * 24 + 7).some((v) => v > 0)) continue;
      for (let n = data.materials[offset]; n < data.materials[offset + 1]; n++) {
        const first = data.nodes[n * 12 + 7];
        if (first < 0) continue;
        for (let j = 0; j < data.nodes[n * 12 + 8]; j++) triangle(first + j, material, i);
      }
    }
  } else for (let i = 0; i < data.triangleCount; i++) triangle(i, data.triangles[i * 12 + 3], -1);
  const count = records.length / 24;
  const values = new Float32Array((count + 1) * 24);
  for (let i = 0; i < analyticCount * 24; i++) values[i] = records[i];
  const order = new Uint32Array(count - analyticCount);
  for (let i = 0; i < order.length; i++) order[i] = i + analyticCount;
  order.sort((a, b) => records[a * 24 + 15] - records[b * 24 + 15] || records[a * 24 + 11] - records[b * 24 + 11]);
  for (let i = 0; i < order.length; i++) for (let j = 0; j < 24; j++) values[(analyticCount + i) * 24 + j] = records[order[i] * 24 + j];
  return { count, analyticCount, values, projectedArea: sceneProjectedArea(data) };
}
function sceneProjectedArea(data) {
  const bounds = data.instances ? data.materials : data.nodes;
  const offset = data.instances ? data.instances.tlasOffset * 4 : 0;
  if (!bounds || bounds.length < offset + 7) return Math.PI;
  let diameter2 = 0;
  for (let i = 0; i < 3; i++) diameter2 += (bounds[offset + i + 4] - bounds[offset + i]) ** 2;
  return Number.isFinite(diameter2) && diameter2 > 0 ? Math.PI * diameter2 / 4 : Math.PI;
}
function updateLightSelection(packed, environmentIntegral) {
  const { values, count, projectedArea } = packed, power = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) {
    const offset = i * 24, type = values[offset + 3];
    const luminance = 0.2126 * values[offset + 12] + 0.7152 * values[offset + 13] + 0.0722 * values[offset + 14];
    power[i] = luminance * (type === 0 ? 2 * Math.PI * values[offset + 19] : type === 1 ? projectedArea : 4 * Math.PI);
  }
  power[count] = environmentIntegral * projectedArea;
  const table = lightSelectionTable(power);
  for (let i = 0; i <= count; i++) values.set(table.subarray(i * 4, i * 4 + 4), i * 24 + 20);
}
function viewPathLights(view) {
  const inverse = view.camera.inverseViewMatrix;
  const transform = (v, position) => [0, 1, 2].map((i) => inverse[i] * v[0] + inverse[i + 4] * v[1] + inverse[i + 8] * v[2] + (position ? inverse[i + 12] : 0));
  const result = [];
  for (const light of view.lightsList) {
    const l = light;
    const radiance = Array.from(l.color, (v) => v * l.intensity);
    if (l.dir) result.push({ type: "directional", direction: l.space === "view" ? transform(l.dir, false) : Array.from(l.dir), irradiance: radiance });
    else if (l.pos) result.push({ type: "point", position: l.space === "view" ? transform(l.pos, true) : Array.from(l.pos), intensity: radiance });
  }
  return result;
}

// ../sdk-oct2/src/viewing/techniques/pathTracing/webGPU/technique.ts
function webgpuPathTracingTechnique(options = {}) {
  const settings = { ...pathTracingPreset(options.preset), ...options.settings };
  validatePathTracingSettings(settings);
  const pack = createScenePacker(options.instancing, options.bvh);
  const textureSize = materialTextureSize(options.textureSize);
  const snapshots = /* @__PURE__ */ new WeakMap();
  const runtimes = /* @__PURE__ */ new WeakMap();
  const technique = {
    id: "pathTracing",
    retainOnInvalidate: true,
    disposeView(view) {
      pack.release(view);
      snapshots.delete(view);
      runtimes.delete(view);
    },
    async prepare(view, signal) {
      if (view.sectionPlanesList.some((plane) => plane.active)) throw new Error("Path tracing does not support section planes; raster remains available.");
      const data = await pack(view.viewer.scene, {}, signal, view, textureSize);
      await runtimes.get(view)?.prepareUpdate(data, signal);
      signal.throwIfAborted();
      return data;
    },
    async create(context, initial, view, signal) {
      let data = initial;
      let accumulation;
      const progress = new PathProgress(settings);
      let lightTexture, environmentTexture;
      let lightCount = 0, analyticLightCount = 0, environmentVersion = -1, lightsKey = "", revision = 0;
      let packedLights, selectionKey = "", environmentIntegral = 0;
      let disposed = false;
      let opaque = opaqueScene(data);
      const upload = (values, width, height) => uploadTable(context, values, width, height);
      const disposeTables = () => {
        lightTexture?.texture.destroy?.();
        environmentTexture?.texture.destroy?.();
        lightTexture = environmentTexture = void 0;
        packedLights = void 0;
      };
      function synchronize() {
        validatePathTracingSettings(settings);
        const lights = [...viewPathLights(view), ...options.lights ?? []];
        const key = JSON.stringify(lights);
        const ibl = view.lights.ibl;
        if (!environmentTexture || environmentVersion !== ibl.environmentVersion) {
          const hdr = ibl.environmentHDR;
          const measurement = { integral: 4 * Math.PI };
          const values = hdr ? environmentDistribution(hdr.width, hdr.height, hdr.data, measurement) : new Float32Array([0, 0, 0, 1]);
          const next = upload(values, hdr?.width ?? 1, hdr?.height ?? 1);
          environmentTexture?.texture.destroy?.();
          environmentTexture = next;
          environmentVersion = ibl.environmentVersion;
          environmentIntegral = measurement.integral;
          revision++;
        }
        if (!packedLights || key !== lightsKey) {
          packedLights = packPathLights(data, lights);
          lightsKey = key;
          selectionKey = "";
        }
        const environmentPower = ibl.applied && ibl.possible ? environmentIntegral * ibl.intensity * settings.environmentIntensity : 0;
        if (!lightTexture || selectionKey !== String(environmentPower)) {
          updateLightSelection(packedLights, environmentPower);
          const width = 1024, height = Math.max(1, Math.ceil(packedLights.values.length / (width * 4)));
          const next = upload(packedLights.values, width, height);
          lightTexture?.texture.destroy?.();
          lightTexture = next;
          lightCount = packedLights.count;
          analyticLightCount = packedLights.analyticCount;
          selectionKey = String(environmentPower);
          revision++;
        }
      }
      const kernel = {
        tileSize: 128,
        tileBatchLimit: 8,
        pipeline: { key: "path-v2", source: pathShader, targets: ["rgba32float", "rgba32float"], entries: (binding) => [...[1, 2, 3, 4].map((offset) => ({ binding: binding + offset, visibility: 2, texture: { sampleType: "unfilterable-float" } })), { binding: binding + 5, visibility: 2, storageTexture: { access: "write-only", format: "rgba32float" } }] },
        progress,
        uniformFloats: 88,
        reservedTextures: 10,
        signature() {
          synchronize();
          return [...radianceSettings(settings), revision, ...view.lights.hemispheric.worldUp];
        },
        writeUniforms(values) {
          values.set([settings.maxBounces, settings.rouletteStart, 0, lightCount], 68);
          new Uint32Array(values.buffer, values.byteOffset, values.length)[70] = settings.seed;
          values.set([settings.diffuseBounces, settings.specularBounces, settings.transmissionBounces, opaque ? 1 : 0], 72);
          values.set([settings.adaptive ? 1 : 0, settings.minSamples, settings.convergenceThreshold, 0], 76);
          values.set([settings.environmentIntensity, settings.environmentRotation * Math.PI / 180, settings.sunAngularDiameter * Math.PI / 360, view.lights.ibl.environmentHDR ? 1 : 0], 80);
          values.set([settings.aperture, settings.focusDistance, analyticLightCount, 0], 84);
          values.set(view.lights.hemispheric.worldUp, 56);
        },
        async createAccumulation(ctx, _compute, abort) {
          accumulation = await createPathAccumulation(ctx, settings, abort);
          return accumulation;
        },
        bindings(binding) {
          return [{ binding: binding + 1, resource: accumulation.guideHistory }, { binding: binding + 2, resource: lightTexture.view }, { binding: binding + 3, resource: environmentTexture.view }, { binding: binding + 4, resource: accumulation.auxiliaryHistory }, { binding: binding + 5, resource: accumulation.auxiliaryOutput }];
        }
      };
      let renderer;
      try {
        await context.prepareEnvironment?.(view, signal);
        signal.throwIfAborted();
        synchronize();
        renderer = await createSharedRenderer(context, data, void 0, signal, { progressive: true, kernel });
        signal.throwIfAborted();
      } catch (error) {
        renderer?.dispose();
        disposeTables();
        throw error;
      }
      snapshots.set(view, data);
      runtimes.set(view, renderer);
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        renderer.dispose();
        disposeTables();
        context.resourceLifetime?.removeEventListener("abort", dispose);
        if (runtimes.get(view) === renderer) {
          runtimes.delete(view);
          snapshots.delete(view);
        }
      };
      context.resourceLifetime?.addEventListener("abort", dispose, { once: true });
      if (context.resourceLifetime?.aborted) {
        dispose();
        throw new Error("WebGPU device lifetime ended during path tracer creation.");
      }
      return {
        update(prepared) {
          const next = prepared;
          if (!renderer.update(next)) return false;
          data = next;
          opaque = opaqueScene(data);
          packedLights = void 0;
          lightsKey = "";
          lightTexture?.texture.destroy?.();
          lightTexture = void 0;
          snapshots.set(view, data);
          return true;
        },
        prepareFrame(frame) {
          if (view.camera.projectionType !== PerspectiveProjectionType) throw new Error("Path tracing requires a perspective camera.");
          view.effects.tonemap.enabled = true;
          view.effects.tonemap.mode = settings.toneMapping;
          view.effects.tonemap.exposure = settings.exposure;
          const camera = view.camera, inverse = camera.inverseViewMatrix;
          renderer.prepareFrame(
            { basis: () => ({
              eye: Array.from(camera.eye),
              right: [inverse[0], inverse[1], inverse[2]],
              up: [inverse[4], inverse[5], inverse[6]],
              forward: [-inverse[8], -inverse[9], -inverse[10]],
              tanHalfFov: 1 / camera.projMatrix[5]
            }) },
            { pbr: true, textures: true, shadows: true, transparency: true, smoothShading: true, antialiasing: "none", bounces: settings.maxBounces, lightAngle: 0, scale: 1 },
            frame
          );
          if (renderer.accumulatedSamples === 0) return false;
          accumulation.filter(frame, renderer.samplingPending);
        },
        render: (frame) => renderer.present(frame),
        dispose
      };
    }
  };
  return Object.assign(technique, { settings, getSnapshot: (view) => snapshots.get(view), getRuntime: (view) => runtimes.get(view) });
}

// ../sdk-oct2/src/viewing/techniques/pathTracing/webGL/sampling.ts
var samplingGLSL = (
  /* glsl */
  `
float pilotSamples(float count, float minimum) {return min(floor(count/4.0),max(32.0,minimum));}
bool takePilotSample(float count, float minimum, bool adaptive) {
 return adaptive&&pilotSamples(count,minimum)<max(32.0,minimum)&&uint(count)%4u==3u;
}
bool samplingConverged(float count, float mean, float m2, float minimum, float threshold) {
 float pilots=max(32.0,minimum);
 if(threshold<=0.0||pilotSamples(count,minimum)<pilots||mean<=.001){return false;}
 float variance=max(m2,0.0)/(pilots-1.0);
 return count>=max(pilots,ceil(6.635*variance/pow(threshold*max(mean,.01),2.0)));
}
float meanVariance(float count, float m2, float minimum, bool adaptive) {
 float moments=((adaptive) ? (pilotSamples(count,minimum)) : (count));
 return max(m2,0.0)/max(count*(moments-1.0),1.0);
}
`
);

// ../sdk-oct2/src/viewing/techniques/pathTracing/webGL/accumulation.ts
var displayShader = (
  /* glsl */
  `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D history,guides,auxiliary,inputImage;
uniform vec3 balance,right,up,forward;
uniform vec4 sampling,overlay,projection;
uniform int wavelet;
uniform bool lens;
out vec4 color;
${samplingGLSL}
vec3 normal(float encoded){uint bits=uint(encoded);vec2 p=vec2(float(bits%4096u),float(bits/4096u))/4095.0*2.0-1.0;vec3 n=vec3(p,1.0-abs(p.x)-abs(p.y));if(n.z<0.0)n.xy=(vec2(1)-abs(n.yx))*mix(vec2(1),vec2(-1),lessThan(n.xy,vec2(0)));return normalize(n);}
vec3 albedo(float encoded){uint bits=uint(encoded);return pow(vec3(float(bits%256u),float((bits/256u)%256u),float(bits/65536u))/255.0,vec3(2.2));}
bool finiteColor(vec3 value){return !any(isnan(value))&&!any(isinf(value));}
float variance(float count,vec4 g){return meanVariance(count,g.w,sampling.x,sampling.y>.5);}
// Independent adaptive pilots may miss a rare path in the displayed stream.
// Its actual contribution bounds the display filter bandwidth without clamping HDR.
float filterVariance(vec4 h,vec4 g,vec4 m){
 float peak=max(0.0,m.w-dot(h.rgb,vec3(.2126,.7152,.0722)))/max(h.a,1.0);
 return max(variance(h.a,g),peak*peak);
}
vec3 position(ivec2 pixel,float depth){vec2 size=vec2(textureSize(history,0));vec2 xy=(vec2(pixel)+.5)/size*2.0-1.0;return depth*(forward+right*xy.x*projection.w*size.x/size.y+up*xy.y*projection.w);}
vec4 filterImage(ivec2 pixel){
 vec3 center=texelFetch(inputImage,pixel,0).rgb;vec4 h=texelFetch(history,pixel,0),g=texelFetch(guides,pixel,0),m=texelFetch(auxiliary,pixel,0);
 float roughness=float(uint(m.y)%256u)/255.0,transmission=float((uint(m.y)/256u)%256u)/255.0;
 bool detailed=roughness<.15||transmission>0.0||uint(m.y)>=8388608u||lens;
 // Scratch alpha carries reconstructed uncertainty, never the raw sample count.
 // Later scales must not keep blurring with the original, noisier bandwidth.
 float centerVariance=wavelet==1?filterVariance(h,g,m):texelFetch(inputImage,pixel,0).a;
 if(h.a<4.0||g.x<=0.0||(wavelet>1&&detailed))return vec4(center,centerVariance);
 ivec2 size=textureSize(history,0);vec3 n=normal(g.y),a=albedo(m.x),point=position(pixel,g.x);
 float footprint=2.0*g.x*projection.w/float(size.y),weight=1.0,filteredVariance=centerVariance;vec3 sum=center;
 for(int y=-2;y<=2;y++)for(int x=-2;x<=2;x++){
  if((x==0&&y==0)||(detailed&&(abs(x)>1||abs(y)>1)))continue;ivec2 q=pixel+ivec2(x,y)*wavelet;if(any(lessThan(q,ivec2(0)))||any(greaterThanEqual(q,size)))continue;
  vec3 other=texelFetch(inputImage,q,0).rgb;vec4 og=texelFetch(guides,q,0),om=texelFetch(auxiliary,q,0),oh=texelFetch(history,q,0);
  if(og.x<=0.0||oh.a<=0.0||!finiteColor(other))continue;
  float plane=abs(dot(n,position(q,og.x)-point));float geometry=pow(max(dot(n,normal(og.y)),0.0),32.0)*exp(-plane/max(footprint*.2,1e-6));
  vec3 difference=albedo(om.x)-a;float materialWeight=exp(-dot(difference,difference)/.02)*(abs(om.y-m.y)<.5?1.0:0.0);
  float otherVariance=wavelet==1?filterVariance(oh,og,om):texelFetch(inputImage,q,0).a;
  float differenceY=dot(other-center,vec3(.2126,.7152,.0722));float rangeWeight=exp(-differenceY*differenceY/max(8.0*(centerVariance+otherVariance),1e-8));
  float wx=x==0?1.0:abs(x)==1?2.0/3.0:1.0/6.0,wy=y==0?1.0:abs(y)==1?2.0/3.0:1.0/6.0;
  float w=wx*wy*geometry*materialWeight*rangeWeight;if(!finiteColor(vec3(w))||w<=0.0)continue;sum+=other*w;weight+=w;filteredVariance+=w*w*otherVariance;
 }
 return vec4(sum/weight,filteredVariance/(weight*weight));
}
vec3 heat(float t){return clamp(vec3(1.5)-abs(vec3(4.0*t)-vec3(3,2,1)),vec3(0),vec3(1));}
void main(){
 ivec2 p=ivec2(gl_FragCoord.xy);
 if(wavelet>0){color=filterImage(p);return;}
 vec4 h=texelFetch(history,p,0),g=texelFetch(guides,p,0),a=texelFetch(auxiliary,p,0);
 // inputImage is raw history when denoising is off. Do not reintroduce raw noise.
 vec3 result=texelFetch(inputImage,p,0).rgb*balance;
 int mode=int(sampling.w);
 if(mode==1)result=heat(h.a/max(sampling.z,1.0));
 if(mode==2)result=heat(clamp(log2(1.0+sqrt(variance(h.a,g)))/4.0,0.0,1.0));
 if(mode==3)result=heat(a.z/max(overlay.y+1.0,1.0));
 if(mode==4)result=heat(clamp(a.w/overlay.x,0.0,1.0));
 float depth=1.0;
 if(g.x>0.0){depth=clamp(((-g.x*projection.x+projection.y)/g.x)*.5+.5,0.0,1.0);if(projection.z>0.0)depth=clamp(log2(1.0+g.x)*projection.z*.5,0.0,1.0);}
 gl_FragDepth=depth;
 // Only the half-float host display target is bounded. Raw HDR stays untouched.
 color=vec4(clamp(result,vec3(0),vec3(65504)),1);
}`
);
function createPathAccumulation2(gl, settings, frame, lifetime) {
  const textures = [], fbos = [];
  let width = 0, height = 0, current = 0, disposed = false, revision = 0, filteredRevision = -1;
  let vao = null, lease;
  const clear = () => {
    fbos.splice(0).forEach((f) => gl.deleteFramebuffer(f));
    textures.splice(0).forEach((t) => gl.deleteTexture(t));
    width = height = 0;
    filteredRevision = -1;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clear();
    lease?.release();
    if (vao) gl.deleteVertexArray(vao);
  };
  try {
    lease = acquireProgram(gl, vertexShader, displayShader, lifetime);
    lease.isReady();
    const program = lease.program;
    const u = Object.fromEntries(["history", "guides", "auxiliary", "inputImage", "balance", "sampling", "overlay", "projection", "right", "up", "forward", "wavelet", "lens"].map((n) => [n, gl.getUniformLocation(program, n)]));
    vao = gl.createVertexArray();
    if (!vao) throw new Error("Path accumulation VAO allocation failed.");
    const bind = (unit, index) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, textures[index]);
    };
    return {
      get history() {
        return textures[current];
      },
      resize(w, h) {
        if (disposed) throw new Error("Path accumulation disposed.");
        if (width === w && height === h) return;
        clear();
        width = w;
        height = h;
        current = 0;
        try {
          for (let i = 0; i < 7; i++) {
            const texture = gl.createTexture();
            if (!texture) throw new Error("Path HDR allocation failed.");
            textures.push(texture);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          }
          for (let i = 0; i < 3; i++) {
            const fbo = gl.createFramebuffer();
            if (!fbo) throw new Error("Path framebuffer allocation failed.");
            fbos.push(fbo);
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            if (i < 2) {
              for (let j = 0; j < 3; j++) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + j, gl.TEXTURE_2D, textures[i + j * 2], 0);
              gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
            } else gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textures[6], 0);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("WebGL path tracing requires renderable RGBA32F targets.");
          }
        } catch (error) {
          clear();
          throw error;
        }
      },
      begin(unit) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[1 - current]);
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        bind(unit, current);
        bind(unit + 1, current + 2);
        bind(unit + 2, current + 4);
        current = 1 - current;
        revision++;
      },
      present(target) {
        const f = frame(), camera = f.view.camera, p = camera.projMatrix, m = camera.inverseViewMatrix;
        gl.viewport(0, 0, width, height);
        gl.disable(gl.BLEND);
        gl.disable(gl.CULL_FACE);
        gl.useProgram(program);
        gl.bindVertexArray(vao);
        bind(0, current);
        bind(1, current + 2);
        bind(2, current + 4);
        gl.uniform1i(u.history, 0);
        gl.uniform1i(u.guides, 1);
        gl.uniform1i(u.auxiliary, 2);
        gl.uniform1i(u.inputImage, 3);
        gl.uniform3fv(u.balance, settings.whiteBalance);
        gl.uniform4f(u.sampling, settings.minSamples, settings.adaptive && settings.convergenceThreshold > 0 ? 1 : 0, settings.maxSamples, ["none", "samples", "variance", "pathLength", "radiance"].indexOf(settings.diagnostic ?? "none"));
        gl.uniform4f(u.overlay, settings.diagnosticRadianceThreshold ?? 10, settings.maxBounces, 0, 0);
        gl.uniform4f(u.projection, p[10], p[14], f.output.colorSpace === "linear-hdr" ? f.output.logDepthCoefficient : 0, 1 / p[5]);
        gl.uniform3f(u.right, m[0], m[1], m[2]);
        gl.uniform3f(u.up, m[4], m[5], m[6]);
        gl.uniform3f(u.forward, -m[8], -m[9], -m[10]);
        gl.uniform1i(u.lens, settings.aperture > 0 ? 1 : 0);
        const filter = settings.denoise && (!settings.diagnostic || settings.diagnostic === "none");
        if (filter && filteredRevision !== revision) {
          gl.disable(gl.DEPTH_TEST);
          gl.depthMask(false);
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[2]);
          for (let i = 0; i < 3; i++) {
            bind(3, i === 0 ? current : i === 1 ? 1 - current : 3 - current);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textures[i === 0 ? 1 - current : i === 1 ? 3 - current : 6], 0);
            gl.uniform1i(u.wavelet, 1 << i);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
          }
          filteredRevision = revision;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, target);
        bind(3, filter ? 6 : current);
        gl.uniform1i(u.wavelet, 0);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.ALWAYS);
        gl.depthMask(true);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      dispose
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

// ../sdk-oct2/src/viewing/techniques/pathTracing/webGL/bsdf.ts
var bsdfGLSL = (
  /* glsl */
  `
uint rng;
vec3 lobeMask=vec3(1.0);
float random() {
  rng=rng*747796405u+2891336453u;
  uint word=((rng>>((rng>>28u)+4u))^rng)*277803737u;
  return float(((word>>22u)^word)>>8u)*(1.0/16777216.0);
}
mat3 basis(vec3 n) {
  vec3 t=normalize(cross(((abs(n.y)<.9) ? (vec3(0.0,1.0,0.0)) : (vec3(1.0,0.0,0.0))),n));
  return mat3(t,cross(n,t),n);
}
bool finiteColor(vec3 value) {return !any(isnan(value))&&!any(isinf(value));}
float powerWeight(float a, float b) {
  // PDFs are densities, not probabilities: smooth lobes can exceed 1e20.
  float scale=max(a,b);if(scale<=0.0){return 0.0;}
  float x=a/scale;float y=b/scale;return x*x/(x*x+y*y);
}
// Algebraically f*cos*w_light/p_light, with the common PDF scale cancelled
// before multiplying HDR emission. A finite result must not overflow f * Li.
vec3 directWeight(vec3 f, float cosine, float lightPdf, float bsdfPdf, bool delta) {
  if(lightPdf<=0.0||bsdfPdf<=0.0){return vec3(0.0);}
  if(delta){return (f/lightPdf)*cosine;}
  float scale=max(lightPdf,bsdfPdf);float a=lightPdf/scale;float b=bsdfPdf/scale;
  return (f/bsdfPdf)*(cosine*(a*b/(a*a+b*b)));
}
bool hasContinuousBSDF(Material m, float eta, bool thin) {
  float substrate=(1.0-m.metallic)*(1.0-m.transmission);
  if(substrate*lobeMask.x>0.0){return true;}
  if(m.roughness<.001){return false;}
  float glass=(1.0-m.metallic)*m.transmission;
  return (m.metallic*lobeMask.y>0.0)||(eta!=1.0&&(substrate*lobeMask.y>0.0||(glass>0.0&&(lobeMask.y>0.0||lobeMask.z>0.0))));
}
float dielectric(float c, float eta) {
  if(eta==1.0){return 0.0;}
  float cosine=clamp(c,0.0,1.0);
  float sin2=max(0.0,1.0-cosine*cosine)/(eta*eta);if(sin2>=1.0){return 1.0;}
  float ct=sqrt(1.0-sin2);float rs=(cosine-eta*ct)/(cosine+eta*ct);float rp=(eta*cosine-ct)/(eta*cosine+ct);
  return .5*(rs*rs+rp*rp);
}
float distribution(vec3 n, vec3 h, float a) {
  // The cross product retains small angles when dot(n,h) has rounded to one.
  vec3 tangent=cross(n,h);float cosine=dot(n,h);
  float d=dot(tangent,tangent)+cosine*cosine*a*a;return a*a/(PI*d*d);
}
float masking(float c, float a) {return 2.0*c/max(c+sqrt(a*a+(1.0-a*a)*c*c),1e-20);}
vec3 visibleNormal(vec3 wo, vec3 n, float a) {
  mat3 frame=basis(n);vec3 local=transpose(frame)*wo;
  vec3 view=normalize(vec3(a*local.xy,local.z));
  float length2=dot(view.xy,view.xy);vec3 tangent=vec3(1.0,0.0,0.0);
  if(length2>0.0){tangent=vec3(-view.y,view.x,0.0)/sqrt(length2);}
  vec3 bitangent=cross(view,tangent);
  float radius=sqrt(random());float phi=2.0*PI*random();float x=radius*cos(phi);
  float blend=.5*(1.0+view.z);
  float y=mix(sqrt(max(0.0,1.0-x*x)),radius*sin(phi),blend);
  vec3 hemisphere=tangent*x+bitangent*y+view*sqrt(max(0.0,1.0-x*x-y*y));
  return normalize(frame*normalize(vec3(a*hemisphere.xy,max(hemisphere.z,0.0))));
}
struct BSDF { vec3 f; float pdf; };
struct Scatter { vec3 direction; vec3 weight; float pdf; bool delta; bool transmitted; bool diffuse; };
float glassF(float c, float eta, bool thin) {float f=dielectric(c,eta);return ((thin) ? (2.0*f/(1.0+f)) : (f));}
BSDF evaluateBSDF(Material m, vec3 wo, vec3 wi, vec3 n, float eta, bool thin) {
  float no=dot(n,wo);float ni=dot(n,wi);if(no<=0.0||abs(ni)<1e-7){return BSDF(vec3(0.0),0.0);}
  float metal=m.metallic;float glass=(1.0-metal)*m.transmission;float diffuse=(1.0-metal)*(1.0-m.transmission);
  float a=max(m.roughness*m.roughness,.0001);
  // Index-matched transmission is a delta event even on a rough interface.
  if(ni<0.0&&eta==1.0){return BSDF(vec3(0.0),0.0);}
  vec3 halfVector=wo+wi;if(ni<0.0){halfVector=wo+((thin) ? (-wi) : (wi*eta));}
  if(dot(halfVector,halfVector)<1e-20){return BSDF(vec3(0.0),0.0);}
  vec3 h=normalize(halfVector);
  if(dot(h,n)<0.0){h=-h;}
  float oh=dot(wo,h);float ih=dot(wi,h);if(oh<=0.0){return BSDF(vec3(0.0),0.0);}
  float d=distribution(n,h,a);float g1=masking(no,a);float g=g1*masking(abs(ni),a);
  float halfPdf=d*g1*oh/no;
  float f=glassF(oh,eta,thin);
  if(ni>0.0){
    vec3 specular=(metal*fresnel(m.albedo,oh)+vec3(diffuse*dielectric(oh,eta)+glass*f))*lobeMask.y;
    vec3 fd=lobeMask.x*diffuse*(1.0-dielectric(no,eta))*(1.0-dielectric(ni,eta))*m.albedo/PI;
    if(m.roughness<.001){return BSDF(fd,lobeMask.x*diffuse*.5*ni/PI);}
    return BSDF(fd+specular*d*g/(4.0*no*ni),lobeMask.x*diffuse*.5*ni/PI+lobeMask.y*(metal+diffuse*.5+glass*f)*halfPdf/(4.0*oh));
  }
  if(glass<=0.0||m.roughness<.001||lobeMask.z<.5){return BSDF(vec3(0.0),0.0);}
  if(thin){return BSDF(glass*(1.0-f)*m.albedo*d*g/(4.0*no*abs(ni)),glass*(1.0-f)*halfPdf/(4.0*oh));}
  if(ih>=0.0){return BSDF(vec3(0.0),0.0);}
  float denominator=oh+eta*ih;
  float jacobian=eta*eta*abs(ih)/max(denominator*denominator,1e-30);
  return BSDF(vec3(glass*(1.0-f)*d*g*abs(ih*oh)/max(no*abs(ni)*denominator*denominator,1e-30)),
    glass*(1.0-f)*halfPdf*jacobian);
}
Scatter sampleBSDF(Material m, vec3 wo, vec3 n, float eta, bool thin) {
  if(dot(wo,n)<=0.0){return Scatter(vec3(0.0),vec3(0.0),0.0,false,false,false);}
  float metal=m.metallic;float glass=(1.0-metal)*m.transmission;float diffuse=(1.0-metal)*(1.0-m.transmission);
  float choice=random();vec3 wi;bool transmitted=false;bool isDiffuse=false;
  bool chooseDiffuse=choice>=metal+glass+diffuse*.5;
  if(chooseDiffuse){
    if(lobeMask.x<.5){return Scatter(vec3(0.0),vec3(0.0),0.0,false,false,false);}
    float r=sqrt(random());float phi=2.0*PI*random();wi=basis(n)*vec3(r*cos(phi),r*sin(phi),sqrt(max(0.0,1.0-r*r)));isDiffuse=true;
  }else{
    float a=max(m.roughness*m.roughness,.0001);vec3 h=visibleNormal(wo,n,a);
    bool chooseGlass=choice>=metal&&choice<metal+glass;
    if(chooseGlass&&eta==1.0){
      return Scatter(-wo,((thin) ? (m.albedo) : (vec3(1.0)))*lobeMask.z,0.0,true,true,false);
    }
    bool delta=m.roughness<.001;
    if(delta){h=n;}
    float oh=dot(wo,h);if(oh<=0.0){return Scatter(vec3(0.0),vec3(0.0),0.0,false,false,false);}
    bool reflectEvent=true;
    if(chooseGlass){reflectEvent=random()<glassF(oh,eta,thin);}
    wi=reflect(-wo,h);
    if(!reflectEvent){wi=((thin) ? (-wi) : (refract(-wo,h,1.0/eta)));transmitted=true;}
    if(dot(wi,wi)<1e-10||((dot(wi,n)<0.0)!=transmitted)){return Scatter(vec3(0.0),vec3(0.0),0.0,false,false,false);}
    if(((transmitted) ? (lobeMask.z) : (lobeMask.y))<.5){return Scatter(vec3(0.0),vec3(0.0),0.0,false,false,false);}
    if(delta){
      vec3 weight=vec3(1.0);if(choice<metal){weight=fresnel(m.albedo,oh);}else if(!chooseGlass){weight=vec3(2.0*dielectric(oh,eta));}else if(transmitted){weight=((thin) ? (m.albedo) : (vec3(1.0/(eta*eta))));}
      return Scatter(wi,weight,0.0,true,transmitted,false);
    }
  }
  BSDF value=evaluateBSDF(m,wo,wi,n,eta,thin);
  return Scatter(wi,value.f*abs(dot(n,wi))/max(value.pdf,1e-30),value.pdf,false,transmitted,isDiffuse);
}
`
);

// ../sdk-oct2/src/viewing/techniques/pathTracing/webGL/shaders.ts
function pathTransportShader2(atlases, fallback, instanced, opaque, declarations, extraUniforms = "", rayLimit, thinShadowTransmission = false, primarySun = true) {
  let core = sharedFragmentShader(atlases, fallback, instanced, false, opaque);
  core = core.slice(0, core.indexOf("vec3 ambient(")) + `
const float PI=3.14159265359;
float strength(vec3 value){return max(value.x,max(value.y,value.z));}
`;
  core = core.replace("out vec4 outColor;", `layout(location=0) out vec4 outColor;
layout(location=1) out vec4 outGuide;
${declarations}
uniform vec3 uAccumulation;
uniform vec4 uPath,uLimits,uConvergence,uLighting,uLens;
uniform uint uSeed;
${extraUniforms}`);
  core = core.replace("clamp(factors.y*mr.g,0.045,1.0)", "clamp(factors.y*mr.g,0.0,1.0)");
  core = core.replace(/  if \(readData\(uMaterials,hit.mesh\*2\+1\).x > 0.5\) \{[\s\S]*?\n  }/, "");
  const source = core + bsdfGLSL + samplingGLSL + /* glsl */
  `
vec3 cameraRay(vec2 pixel){vec2 xy=(2.0*pixel-uResolution)/uResolution.y;return normalize(uForward+(xy.x*uRight+xy.y*uUp)*uTanHalfFov);}
vec2 octEncode(vec3 n){vec3 v=n/(abs(n.x)+abs(n.y)+abs(n.z));return v.z<0.0?(vec2(1)-abs(v.yx))*mix(vec2(1),vec2(-1),lessThan(v.xy,vec2(0))):v.xy;}
vec3 sunRadiance(vec3 d);
float sunPDF(vec3 d);
float pathLength;
vec4 lightRow(int index, int row) {int p=index*6+row;return texelFetch(lightTable,ivec2(p%1024,p/1024),0);}

float lightSelectionPDF(int index) {return lightRow(index,5).x;}
int selectLight(int count) {
  int column=min(int(random()*float(count)),count-1);
  vec4 record=lightRow(column,5);
  return ((random()<record.y) ? (column) : (int(record.z)));
}

vec4 environmentCell(int index) {ivec2 size=textureSize(environmentTable,0);return texelFetch(environmentTable,ivec2(index%int(size.x),index/int(size.x)),0);}
mat3 environmentFrame() {
  vec3 up=normalize(uWorldUp);vec3 reference=((abs(up.x)<.9) ? (vec3(1,0,0)) : (vec3(0,1,0)));
  vec3 east=normalize(cross(up,reference));return mat3(cross(east,up),up,east);
}
vec3 toEnvironment(vec3 d) {
  vec3 v=transpose(environmentFrame())*d;float a=uLighting.y;
  return vec3(cos(a)*v.x+sin(a)*v.z,v.y,-sin(a)*v.x+cos(a)*v.z);
}
vec3 fromEnvironment(vec3 d) {
  float a=-uLighting.y;vec3 v=vec3(cos(a)*d.x+sin(a)*d.z,d.y,-sin(a)*d.x+cos(a)*d.z);
  return environmentFrame()*v;
}
int environmentIndex(vec3 d) {
  vec3 v=toEnvironment(d);ivec2 size=textureSize(environmentTable,0);
  vec2 uv=vec2(atan(v.z,v.x)/(2.0*PI)+.5,acos(clamp(v.y,-1.0,1.0))/PI);
  uvec2 p=min(uvec2(uv*vec2(size)),uvec2(size)-uvec2(1));return int(p.y*uint(size.x)+p.x);
}
float environmentPDF(vec3 d) {
  if(uLighting.w<.5){return 1.0/(4.0*PI);}
  ivec2 size=textureSize(environmentTable,0);int index=environmentIndex(d);int y=index/int(size.x);
  float previous=0.0;if(index>0){previous=environmentCell(index-1).w;}
  float area=2.0*PI/float(size.x)*(cos(PI*float(y)/float(size.y))-cos(PI*float(y+1)/float(size.y)));
  return max(0.0,environmentCell(index).w-previous)/max(area,1e-20);
}
// Reconstruct HDR radiance without interpolating the CDF/PDF stored in alpha.
// Horizontal wrapping joins the panorama seam; vertical clamping retains the poles.
vec3 environmentTexel(ivec2 p) {
  ivec2 size=textureSize(environmentTable,0);
  return texelFetch(environmentTable,ivec2((p.x%size.x+size.x)%size.x,clamp(p.y,0,size.y-1)),0).rgb;
}
vec3 filteredEnvironment(vec3 d) {
  vec3 v=toEnvironment(d);vec2 size=vec2(textureSize(environmentTable,0));
  vec2 uv=vec2(atan(v.z,v.x)/(2.0*PI)+.5,acos(clamp(v.y,-1.0,1.0))/PI);
  vec2 p=uv*size-vec2(.5);ivec2 base=ivec2(floor(p));vec2 f=fract(p);
  return mix(mix(environmentTexel(base),environmentTexel(base+ivec2(1,0)),f.x),
    mix(environmentTexel(base+ivec2(0,1)),environmentTexel(base+ivec2(1,1)),f.x),f.y);
}
vec3 environmentRadiance(vec3 d) {
  if(float(uIBL)<.5){return vec3(0);}
  if(uLighting.w>.5){return filteredEnvironment(d)*uIBLIntensity*uLighting.x;}
  return textureLod(uEnvironment,environmentFrame()*toEnvironment(d),0.0).rgb*uIBLIntensity*uLighting.x;
}
vec3 sampleEnvironment() {
  if(uLighting.w<.5){float z=1.0-2.0*random();float phi=2.0*PI*random();return vec3(sqrt(1.0-z*z)*cos(phi),z,sqrt(1.0-z*z)*sin(phi));}
  ivec2 size=textureSize(environmentTable,0);int lo=0;int hi=int(size.x*size.y)-1;float r=random();
  while(true){if(lo>=hi){break;}int mid=(lo+hi)/2;if(environmentCell(mid).w<r){lo=mid+1;}else{hi=mid;}}
  int x=lo%int(size.x);int y=lo/int(size.x);
  float phi=2.0*PI*((float(x)+random())/float(size.x)-.5);
  float cosine=mix(cos(PI*float(y)/float(size.y)),cos(PI*float(y+1)/float(size.y)),random());
  return fromEnvironment(vec3(sqrt(max(0.0,1.0-cosine*cosine))*cos(phi),cosine,sqrt(max(0.0,1.0-cosine*cosine))*sin(phi)));
}
vec3 offsetOrigin(vec3 p, vec3 g, vec3 d) {
  // RTC keeps positions small; retain several float ULPs at larger local scales.
  float epsilon=max(1e-5,2e-7*max(abs(p.x),max(abs(p.y),abs(p.z))));
  return p+g*((dot(g,d)>0.0) ? (epsilon) : (-epsilon));
}
int pathLightingDomain=0;
struct AreaHit { float t; vec3 radiance; float pdf; };
AreaHit analyticAreaHit(vec3 ro, vec3 rd, float limit) {
  AreaHit result=AreaHit(limit,vec3(0),0.0);
  if(pathLightingDomain>0)return result;
  for(int i=0;i<int(uLens.z);i++){
    vec4 a=lightRow(i,0);vec4 b=lightRow(i,1);if(a.w>.5||b.w>=0.0){continue;}vec4 c=lightRow(i,2);
    vec3 q=cross(rd,c.xyz);float determinant=dot(b.xyz,q);if(abs(determinant)<1e-12){continue;}
    vec3 s=ro-a.xyz;float uBary=dot(s,q)/determinant;if(uBary<0.0||uBary>1.0){continue;}
    vec3 r=cross(s,b.xyz);float vBary=dot(rd,r)/determinant;if(vBary<0.0||uBary+vBary>1.0){continue;}
    float t=dot(c.xyz,r)/determinant;if(t<=1e-6||t>=result.t){continue;}
    vec4 info=lightRow(i,4);result=AreaHit(t,lightRow(i,3).rgb,lightSelectionPDF(i)*t*t/max(info.w*abs(dot(info.xyz,rd)),1e-20));
  }
  return result;
}
${thinShadowTransmission ? "vec3" : "float"} visibility(vec3 ro, vec3 rd, float distance) {
  if(analyticAreaHit(ro,rd,distance).t<distance){return ${thinShadowTransmission ? "vec3(0)" : "0.0"};}
  ${thinShadowTransmission ? "" : `if(uLimits.w>.5){return ((trace(ro,rd,distance,true,1e-6).mesh>=0) ? (0.0) : (1.0));}`}
  ${thinShadowTransmission ? "vec3 transmittance=vec3(1)" : "float transmittance=1.0"};float minT=1e-6;
  for(int i=0;i<256;i++){
    Hit hit=trace(ro,rd,distance,false,minT);if(hit.mesh<0){return transmittance;}
    ${thinShadowTransmission ? `vec3 p=ro+rd*hit.t;Material m=surfaceMaterial(hit,p);float opacity=surfaceOpacity(hit,p);
    transmittance*=vec3(1.0-opacity)+opacity*m.transmission*(1.0-m.metallic)*m.transmissionTint*(vec3(1)-m.f0);` : `transmittance*=1.0-surfaceOpacity(hit,ro+rd*hit.t);`}
    if(${thinShadowTransmission ? "strength(transmittance)" : "transmittance"}<=0.0){return ${thinShadowTransmission ? "vec3(0)" : "0.0"};}minT=hit.t+max(1e-6,abs(hit.t)*1e-6);
  }
  return ${thinShadowTransmission ? "vec3(0)" : "0.0"};
}
struct LightSample { vec3 direction; vec3 radiance; float pdf; float distance; bool delta; };
${DOMAIN_SAMPLING_GLSL.replace("int pathLightingDomain=0;", "")}
LightSample sampleLight(vec3 p) {
  if(pathLightingDomain>0)return sampleDomainLight(p);
  int count=int(uPath.w);int choice=selectLight(count+1);float selectPdf=lightSelectionPDF(choice);
  if(choice==count){vec3 d=sampleEnvironment();return LightSample(d,environmentRadiance(d),environmentPDF(d)*selectPdf,1e30,false);}
  vec4 a=lightRow(choice,0);vec4 b=lightRow(choice,1);vec4 c=lightRow(choice,2);vec4 emission=lightRow(choice,3);vec4 info=lightRow(choice,4);
  if(a.w>1.5){vec3 delta=a.xyz-p;float distance=max(length(delta),1e-6);return LightSample(delta/distance,emission.rgb/(distance*distance),selectPdf,distance,true);}
  if(a.w>.5){
    float radius=uLighting.z;float cosine=cos(radius);vec3 d=a.xyz;
    if(radius>0.0){float z=mix(cosine,1.0,random());float phi=2.0*PI*random();d=basis(d)*vec3(sqrt(1.0-z*z)*cos(phi),sqrt(1.0-z*z)*sin(phi),z);}
    float solidAngle=((radius<=0.0) ? (1.0) : (4.0*PI*pow(sin(radius*.5),2.0)));
    // A directional light stores irradiance; a finite sun disk stores its matching radiance.
    if(radius>0.0){return LightSample(d,sunRadiance(d),sunPDF(d),1e30,false);}
    return LightSample(d,emission.rgb,selectPdf,1e30,true);
  }
  float r=sqrt(random());vec2 bary=vec2(1.0-r,random()*r);vec3 point=a.xyz+b.xyz*bary.x+c.xyz*bary.y;
  vec3 delta=point-p;float distance=length(delta);vec3 d=delta/distance;float cosLight=abs(dot(info.xyz,d));
  vec3 radiance=emission.rgb;
  if(b.w>=0.0){
    Hit fake=Hit(distance,info.xyz,bary,int(readData(uTriangles,int(c.w)+1).w)-1,int(b.w),int(c.w),(int(readData(uTriangles,int(c.w)+2).w)-1)*((emission.w<0.0) ? (10) : (2)),int(emission.w));
    vec3 clipPoint=point;
    if(fake.instance>=0){vec4 v=vec4(point,1.0);clipPoint=vec3(dot(instanceData(fake.instance,0),v),dot(instanceData(fake.instance,1),v),dot(instanceData(fake.instance,2),v));}
    if(int(readData(uMaterials,fake.mesh*2+1).w)!=pathLightingDomain)radiance=vec3(0);
    if(clipBoxContains(fake.mesh,clipPoint))radiance*=sampleMap(fake,3,point,info.xyz).rgb*surfaceOpacity(fake,point);
    else radiance=vec3(0);
  }
  return LightSample(d,radiance,selectPdf*distance*distance/max(info.w*cosLight,1e-20),distance,false);
}
float emissionPDF(Hit hit, vec3 ro, vec3 rd) {
  int lo=int(uLens.z);int hi=int(uPath.w);
  while(true){
    if(lo>=hi){break;}int mid=lo+(hi-lo)/2;
    int triangle=int(lightRow(mid,2).w);int instance=int(lightRow(mid,3).w);
    if(instance<hit.instance||(instance==hit.instance&&triangle<hit.triangle)){lo=mid+1;}else{hi=mid;}
  }
  if(lo<int(uPath.w)&&int(lightRow(lo,3).w)==hit.instance&&int(lightRow(lo,2).w)==hit.triangle&&int(lightRow(lo,1).w)==hit.mesh){
    vec4 info=lightRow(lo,4);return hit.t*hit.t/max(info.w*abs(dot(info.xyz,rd)),1e-20)*lightSelectionPDF(lo);
  }
  return 0.0;
}
vec3 sunRadiance(vec3 d) {
  vec3 result=vec3(0);float radius=uLighting.z;if(radius<=0.0){return result;}
  for(int i=0;i<int(uLens.z);i++){vec4 a=lightRow(i,0);if(a.w>.5&&a.w<1.5&&dot(d,a.xyz)>=cos(radius)){result+=lightRow(i,3).rgb/(4.0*PI*pow(sin(radius*.5),2.0));}}
  return result;
}
float sunPDF(vec3 d) {
  float result=0.0;float radius=uLighting.z;if(radius<=0.0){return result;}
  for(int i=0;i<int(uLens.z);i++){vec4 a=lightRow(i,0);if(a.w>.5&&a.w<1.5&&dot(d,a.xyz)>=cos(radius)){result+=lightSelectionPDF(i)/(4.0*PI*pow(sin(radius*.5),2.0));}}
  return result;
}
vec3 pathRadiance(vec3 origin, vec3 direction) {
  pathLength=0.0;pathLightingDomain=0;lightingTraceDomain=${rayLimit ? "0" : "-1"};
  vec3 ro=origin;vec3 rd=direction;vec3 throughput=vec3(1);vec3 result=vec3(0);float lastPdf=0.0;bool lastDelta=true;
  float mediumEta[32];vec3 mediumAbsorption[32];int media=0;float etaCompensation=1.0;
  int diffuseDepth=0;int specularDepth=0;int transmissionDepth=0;
  int depth=0;int skips=0;vec3 lastPoint=origin;
  while(true){
    if(depth>int(uPath.x)){break;}
    float viewDistance=dot(ro-uEye,uForward);
    float near=${rayLimit ? "1e-6" : "((depth==0) ? (max(1e-6,(uClipRange.x-viewDistance)/max(dot(rd,uForward),1e-6))) : (1e-6))"};
    float limit=${rayLimit ?? "((depth==0) ? ((uClipRange.y-viewDistance)/max(dot(rd,uForward),1e-6)) : (1e30))"};
    Hit hit=trace(ro,rd,limit,false,near);lightingTraceDomain=-1;pathLength+=1.0;
    AreaHit area=analyticAreaHit(ro,rd,hit.t);
    if(area.t<hit.t){
      if(media>0){throughput*=exp(-mediumAbsorption[media-1]*area.t);}
      result+=throughput*area.radiance*((lastDelta) ? (1.0) : (powerWeight(lastPdf,area.pdf)));break;
    }
    if(hit.mesh<0){
      vec3 env=domainEnvironment(rd);vec3 sun=${primarySun ? "sunRadiance(rd)" : "(depth>0?sunRadiance(rd):vec3(0))"};
      float envPdf=environmentPDF(rd)*lightSelectionPDF(int(uPath.w));float lightPdf=sunPDF(rd);
      if(pathLightingDomain>0){envPdf=environmentPDF(rd)/(domainRecord(pathLightingDomain).y+1.0);sun=vec3(0);lightPdf=0.0;}
      result+=throughput*(env*((lastDelta) ? (1.0) : (powerWeight(lastPdf,envPdf)))+sun*((lastDelta) ? (1.0) : (powerWeight(lastPdf,lightPdf))));break;
    }
    vec3 p=ro+rd*hit.t;vec3 g=hit.geometricNormal;
    if(media>0){throughput*=exp(-mediumAbsorption[media-1]*hit.t);}
    float opacity=surfaceOpacity(hit,p);
    if(random()>=opacity){ro=offsetOrigin(p,g,rd);skips++;if(skips>256){break;}continue;}
    skips=0;
    int previousDomain=pathLightingDomain;pathLightingDomain=int(readData(uMaterials,hit.mesh*2+1).w);
    Material m=surfaceMaterial(hit,p);
    if(strength(m.emission)>0.0){
      float mis=1.0;if(!lastDelta && previousDomain==0 && pathLightingDomain==0){mis=powerWeight(lastPdf,emissionPDF(Hit(length(p-lastPoint),hit.geometricNormal,hit.uv,hit.normals,hit.mesh,hit.triangle,hit.texcoords,hit.instance),lastPoint,rd));}
      result+=throughput*(m.emission*mis);
    }
    if(depth>=int(uPath.x)){break;}
    vec3 outward=normalize(instanceNormal(hit.instance,cross(readData(uTriangles,hit.triangle+1).xyz,readData(uTriangles,hit.triangle+2).xyz)));
    bool entering=dot(rd,outward)<0.0;
    float ior=max(1.0,readData(uPBR,hit.mesh*6).z);bool thin=readData(uPBR,hit.mesh*6+4).y<=0.0;
    float etaI=1.0;float etaT=ior;if(media>0){etaI=mediumEta[media-1];}
    if(!entering&&!thin){etaT=1.0;if(media>1){etaT=mediumEta[media-2];}if(media==0){etaI=ior;}}
    float eta=etaT/etaI;vec3 n=mappedNormal(hit,p,shadingNormal(hit,rd),rd);vec3 wo=-rd;
    lobeMask=vec3(((diffuseDepth<int(uLimits.x)) ? (1.0) : (0.0)),((specularDepth<int(uLimits.y)) ? (1.0) : (0.0)),((transmissionDepth<int(uLimits.z)) ? (1.0) : (0.0)));
    if(hasContinuousBSDF(m,eta,thin)){
      LightSample light=sampleLight(p);
      if(light.pdf>0.0&&strength(light.radiance)>0.0&&dot(g,light.direction)*dot(n,light.direction)>0.0){
        BSDF bsdf=evaluateBSDF(m,wo,light.direction,n,eta,thin);
        vec3 weight=directWeight(bsdf.f,abs(dot(n,light.direction)),light.pdf,bsdf.pdf,light.delta);
        if(strength(weight)>0.0){
          lightingTraceDomain=pathLightingDomain;
          ${thinShadowTransmission ? "vec3" : "float"} vis=visibility(offsetOrigin(p,g,light.direction),light.direction,light.distance-max(1e-5,light.distance*1e-6));
          lightingTraceDomain=-1;
          result+=throughput*(weight*vis)*light.radiance;
        }
      }
    }
    Scatter scatter=sampleBSDF(m,wo,n,eta,thin);
    if(strength(scatter.weight)<=0.0||dot(g,scatter.direction)*dot(n,scatter.direction)<=0.0){break;}
    if(scatter.transmitted){transmissionDepth++;if(transmissionDepth>int(uLimits.z)){break;}}
    else if(scatter.diffuse){diffuseDepth++;if(diffuseDepth>int(uLimits.x)){break;}}
    else{specularDepth++;if(specularDepth>int(uLimits.y)){break;}}
    throughput*=scatter.weight;
    if(scatter.transmitted&&!thin){
      etaCompensation*=eta*eta;
      if(entering){if(media==32){break;}mediumEta[media]=ior;mediumAbsorption[media]=-log(max(readData(uPBR,hit.mesh*6+5).rgb,vec3(1e-6)))*readData(uPBR,hit.mesh*6+4).z;media++;}
      else if(media>0){media--;}
    }
    if(depth+1>=int(uPath.y)){
      float survive=clamp(strength(throughput)*etaCompensation,.05,.95);if(random()>=survive){break;}throughput/=survive;
    }
    lightingTraceDomain=scatter.diffuse?pathLightingDomain:-1;
    lastPdf=scatter.pdf;lastDelta=scatter.delta;lastPoint=p;ro=offsetOrigin(p,g,scatter.direction);rd=scatter.direction;depth++;
  }
  lightingTraceDomain=-1;
  return result;
}
`;
  if (!rayLimit) return source;
  return source.replace("int lightingTraceDomain = -1;", "const int lightingTraceDomain = 0;").replace("int pathLightingDomain=0;", "const int pathLightingDomain = 0;").replace("pathLightingDomain=0;", "").replace("int previousDomain=pathLightingDomain;pathLightingDomain=int(readData(uMaterials,hit.mesh*2+1).w);", "int previousDomain=0;").replace(/lightingTraceDomain=(?:0|-1|pathLightingDomain|scatter.diffuse\?pathLightingDomain:-1);/g, "");
}
function pathShader2(atlases, fallback, instanced, opaque) {
  return pathTransportShader2(atlases, fallback, instanced, opaque, `layout(location=2) out vec4 outAuxiliary;
uniform sampler2D history,guideHistory,auxiliaryHistory,lightTable,environmentTable;`) + /* glsl */
  `
void main() {
  ivec2 pixel=ivec2(gl_FragCoord.xy);vec2 cameraPixel=gl_FragCoord.xy;
  vec4 previous=vec4(0);vec4 guide=vec4(0);vec4 auxiliary=vec4(0);
  if(uAccumulation.x>0.0){previous=texelFetch(history,pixel,0);guide=texelFetch(guideHistory,pixel,0);auxiliary=texelFetch(auxiliaryHistory,pixel,0);}
  float count=previous.a;
  bool adaptive=uConvergence.x>.5&&uConvergence.z>0.0;
  float pilots=pilotSamples(count,uConvergence.y);
  // Only independent pilots decide when the radiance stream may stop.
  if(adaptive&&samplingConverged(count,guide.z,guide.w,uConvergence.y,uConvergence.z)){
    outAuxiliary=auxiliary;outColor=previous;outGuide=guide;return;
  }
  // Use attempted passes, so rejecting an invalid sample never repeats it forever.
  uint baseSeed=uint(pixel.x)+uint(pixel.y)*uint(uResolution.x)+uSeed*1664525u+uint(uAccumulation.x)*1013904223u;
  vec3 sampleColor=vec3(0);float pilotMean=guide.z;float pilotM2=guide.w;float sampleLength=0.0;
  // Adaptive pilots are independent and scheduled only every fourth display
  // sample. Uniform rendering uses ordinary Welford moments without extra rays.
  bool takePilot=takePilotSample(count,uConvergence.y,adaptive);
  int iterations=((takePilot) ? (2) : (1));
  // One transport call site keeps textured shader compilation bounded. The
  // independent pilot uses the same camera/lens distribution as the display.
  for(int iteration=0;iteration<iterations;iteration++){
    rng=baseSeed^((iteration==1) ? (0x9e3779b9u) : (0u));random();random();
    vec2 jitter=vec2(random(),random())-vec2(.5);vec3 ro=uEye;vec3 rd=cameraRay(cameraPixel+jitter);
    if(uLens.x>0.0){float r=sqrt(random())*uLens.x;float phi=2.0*PI*random();vec3 focus=ro+rd*uLens.y/max(dot(rd,uForward),1e-6);
      ro+=uRight*r*cos(phi)+uUp*r*sin(phi);rd=normalize(focus-ro);}
    vec3 radiance=pathRadiance(ro,rd);
    // Keep exceptional arithmetic out of persistent HDR history. Do not clip
    // finite highlights or allow one invalid path to poison nearby display pixels.
    if(!finiteColor(radiance)){outAuxiliary=auxiliary;outColor=previous;outGuide=guide;return;}
    if(iteration==0){sampleColor=radiance;sampleLength=pathLength;}
    if(iteration==1||!adaptive){
      float momentCount=((adaptive) ? (pilots) : (count));
      float luminance=dot(radiance,vec3(.2126,.7152,.0722));
      float nextMean=pilotMean+(luminance-pilotMean)/(momentCount+1.0);
      float nextM2=pilotM2+(luminance-pilotMean)*(luminance-nextMean);
      pilotM2=((finiteColor(vec3(nextM2))) ? (nextM2) : (3.402823e38));pilotMean=nextMean;
    }
  }
  vec3 mean=previous.rgb+(sampleColor-previous.rgb)/(count+1.0);
  if(!finiteColor(mean)){outAuxiliary=auxiliary;outColor=previous;outGuide=guide;return;}
  if(count==0.0){
    vec3 ray=cameraRay(cameraPixel);float forwardDistance=max(dot(ray,uForward),1e-6);
    float minT=max(1e-6,uClipRange.x/forwardDistance);float maxT=uClipRange.y/forwardDistance;
    for(int layer=0;layer<128;layer++){
      Hit hit=trace(uEye,ray,maxT,false,minT);if(hit.mesh<0){break;}
      vec3 p=uEye+ray*hit.t;
      if(surfaceOpacity(hit,p)>0.0){
        Material m=surfaceMaterial(hit,p);vec2 normal=octEncode(hit.geometricNormal);
        uvec2 encoded=uvec2(round((normal*.5+vec2(.5))*4095.0));
        guide=vec4(hit.t*forwardDistance,float(encoded.x+encoded.y*4096u),0,0);
        // Display guides only: gamma-encoded albedo, roughness, transmission and metallic.
        // Transport continues using the full authored material precision.
        uvec3 rgb=uvec3(round(pow(clamp(m.albedo,vec3(0),vec3(1)),vec3(1.0/2.2))*255.0));
        auxiliary.x=float(rgb.x+rgb.y*256u+rgb.z*65536u);
        auxiliary.y=float(uint(round(m.roughness*255.0))+uint(round(m.transmission*255.0))*256u+uint(round(m.metallic*127.0))*65536u+((mapBinding(hit.mesh,2)>=0) ? (8388608u) : (0u)));
        break;
      }
      minT=hit.t+max(1e-6,abs(hit.t)*1e-6);
    }
  }
  auxiliary.z+=(sampleLength-auxiliary.z)/(count+1.0);
  auxiliary.w=max(auxiliary.w,dot(sampleColor,vec3(.2126,.7152,.0722)));
  outAuxiliary=auxiliary;outColor=vec4(mean,count+1.0);outGuide=vec4(guide.xy,pilotMean,max(pilotM2,0.0));
}
`;
}

// ../sdk-oct2/src/viewing/techniques/pathTracing/webGL/technique.ts
function webglPathTracingTechnique(options = {}) {
  const settings = { ...pathTracingPreset(options.preset), ...options.settings };
  validatePathTracingSettings(settings);
  const pack = createScenePacker(options.instancing, options.bvh), textureSize = materialTextureSize(options.textureSize);
  const snapshots = /* @__PURE__ */ new WeakMap();
  const runtimes = /* @__PURE__ */ new WeakMap();
  const histories = /* @__PURE__ */ new WeakMap();
  const technique = {
    id: "pathTracing",
    retainOnInvalidate: true,
    disposeView(view) {
      pack.release(view);
      snapshots.delete(view);
      runtimes.delete(view);
      histories.delete(view);
    },
    async prepare(view, signal) {
      if (view.sectionPlanesList.some((p) => p.active)) throw new Error("Path tracing does not support section planes; raster remains available.");
      const data = await pack(view.viewer.scene, {}, signal, view, textureSize);
      await runtimes.get(view)?.prepareUpdate(data, signal);
      signal.throwIfAborted();
      return data;
    },
    create(context, initial, view) {
      const gl = context.gl;
      if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("WebGL path tracing requires EXT_color_buffer_float; raster remains available.");
      if (context.resourceLifetime?.aborted || gl.isContextLost()) throw new Error("WebGL context lifetime ended before path tracer creation.");
      let data = initial, opaque = opaqueScene(data), disposed = false, frame;
      let accumulation;
      let lightTexture, environmentTexture;
      let packedLights;
      let lightCount = 0, analyticCount = 0, environmentVersion = -1, environmentIntegral = 0, lightsKey = "", selectionKey = "", revision = 0;
      const progress = new PathProgress(settings);
      const disposeTables = () => {
        if (lightTexture) gl.deleteTexture(lightTexture);
        if (environmentTexture) gl.deleteTexture(environmentTexture);
        lightTexture = environmentTexture = void 0;
        packedLights = void 0;
      };
      const upload = (values, width, height) => {
        const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        if (width > max || height > max) throw new Error("Path lighting table exceeds WebGL texture limits.");
        const texture = gl.createTexture();
        if (!texture) throw new Error("Path lighting texture allocation failed.");
        try {
          gl.activeTexture(gl.TEXTURE0 + 11);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, height);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          uploadTextureRange(gl, width, values, 0, values.length, 0);
          if (gl.getError() !== gl.NO_ERROR) throw new Error("Uploading path lighting table failed.");
          return texture;
        } catch (error) {
          gl.deleteTexture(texture);
          throw error;
        }
      };
      function synchronize() {
        validatePathTracingSettings(settings);
        const lights = [...viewPathLights(view), ...options.lights ?? []], key = JSON.stringify(lights), ibl = view.lights.ibl;
        if (!environmentTexture || environmentVersion !== ibl.environmentVersion) {
          const hdr = ibl.environmentHDR, measurement = { integral: 4 * Math.PI };
          const values = hdr ? environmentDistribution(hdr.width, hdr.height, hdr.data, measurement) : new Float32Array([0, 0, 0, 1]);
          const next = upload(values, hdr?.width ?? 1, hdr?.height ?? 1);
          if (environmentTexture) gl.deleteTexture(environmentTexture);
          environmentTexture = next;
          environmentVersion = ibl.environmentVersion;
          environmentIntegral = measurement.integral;
          revision++;
        }
        if (!packedLights || key !== lightsKey) {
          packedLights = packPathLights(data, lights);
          lightsKey = key;
          selectionKey = "";
        }
        const power = ibl.applied && ibl.possible ? environmentIntegral * ibl.intensity * settings.environmentIntensity : 0;
        if (!lightTexture || selectionKey !== String(power)) {
          updateLightSelection(packedLights, power);
          const next = upload(packedLights.values, 1024, Math.max(1, Math.ceil(packedLights.values.length / 4096)));
          if (lightTexture) gl.deleteTexture(lightTexture);
          lightTexture = next;
          lightCount = packedLights.count;
          analyticCount = packedLights.analyticCount;
          selectionKey = String(power);
          revision++;
        }
      }
      let uniforms;
      const kernel = {
        source: pathShader2,
        reservedTextures: 16,
        progress,
        signature() {
          synchronize();
          return [...radianceSettings(settings), revision, ...view.lights.hemispheric.worldUp];
        },
        createAccumulation() {
          accumulation = createPathAccumulation2(gl, settings, () => frame, context.resourceLifetime);
          histories.set(view, accumulation);
          return accumulation;
        },
        bind(program, unit) {
          uniforms ??= Object.fromEntries(["history", "guideHistory", "auxiliaryHistory", "lightTable", "environmentTable", "uPath", "uSeed", "uLimits", "uConvergence", "uLighting", "uLens", "uWorldUp"].map((n) => [n, gl.getUniformLocation(program, n)]));
          const u = uniforms;
          gl.uniform1i(u.history, unit);
          gl.uniform1i(u.guideHistory, unit + 1);
          gl.uniform1i(u.auxiliaryHistory, unit + 2);
          gl.activeTexture(gl.TEXTURE0 + 11);
          gl.bindTexture(gl.TEXTURE_2D, lightTexture);
          gl.uniform1i(u.lightTable, 11);
          gl.activeTexture(gl.TEXTURE0 + 12);
          gl.bindTexture(gl.TEXTURE_2D, environmentTexture);
          gl.uniform1i(u.environmentTable, 12);
          gl.uniform4f(u.uPath, settings.maxBounces, settings.rouletteStart, 0, lightCount);
          gl.uniform1ui(u.uSeed, settings.seed);
          gl.uniform4f(u.uLimits, settings.diffuseBounces, settings.specularBounces, settings.transmissionBounces, opaque ? 1 : 0);
          gl.uniform4f(u.uConvergence, settings.adaptive ? 1 : 0, settings.minSamples, settings.convergenceThreshold, 0);
          gl.uniform4f(u.uLighting, settings.environmentIntensity, settings.environmentRotation * Math.PI / 180, settings.sunAngularDiameter * Math.PI / 360, view.lights.ibl.environmentHDR ? 1 : 0);
          gl.uniform4f(u.uLens, settings.aperture, settings.focusDistance, analyticCount, 0);
          const up = view.lights.hemispheric.worldUp;
          gl.uniform3f(u.uWorldUp, up[0], up[1], up[2]);
        }
      };
      let renderer;
      try {
        renderer = createSharedRenderer2(context, data, void 0, void 0, true, kernel);
      } catch (error) {
        disposeTables();
        throw error;
      }
      snapshots.set(view, data);
      runtimes.set(view, renderer);
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        renderer.dispose();
        disposeTables();
        context.resourceLifetime?.removeEventListener("abort", dispose);
        if (runtimes.get(view) === renderer) {
          runtimes.delete(view);
          snapshots.delete(view);
          histories.delete(view);
        }
      };
      context.resourceLifetime?.addEventListener("abort", dispose, { once: true });
      return {
        output: "linear-hdr",
        isReady: renderer.isReady,
        update(prepared) {
          const next = prepared;
          if (!renderer.update(next)) return false;
          data = next;
          opaque = opaqueScene(data);
          packedLights = void 0;
          selectionKey = "";
          snapshots.set(view, data);
          runtimes.set(view, renderer);
          if (accumulation) histories.set(view, accumulation);
          return true;
        },
        render(nextFrame) {
          if (disposed) return;
          frame = nextFrame;
          if (view.camera.projectionType !== PerspectiveProjectionType) throw new Error("Path tracing requires a perspective camera.");
          if (frame.output.colorSpace !== "linear-hdr") throw new Error("Path tracing requires a linear-HDR host target; raster remains available.");
          view.effects.tonemap.enabled = true;
          view.effects.tonemap.mode = settings.toneMapping;
          view.effects.tonemap.exposure = settings.exposure;
          const camera = view.camera, m = camera.inverseViewMatrix;
          renderer.draw(
            { basis: () => ({ eye: Array.from(camera.eye), right: [m[0], m[1], m[2]], up: [m[4], m[5], m[6]], forward: [-m[8], -m[9], -m[10]], tanHalfFov: 1 / camera.projMatrix[5] }) },
            { pbr: true, textures: true, shadows: true, transparency: true, smoothShading: true, antialiasing: "none", bounces: settings.maxBounces, lightAngle: 0, scale: 1 },
            frame,
            context.getEnvironment?.(view)
          );
        },
        dispose
      };
    }
  };
  return Object.assign(technique, {
    settings,
    getSnapshot: (view) => snapshots.get(view),
    getRuntime: (view) => runtimes.get(view),
    /** Borrowed raw HDR mean/count texture for diagnostics; never mutate or delete. */
    getHistory: (view) => histories.get(view)?.history
  });
}
export {
  pathTracingPreset,
  validatePathTracingSettings,
  webglPathTracingTechnique,
  webgpuPathTracingTechnique
};
