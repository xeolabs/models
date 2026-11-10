import {
  ClampToEdgeWrapping,
  LIGHTING_DOMAINS_GLSL,
  LIGHTING_DOMAINS_WGSL,
  LightingDomainTable,
  MirroredRepeatWrapping,
  NearestFilter,
  SolidPrimitive,
  SurfacePrimitive,
  TrianglesPrimitive,
  createMat4Float64,
  inverseMat4,
  octDecodeNormalsU16
} from "./chunk-3FCFHIC2.js";

// ../sdk-oct2/src/viewing/techniques/rayTracing/shared/materials.ts
var MATERIAL_TEXTURE_SIZE = 512;
function materialTextureSize(requested = MATERIAL_TEXTURE_SIZE, count = 1) {
  if (![512, 1024, 2048].includes(requested)) throw new Error("Texture size must be 512, 1024 or 2048.");
  let size = requested;
  while (size > 512 && size * size * Math.max(1, count) * 4 > 128 * 1024 * 1024) size = size / 2;
  return size;
}
var mapSlots = ["color", "metallicRoughness", "normals", "emissive", "occlusion"];
function textureImageKey(texture) {
  return texture.compressed ? texture : texture.imageData ?? texture.image ?? texture;
}
async function decodeTexture(texture, signal, textureSize = MATERIAL_TEXTURE_SIZE) {
  textureSize = materialTextureSize(textureSize);
  signal?.throwIfAborted();
  if (texture.compressed) throw new Error(`Texture '${texture.id}': GPU-compressed textures are not supported by this ray tracer.`);
  if (texture.imageData) {
    const { width, height, data } = texture.imageData;
    if (!(width > 0 && height > 0) || data.length !== width * height * 4) throw new Error(`Invalid pixels: ${texture.id}`);
    if (width <= textureSize && height <= textureSize) return { width, height, data: new Uint8ClampedArray(data) };
    const input = new OffscreenCanvas(width, height);
    input.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
    const output = new OffscreenCanvas(Math.min(width, textureSize), Math.min(height, textureSize));
    const context = output.getContext("2d");
    context.drawImage(input, 0, 0, output.width, output.height);
    return { width: output.width, height: output.height, data: context.getImageData(0, 0, output.width, output.height).data };
  }
  let image = texture.image, owned;
  try {
    if (!image) {
      let blob;
      if (texture.buffers?.length) blob = new Blob(texture.buffers, { type: typeof texture.mediaType === "string" ? texture.mediaType : "image/png" });
      else if (texture.src) {
        const response = await fetch(texture.src, { signal });
        if (!response.ok) throw new Error(`Texture '${texture.id}': HTTP ${response.status}`);
        blob = await response.blob();
      }
      if (!blob) throw new Error(`Texture '${texture.id}' has no image data.`);
      owned = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
      image = owned;
    } else if (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement) await image.decode();
    signal?.throwIfAborted();
    const width = Math.min(textureSize, image.naturalWidth || image.width);
    const height = Math.min(textureSize, image.naturalHeight || image.height);
    if (!(width > 0 && height > 0)) throw new Error(`Invalid image size: ${texture.id}`);
    const canvas = new OffscreenCanvas(width, height), context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, width, height);
    return { width, height, data: context.getImageData(0, 0, width, height).data };
  } finally {
    owned?.close();
  }
}
function createMaterialPacker(signal, textureSize = MATERIAL_TEXTURE_SIZE, deferImages = false) {
  const imageSources = [];
  const textureBindings = [];
  const images = [], bindings = [], pbr = [];
  const textureIds = /* @__PURE__ */ new Map(), bindingIds = /* @__PURE__ */ new Map();
  const wrap = (mode) => mode === ClampToEdgeWrapping ? 1 : mode === MirroredRepeatWrapping ? 2 : 0;
  return {
    images,
    imageSources,
    bindings,
    pbr,
    textureBindings,
    async mesh(mesh, includeUVs = true) {
      const material = mesh.material;
      const slots = includeUVs ? [] : void 0;
      const ids = [];
      for (const slot of mapSlots) {
        const texture = material?.[`${slot}Texture`];
        if (!texture && !includeUVs) {
          ids.push(-1);
          continue;
        }
        const channel = material?.[`${slot}TextureTexCoord`] ?? 0;
        const transform = Array.from(material?.[`${slot}TextureUVTransform`] ?? [1, 0, 0, 1, 0, 0]);
        slots?.push({ uvs: mesh.geometry.texCoordsCompressed?.[channel], transform, flipY: !!texture?.flipY });
        if (!texture) {
          ids.push(-1);
          continue;
        }
        const imageKey = textureImageKey(texture);
        let layer = textureIds.get(imageKey);
        if (layer === void 0) {
          if (imageSources.length >= 128) throw new Error("The ray tracer supports at most 128 material textures.");
          layer = imageSources.length;
          imageSources.push(texture);
          if (!deferImages) images.push(await decodeTexture(texture, signal, textureSize));
          textureIds.set(imageKey, layer);
        }
        const key = JSON.stringify([slot, layer, texture.wrapS, texture.wrapT, texture.magFilter, ...transform, !!texture.flipY, !!texture.mipmap]);
        const existing = bindingIds.get(key);
        if (existing !== void 0) {
          ids.push(existing);
          continue;
        }
        ids.push(bindings.length / 12);
        bindingIds.set(key, bindings.length / 12);
        textureBindings.push({ mesh, slot });
        bindings.push(
          layer,
          wrap(texture.wrapS),
          wrap(texture.wrapT),
          texture.magFilter === NearestFilter ? 1 : 0,
          ...transform.slice(0, 4),
          ...transform.slice(4),
          texture.flipY ? 1 : 0,
          texture.mipmap ? 1 : 0
        );
      }
      const record = [
        mesh.effectiveMetallic,
        mesh.effectiveRoughness,
        mesh.effectiveIor,
        mesh.effectiveAlphaMode,
        ...mesh.effectiveEmissiveColor,
        mesh.effectiveAlphaCutoff,
        ...ids.slice(0, 4),
        ids[4],
        mesh.effectiveTriplanarScale,
        0,
        0,
        mesh.effectiveTransmission,
        mesh.effectiveThickness,
        Number.isFinite(mesh.effectiveAttenuationDistance) ? 1 / mesh.effectiveAttenuationDistance : 0,
        0,
        ...mesh.effectiveAttenuationColor,
        0
      ];
      pbr.push(...record);
      return ids.some((id) => id >= 0) ? slots : void 0;
    }
  };
}
function resizeTexturePixels(source, width, height) {
  if (source.width === width && source.height === height) return source.data;
  const input = new OffscreenCanvas(source.width, source.height);
  input.getContext("2d").putImageData(new ImageData(source.data, source.width, source.height), 0, 0);
  const output = new OffscreenCanvas(width, height), context = output.getContext("2d");
  context.drawImage(input, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

// ../sdk-oct2/src/viewing/techniques/rayTracing/shared/lightingDomains.ts
function appendLightingDomains(materials, scene, origin, count) {
  if (!scene || !Object.keys(scene.lightingDomains ?? {}).length) return materials;
  const table = new LightingDomainTable();
  table.update(scene, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -origin[0], -origin[1], -origin[2], 1]);
  const base = Math.ceil(materials.length / 8) * 8, address = base / 4;
  const result = new Float32Array(base + table.data.length);
  result.set(materials);
  for (let i = 0; i < count; i++) if (result[i * 8 + 7] > 0) result[i * 8 + 7] = address + result[i * 8 + 7] * 2;
  for (const domain of Object.values(scene.lightingDomains)) {
    const header = domain._slot * 8, references = table.data[header] * 4;
    for (let i = 0; i < table.data[header + 1]; i++) table.data[references + i * 4] += address;
    table.data[header] += address;
  }
  result.set(table.data, base);
  return result;
}
var TRACING_DOMAINS_GLSL = "vec3 domainVisibility(vec3 p,vec3 n,vec3 l,float distance);\n" + LIGHTING_DOMAINS_GLSL.replace(
  /uniform highp sampler2D uLightingDomains;[\s\S]*?\n}/,
  "vec4 domainRecord(int address) { return readData(uMaterials,address); }"
).replace("float attenuation=1.0;", "float attenuation=1.0;float shadowDistance=1e30;").replace("float distance=length(delta);", "float distance=length(delta);shadowDistance=distance;").replace("*color.rgb*attenuation;", "*color.rgb*attenuation*domainVisibility(p,n,l,shadowDistance);") + "\nint lightingTraceDomain = -1;\n";
var TRACING_DOMAINS_WGSL = LIGHTING_DOMAINS_WGSL.replace(/@group\(0\) @binding\(10\)[^;]*;/, "").replace(/lightingDomains\[/g, "materials[").replace("var attenuation=1.0;", "var attenuation=1.0;var shadowDistance=1e30;").replace("let distance=length(delta);", "let distance=length(delta);shadowDistance=distance;").replace("*color.rgb*attenuation;", "*color.rgb*attenuation*domainVisibility(p,n,l,shadowDistance);") + "\nvar<private> lightingTraceDomain:i32 = -1;\n";

// ../sdk-oct2/src/viewing/techniques/rayTracing/shared/clipBoxes.ts
function localClipBoxRows(mesh, origin = [0, 0, 0]) {
  const out = new Float32Array(12);
  if (!mesh.clipBox?.active) return out;
  const m = mesh.worldMatrix;
  const rows = mesh.clipBox._relativeRows([m[12], m[13], m[14]], new Float64Array(12));
  const local = new Float64Array(12);
  for (let r = 0; r < 3; r++) {
    const base = r * 4;
    for (let c = 0; c < 3; c++) local[base + c] = rows[base] * m[c * 4] + rows[base + 1] * m[c * 4 + 1] + rows[base + 2] * m[c * 4 + 2];
    local[base + 3] = rows[base + 3] + local[base] * origin[0] + local[base + 1] * origin[1] + local[base + 2] * origin[2];
  }
  out.set(local);
  if (!out.every(Number.isFinite)) {
    out.fill(0);
    out[3] = 2;
  }
  return out;
}
function appendFlatClipBoxes(materials, meshes, origin) {
  const clipped = meshes.filter((mesh) => mesh.clipBox?.active);
  if (!clipped.length) return materials;
  const result = new Float32Array(materials.length + clipped.length * 12);
  result.set(materials);
  let offset = materials.length;
  meshes.forEach((mesh, i) => {
    if (!mesh.clipBox?.active) return;
    result[i * 8 + 6] = offset / 4;
    result.set(mesh.clipBox._relativeRows(origin), offset);
    offset += 12;
  });
  return result;
}

// ../sdk-oct2/src/viewing/techniques/rayTracing/shared/bvh.ts
async function buildBVH(triangles, signal, options = {}) {
  signal?.throwIfAborted();
  if (options.worker !== false && (options.worker || triangles.length >= 1e5 * 12) && typeof Worker !== "undefined" && !workerBusy) {
    const result = await buildInWorker(triangles, signal, options);
    if (result) return result;
  }
  const build = buildBVHSteps(triangles, options);
  let deadline = performance.now() + 8;
  for (; ; ) {
    signal?.throwIfAborted();
    const step = build.next();
    if (step.done) return step.value;
    if (performance.now() >= deadline) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      deadline = performance.now() + 8;
    }
  }
}
var workerBusy = false;
async function buildInWorker(triangles, signal, options) {
  workerBusy = true;
  let worker, url;
  try {
    url = URL.createObjectURL(new Blob([`
      const build = ${buildBVHSteps.toString()};
      onmessage = ({data}) => {
        try {
          const iterator = build(data.triangles, data.options);
          let step;
          do { step = iterator.next(); } while (!step.done);
          const result = step.value;
          postMessage({result}, [result.triangles.buffer, result.nodes.buffer]);
        } catch (error) { postMessage({error: String(error)}); }
      };
      postMessage({ready:true});
    `], { type: "text/javascript" }));
    worker = new Worker(url);
    return await new Promise((resolve, reject) => {
      let transferred = false, settled = false;
      const finish = (result, error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        error ? reject(error) : resolve(result);
      };
      const abort = () => finish(void 0, signal?.reason ?? new DOMException("Aborted", "AbortError"));
      const timer = setTimeout(() => finish(), 2e3);
      signal?.addEventListener("abort", abort, { once: true });
      worker.onerror = (event) => {
        event.preventDefault();
        finish(void 0, transferred ? new Error(event.message || "BVH worker failed.") : void 0);
      };
      worker.onmessage = ({ data }) => {
        if (settled) return;
        if (data.ready && !transferred) {
          clearTimeout(timer);
          if (signal?.aborted) {
            abort();
            return;
          }
          const owned = options.inPlace ? triangles : triangles.slice();
          try {
            worker.postMessage({ triangles: owned, options: { ...options, inPlace: true } }, [owned.buffer]);
            transferred = true;
          } catch (error) {
            finish(void 0, error);
          }
        } else if (data.error) finish(void 0, new Error(data.error));
        else if (data.result) finish(data.result);
      };
      if (signal?.aborted) abort();
    });
  } catch (error) {
    if (worker) throw error;
    signal?.throwIfAborted();
    return void 0;
  } finally {
    worker?.terminate();
    if (url) URL.revokeObjectURL(url);
    workerBusy = false;
  }
}
function* buildBVHSteps(triangles, options = {}) {
  const count = triangles.length / 12;
  if (!Number.isInteger(count)) throw new Error("Invalid ray-tracing triangle stream.");
  const leafSize = options.leafSize ?? 8, maxLeafSize = options.maxLeafSize ?? 16;
  if (!Number.isInteger(leafSize) || leafSize < 1 || leafSize > 16 || !Number.isInteger(maxLeafSize) || maxLeafSize < leafSize || maxLeafSize > 16) {
    throw new Error("BVH leaf sizes must be integers between 1 and 16.");
  }
  if (!count) return { triangles, nodes: new Float32Array(0), nodeCount: 0 };
  const morton = options.strategy === "morton";
  const order = new Uint32Array(count), bounds = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    order[i] = i;
    for (let axis = 0; axis < 3; axis++) {
      const a = triangles[i * 12 + axis], b = a + triangles[i * 12 + 4 + axis], c = a + triangles[i * 12 + 8 + axis];
      const lo = Math.min(a, b, c), hi = Math.max(a, b, c);
      if (!Number.isFinite(lo + hi)) throw new Error("Non-finite BVH coordinates.");
      const padding = Math.max(2e-4, Math.max(Math.abs(lo), Math.abs(hi)) * 12e-8);
      bounds[i * 6 + axis] = lo - padding;
      bounds[i * 6 + axis + 3] = hi + padding;
    }
    if ((i & 65535) === 65535) yield;
  }
  let codes;
  if (morton) {
    codes = new Uint32Array(count);
    const low = new Float64Array([Infinity, Infinity, Infinity]), high = new Float64Array([-Infinity, -Infinity, -Infinity]);
    for (let i = 0; i < count; i++) for (let a = 0; a < 3; a++) {
      const center = (bounds[i * 6 + a] + bounds[i * 6 + a + 3]) * 0.5;
      low[a] = Math.min(low[a], center);
      high[a] = Math.max(high[a], center);
    }
    const spread = (v) => {
      v = (v | v << 16) & 50331903;
      v = (v | v << 8) & 50393103;
      v = (v | v << 4) & 51130563;
      return (v | v << 2) & 153391689;
    };
    for (let i = 0; i < count; i++) {
      let code = 0;
      for (let a = 0; a < 3; a++) {
        const center = (bounds[i * 6 + a] + bounds[i * 6 + a + 3]) * 0.5;
        const value = Math.min(1023, Math.max(0, Math.floor((center - low[a]) * 1023 / (high[a] - low[a] || 1))));
        code |= spread(value) << a;
      }
      codes[i] = code;
      if ((i & 65535) === 65535) yield;
    }
    const scratch = new Uint32Array(count), histogram = new Uint32Array(1024);
    for (let shift = 0; shift < 30; shift += 10) {
      histogram.fill(0);
      for (let i = 0; i < count; i++) histogram[codes[order[i]] >>> shift & 1023]++;
      let sum = 0;
      for (let i = 0; i < 1024; i++) {
        const n = histogram[i];
        histogram[i] = sum;
        sum += n;
      }
      for (let i = 0; i < count; i++) {
        const id = order[i];
        scratch[histogram[codes[id] >>> shift & 1023]++] = id;
      }
      order.set(scratch);
      yield;
    }
  }
  let nodes = new Float32Array(Math.max(12, Math.ceil(count / 4) * 12)), nodeCount = 0;
  const tasks = [0, count, 0, -1];
  const box = new Float64Array(6), centers = new Float64Array(6);
  const bins = new Float64Array(72), counts = new Uint32Array(12), costs = new Float64Array(11);
  const combined = new Float64Array(6);
  while (tasks.length) {
    const finish = tasks.pop(), depth = tasks.pop(), end = tasks.pop(), start = tasks.pop();
    if (finish >= 0) {
      nodes[finish * 12 + 3] = nodeCount;
      nodes[finish * 12 + 9] = nodes[(finish + 1) * 12 + 3];
      continue;
    }
    const index = nodeCount++, offset = index * 12;
    if (offset + 12 > nodes.length) {
      const grown = new Float32Array(Math.max(offset + 12, nodes.length * 2));
      grown.set(nodes);
      nodes = grown;
    }
    empty(box);
    empty(centers);
    for (let i = start; i < end; i++) {
      const id = order[i], o = id * 6;
      extend(box, 0, bounds, o);
      for (let axis = 0; axis < 3; axis++) {
        const center = (bounds[o + axis] + bounds[o + axis + 3]) * 0.5;
        centers[axis] = Math.min(centers[axis], center);
        centers[axis + 3] = Math.max(centers[axis + 3], center);
      }
      if ((i & 65535) === 65535) yield;
    }
    nodes[offset] = box[0];
    nodes[offset + 1] = box[1];
    nodes[offset + 2] = box[2];
    nodes[offset + 4] = box[3];
    nodes[offset + 5] = box[4];
    nodes[offset + 6] = box[5];
    nodes[offset + 7] = start;
    nodes[offset + 8] = end - start;
    if (end - start > leafSize) {
      let middle = start + end >>> 1, bestAxis = -1, bestSplit = 0, bestCost = Infinity;
      if (morton) {
        const first = codes[order[start]], last = codes[order[end - 1]], bit = 31 - Math.clz32(first ^ last);
        if (bit >= 0 && depth < 40) {
          const mask = 1 << bit;
          let left = start + 1, right = end;
          while (left < right) {
            const pivot = left + right >>> 1;
            if ((codes[order[pivot]] & mask) === (first & mask)) left = pivot + 1;
            else right = pivot;
          }
          if (left > start && left < end) middle = left;
        }
      } else if (depth < 40) {
        let widest = 0;
        for (let a = 1; a < 3; a++) if (centers[a + 3] - centers[a] > centers[widest + 3] - centers[widest]) widest = a;
        for (let axis = 0; axis < 3; axis++) {
          if ((options.axes ?? "widest") === "widest" && axis !== widest) continue;
          const span = centers[axis + 3] - centers[axis];
          if (span <= 1e-8) continue;
          const low = centers[axis], scale = 12 / span;
          counts.fill(0);
          for (let b = 0; b < 12; b++) empty(bins, b * 6);
          for (let i = start; i < end; i++) {
            const o = order[i] * 6, b = Math.min(11, Math.floor(((bounds[o + axis] + bounds[o + axis + 3]) * 0.5 - low) * scale));
            counts[b]++;
            extend(bins, b * 6, bounds, o);
            if ((i & 65535) === 65535) yield;
          }
          let total = 0;
          empty(combined);
          for (let b = 0; b < 11; b++) {
            total += counts[b];
            if (counts[b]) extend(combined, 0, bins, b * 6);
            costs[b] = area(combined) * total;
          }
          total = 0;
          empty(combined);
          for (let b = 11; b > 0; b--) {
            total += counts[b];
            if (counts[b]) extend(combined, 0, bins, b * 6);
            costs[b - 1] += area(combined) * total;
          }
          for (let b = 0; b < 11; b++) if (costs[b] < bestCost) {
            bestCost = costs[b];
            bestAxis = axis;
            bestSplit = b;
          }
        }
        if (end - start <= maxLeafSize && bestCost + area(box) >= area(box) * (end - start)) {
          nodes[offset + 3] = nodeCount;
          continue;
        }
        if (bestAxis >= 0) {
          const low = centers[bestAxis], scale = 12 / (centers[bestAxis + 3] - low);
          let left = start, right = end - 1;
          while (left <= right) {
            const o = order[left] * 6;
            const b = Math.min(11, Math.floor(((bounds[o + bestAxis] + bounds[o + bestAxis + 3]) * 0.5 - low) * scale));
            if (b <= bestSplit) left++;
            else {
              const id = order[left];
              order[left] = order[right];
              order[right--] = id;
            }
          }
          if (left > start && left < end) middle = left;
        }
      }
      nodes[offset + 7] = -1;
      nodes[offset + 8] = 0;
      tasks.push(0, 0, 0, index, middle, end, depth + 1, -1, start, middle, depth + 1, -1);
    } else nodes[offset + 3] = nodeCount;
    if ((index & 2047) === 2047) yield;
  }
  const sorted = options.inPlace ? triangles : new Float32Array(triangles.length);
  if (options.inPlace) {
    const scratch = new Float32Array(12);
    for (let i = 0; i < count; i++) {
      if (order[i] === i) continue;
      for (let k = 0; k < 12; k++) scratch[k] = triangles[i * 12 + k];
      let current = i, steps = 0;
      while (order[current] !== i) {
        const next = order[current];
        for (let k = 0; k < 12; k++) triangles[current * 12 + k] = triangles[next * 12 + k];
        order[current] = current;
        current = next;
        if ((++steps & 65535) === 65535) yield;
      }
      for (let k = 0; k < 12; k++) triangles[current * 12 + k] = scratch[k];
      order[current] = current;
      if ((i & 65535) === 65535) yield;
    }
  } else for (let i = 0; i < count; i++) {
    for (let k = 0; k < 12; k++) sorted[i * 12 + k] = triangles[order[i] * 12 + k];
    if ((i & 65535) === 65535) yield;
  }
  return { triangles: sorted, nodes: nodes.length === nodeCount * 12 ? nodes : nodes.slice(0, nodeCount * 12), nodeCount };
  function empty(out, offset = 0) {
    out[offset] = out[offset + 1] = out[offset + 2] = Infinity;
    out[offset + 3] = out[offset + 4] = out[offset + 5] = -Infinity;
  }
  function extend(out, offset, source, start) {
    for (let a = 0; a < 3; a++) {
      out[offset + a] = Math.min(out[offset + a], source[start + a]);
      out[offset + a + 3] = Math.max(out[offset + a + 3], source[start + a + 3]);
    }
  }
  function area(b) {
    const x = Math.max(0, b[3] - b[0]), y = Math.max(0, b[4] - b[1]), z = Math.max(0, b[5] - b[2]);
    return x * y + y * z + z * x;
  }
}

// ../sdk-oct2/src/viewing/techniques/rayTracing/shared/packScene.ts
var FloatStream = class {
  data;
  length = 0;
  constructor(capacity) {
    this.data = new Float32Array(capacity);
  }
  finish() {
    return this.length ? this.data.subarray(0, this.length) : new Float32Array(4);
  }
};
async function packScene(scene, surfaces = {}, signal, view, requestedTextureSize = 512, options = {}) {
  const allMeshes = [];
  for (const mesh of Object.values(scene.meshes)) allMeshes.push(mesh);
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const mesh of allMeshes) {
    const b = mesh.geometry.aabb, m = mesh.worldMatrix;
    if (!b) continue;
    for (let corner = 0; corner < 8; corner++)
      for (let axis = 0; axis < 3; axis++) {
        const value = m[axis] * b[corner & 1 ? 3 : 0] + m[axis + 4] * b[corner & 2 ? 4 : 1] + m[axis + 8] * b[corner & 4 ? 5 : 2] + m[axis + 12];
        bounds[axis] = Math.min(bounds[axis], value);
        bounds[axis + 3] = Math.max(bounds[axis + 3], value);
      }
  }
  const origin = bounds.every(Number.isFinite) && bounds.some((v) => Math.abs(v) > 1e4) ? [0, 1, 2].map((axis) => (bounds[axis] + bounds[axis + 3]) / 2) : [0, 0, 0];
  const meshes = allMeshes.filter((mesh) => {
    const object = mesh.object && view?.objects[mesh.object.id];
    return !object || object.visible && !object.culled;
  });
  let triangleCapacity = 0, normalCapacity = 0, uvCapacity = 0;
  for (const mesh of meshes) {
    const count = (mesh.geometry.indices?.length ?? mesh.geometry.positionsCompressed.length / 3) / 3;
    triangleCapacity += count;
    if (mesh.geometry.normalsCompressed) normalCapacity += count * 12;
    if (mapSlots.some((slot) => mesh.material?.[`${slot}Texture`])) uvCapacity += count * 40;
  }
  if (triangleCapacity > 2e6 || meshes.length > 8192) {
    throw new Error("The ray-tracing add-on supports at most 2,000,000 triangles and 8,192 meshes.");
  }
  signal?.throwIfAborted();
  const triangles = new FloatStream(triangleCapacity * 12), normals = new FloatStream(normalCapacity), uvs = new FloatStream(uvCapacity);
  const materials = [], sourceMeshes = [];
  const textureInputs = /* @__PURE__ */ new Set();
  for (const mesh of meshes)
    for (const slot of mapSlots) {
      const texture = mesh.material?.[`${slot}Texture`];
      if (texture) textureInputs.add(textureImageKey(texture));
    }
  const textureCount = textureInputs.size;
  const textureSize = materialTextureSize(requestedTextureSize, textureCount);
  const materialPacker = createMaterialPacker(signal, textureSize, options.deferTextures);
  const geometryUses = /* @__PURE__ */ new Map();
  for (const mesh of meshes) geometryUses.set(mesh.geometry, (geometryUses.get(mesh.geometry) ?? 0) + 1);
  const decodedPositions = /* @__PURE__ */ new WeakMap();
  const inverse = createMat4Float64();
  let vertices = new Float64Array(0), transformedNormals = new Float32Array(0);
  const decodedNormals = /* @__PURE__ */ new WeakMap();
  let deadline = performance.now() + 8;
  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    const object = mesh.object && view?.objects[mesh.object.id];
    if (object?.viewTransform || mesh.representationId || geometry.framesCompressed?.length || geometry.morphTargets?.length || geometry.vertexStatesCompressed?.length) {
      throw new Error(
        "The ray-tracing add-on currently requires static triangle meshes without ViewTransforms or representations."
      );
    }
    if (![TrianglesPrimitive, SolidPrimitive, SurfacePrimitive].includes(geometry.primitive)) {
      throw new Error(`Only triangle meshes are supported: ${mesh.id}`);
    }
    const p = geometry.positionsCompressed, bounds2 = geometry.aabb, matrix = mesh.worldMatrix;
    const indices = geometry.indices;
    const count = indices?.length ?? p.length / 3;
    if (!bounds2 || p.length % 3 || count % 3 || !finite(bounds2) || !finite(matrix))
      throw new Error(`Invalid geometry: ${mesh.id}`);
    if (performance.now() >= deadline) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      signal?.throwIfAborted();
      deadline = performance.now() + 8;
    }
    if (vertices.length < p.length) vertices = new Float64Array(p.length);
    let vertexNormals;
    if (geometry.normalsCompressed) {
      let decoded = decodedNormals.get(geometry);
      if (!decoded) {
        decoded = octDecodeNormalsU16(geometry.normalsCompressed);
        if (geometryUses.get(geometry) > 1) decodedNormals.set(geometry, decoded);
      }
      if (transformedNormals.length < decoded.length) transformedNormals = new Float32Array(decoded.length);
      vertexNormals = transformedNormals;
      inverseMat4(matrix, inverse);
      for (let i = 0; i < decoded.length; i += 3) {
        if (i % (16384 * 3) === 0 && performance.now() >= deadline) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          signal?.throwIfAborted();
          deadline = performance.now() + 8;
        }
        const x = decoded[i], y = decoded[i + 1], z = decoded[i + 2];
        const nx = inverse[0] * x + inverse[1] * y + inverse[2] * z;
        const ny = inverse[4] * x + inverse[5] * y + inverse[6] * z;
        const nz = inverse[8] * x + inverse[9] * y + inverse[10] * z;
        const length = Math.hypot(nx, ny, nz);
        const scale = Number.isFinite(length) && length > 0 ? 1 / length : 0;
        vertexNormals[i] = scale ? nx * scale : 0;
        vertexNormals[i + 1] = scale ? ny * scale : 0;
        vertexNormals[i + 2] = scale ? nz * scale : 0;
      }
    }
    const sx = (bounds2[3] - bounds2[0]) / 65535, sy = (bounds2[4] - bounds2[1]) / 65535, sz = (bounds2[5] - bounds2[2]) / 65535;
    let localPositions = decodedPositions.get(geometry);
    if (!localPositions && geometryUses.get(geometry) > 1) {
      localPositions = new Float64Array(p.length);
      for (let i = 0; i < p.length; i += 3) {
        localPositions[i] = bounds2[0] + p[i] * sx;
        localPositions[i + 1] = bounds2[1] + p[i + 1] * sy;
        localPositions[i + 2] = bounds2[2] + p[i + 2] * sz;
      }
      decodedPositions.set(geometry, localPositions);
    }
    const tx = matrix[12] - origin[0], ty = matrix[13] - origin[1], tz = matrix[14] - origin[2];
    for (let i = 0; i < p.length; i += 3) {
      if (i % (16384 * 3) === 0 && performance.now() >= deadline) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        signal?.throwIfAborted();
        deadline = performance.now() + 8;
      }
      const x = localPositions ? localPositions[i] : bounds2[0] + p[i] * sx;
      const y = localPositions ? localPositions[i + 1] : bounds2[1] + p[i + 1] * sy;
      const z = localPositions ? localPositions[i + 2] : bounds2[2] + p[i + 2] * sz;
      vertices[i] = matrix[0] * x + matrix[4] * y + matrix[8] * z + tx;
      vertices[i + 1] = matrix[1] * x + matrix[5] * y + matrix[9] * z + ty;
      vertices[i + 2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + tz;
    }
    let slots;
    const start = triangles.length / 12;
    for (let i = 0; i < count; i += 3) {
      if (i % (4096 * 3) === 0 && performance.now() >= deadline) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        signal?.throwIfAborted();
        deadline = performance.now() + 8;
      }
      const ia = indices ? indices[i] : i, ib = indices ? indices[i + 1] : i + 1, ic = indices ? indices[i + 2] : i + 2;
      const vertexCount = p.length / 3;
      if (!validIndex(ia, vertexCount) || !validIndex(ib, vertexCount) || !validIndex(ic, vertexCount)) {
        throw new Error(`Invalid triangle index: ${mesh.id}`);
      }
      const a = ia * 3, b = ib * 3, c = ic * 3;
      const ax = vertices[a], ay = vertices[a + 1], az = vertices[a + 2];
      const abx = vertices[b] - ax, aby = vertices[b + 1] - ay, abz = vertices[b + 2] - az;
      const acx = vertices[c] - ax, acy = vertices[c + 1] - ay, acz = vertices[c + 2] - az;
      const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
      const areaSquared = nx * nx + ny * ny + nz * nz;
      if (options.preserveSmallTriangles ? areaSquared === 0 : areaSquared < 1e-20) continue;
      if (triangles.length / 12 === start) slots = await materialPacker.mesh(mesh);
      const uvAddress = slots ? uvs.length / 40 + 1 : 0;
      if (slots)
        for (const slot of slots) {
          const transform = slot.transform, coords = slot.uvs;
          for (let corner = 0; corner < 3; corner++) {
            const index = corner === 0 ? ia : corner === 1 ? ib : ic;
            let x = 0, y = 0;
            if (coords) {
              const u = coords[index * 2], v = coords[index * 2 + 1];
              x = transform[0] * u + transform[2] * v + transform[4];
              y = transform[1] * u + transform[3] * v + transform[5];
              if (!Number.isFinite(x + y)) throw new Error(`Invalid UVs: ${mesh.id}`);
              if (slot.flipY) y = 1 - y;
            }
            uvs.data[uvs.length++] = x;
            uvs.data[uvs.length++] = y;
          }
          uvs.data[uvs.length++] = coords ? 1 : 0;
          uvs.data[uvs.length++] = 0;
        }
      const normalAddress = vertexNormals ? normals.length / 4 + 1 : 0;
      const t = triangles.length, out = triangles.data;
      out[t] = ax;
      out[t + 1] = ay;
      out[t + 2] = az;
      out[t + 3] = materials.length / 8;
      out[t + 4] = abx;
      out[t + 5] = aby;
      out[t + 6] = abz;
      out[t + 7] = normalAddress;
      out[t + 8] = acx;
      out[t + 9] = acy;
      out[t + 10] = acz;
      out[t + 11] = uvAddress;
      triangles.length += 12;
      if (vertexNormals)
        for (let corner = 0; corner < 3; corner++) {
          const index = (corner === 0 ? ia : corner === 1 ? ib : ic) * 3;
          const n = normals.length;
          normals.data[n] = vertexNormals[index];
          normals.data[n + 1] = vertexNormals[index + 1];
          normals.data[n + 2] = vertexNormals[index + 2];
          normals.data[n + 3] = 0;
          normals.length += 4;
        }
    }
    const triangleCount = triangles.length / 12 - start;
    if (!triangleCount) continue;
    sourceMeshes.push(mesh);
    const surface = surfaces[mesh.id] ?? { reflectivity: 0.1 };
    materials.push(
      ...Array.from(mesh.effectiveColor).map((value, i) => value * (object?.colorize?.[i] ?? 1)),
      Math.max(0, Math.min(1, surface.reflectivity)),
      surface.checker ? 1 : 0,
      Math.max(0, Math.min(1, mesh.effectiveOpacity * (object?.opacity ?? 1))),
      0,
      mesh.lightingDomain?._slot ?? 0
    );
  }
  if (!triangles.length && !view) throw new Error("Scene contains no triangles.");
  if (!triangles.length)
    return {
      origin,
      textureSize,
      triangles: new Float32Array(4),
      normals: new Float32Array(4),
      materials: new Float32Array(4),
      pbr: new Float32Array(4),
      uvs: new Float32Array(4),
      bindings: new Float32Array(4),
      images: [],
      nodes: new Float32Array(4),
      triangleCount: 0,
      meshCount: 0,
      nodeCount: 0,
      textureBindings: []
    };
  const bvh = await buildBVH(triangles.finish(), signal, {
    inPlace: true,
    axes: options.bvh?.axes,
    leafSize: options.bvh?.leafSize
  });
  return {
    ...bvh,
    origin,
    textureSize,
    sourceMeshes: options.trackMaterials ? sourceMeshes : void 0,
    normals: normals.finish(),
    materials: appendLightingDomains(
      appendFlatClipBoxes(new Float32Array(materials), sourceMeshes, origin),
      scene,
      origin,
      sourceMeshes.length
    ),
    pbr: new Float32Array(materialPacker.pbr),
    uvs: uvs.finish(),
    bindings: new Float32Array(materialPacker.bindings.length ? materialPacker.bindings : [0, 0, 0, 0]),
    imageSources: options.deferTextures ? materialPacker.imageSources : void 0,
    textureBindings: materialPacker.textureBindings,
    images: materialPacker.images,
    triangleCount: triangles.length / 12,
    meshCount: materials.length / 8
  };
}
function finite(values) {
  for (let i = 0; i < values.length; i++) if (!Number.isFinite(values[i])) return false;
  return true;
}
function validIndex(index, count) {
  return Number.isInteger(index) && index >= 0 && index < count;
}

// ../sdk-oct2/src/viewing/techniques/rayTracing/shared/geometryLayout.ts
var geometryKeys = ["triangles", "nodes", "normals", "uvs"];
var geometryUnits = [0, 2, 3, 5];
var GeometryStream = class {
  constructor(length, chunks) {
    this.length = length;
    this.chunks = chunks;
    this.byteLength = length * 4;
    this.liveLength = chunks.reduce((n, chunk) => n + chunk.values.length, 0);
  }
  length;
  chunks;
  array;
  byteLength;
  liveLength;
  read = () => {
    if (!this.array) {
      if (this.chunks.length === 1 && this.chunks[0].offset === 0 && this.chunks[0].values.length === this.length) this.array = this.chunks[0].values;
      else {
        this.array = new Float32Array(this.length);
        for (const chunk of this.chunks) this.array.set(chunk.values, chunk.offset);
      }
    }
    return this.array;
  };
  get materialized() {
    return this.array;
  }
};
function streamLiveLength(stream) {
  return "liveLength" in stream ? stream.liveLength : stream.length;
}
function streamChunks(stream) {
  return stream instanceof GeometryStream ? stream.chunks : [{ offset: 0, values: stream }];
}
function equal(a, b) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const x = new Uint32Array(a.buffer, a.byteOffset, a.length), y = new Uint32Array(b.buffer, b.byteOffset, b.length);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}
function reuseLocalStreams(entry, previous) {
  if (previous) {
    for (const key of geometryKeys) if (equal(entry[key], previous[key])) entry[key] = previous[key];
  }
}
var identity = (entry) => entry.identity ?? entry.revision;
function allocate(entries, previous, old, k, offsets, capacities) {
  const key = geometryKeys[k], reserved = [], pending = [];
  let live = 0, end = previous?.geometryLayout.streams[k].length ?? 0;
  for (let i = 0; i < entries.length; i++) {
    const size = entries[i][key].length, p = old.get(identity(entries[i]));
    live += size;
    if (p !== void 0 && size <= previous.geometryLayout.capacities[p * 4 + k]) {
      const start = previous.geometryLayout.offsets[p * 4 + k], capacity = previous.geometryLayout.capacities[p * 4 + k];
      offsets[i * 4 + k] = start;
      capacities[i * 4 + k] = capacity;
      if (capacity) reserved.push({ start, end: start + capacity });
    } else pending.push(i);
  }
  reserved.sort((a, b) => a.start - b.start);
  const gaps = [];
  let cursor = 0;
  for (const range of reserved) {
    if (cursor < range.start) gaps.push({ start: cursor, end: range.start });
    cursor = range.end;
  }
  if (cursor < end) gaps.push({ start: cursor, end });
  for (const i of pending) {
    const size = entries[i][key].length;
    let best = -1;
    for (let j = 0; j < gaps.length; j++) if (gaps[j].end - gaps[j].start >= size && (best < 0 || gaps[j].end - gaps[j].start < gaps[best].end - gaps[best].start)) best = j;
    const start = best < 0 ? end : gaps[best].start;
    if (best < 0) end += size;
    else gaps[best].start += size;
    offsets[i * 4 + k] = start;
    capacities[i * 4 + k] = size;
  }
  end = 0;
  for (let i = 0; i < entries.length; i++) end = Math.max(end, offsets[i * 4 + k] + capacities[i * 4 + k]);
  if (end > live * 1.5 || end > 16777215 * 4) {
    end = 0;
    for (let i = 0; i < entries.length; i++) {
      offsets[i * 4 + k] = end;
      capacities[i * 4 + k] = entries[i][key].length;
      end += capacities[i * 4 + k];
    }
  }
  if (end > 16777215 * 4) throw new Error("Ray geometry exceeds exact floating-point address limits.");
  offsets[entries.length * 4 + k] = end;
}
function combineGeometry(entries, previous) {
  if (new Set(entries.map(identity)).size !== entries.length) throw new Error("Geometry changed during BLAS preparation.");
  const old = /* @__PURE__ */ new Map();
  previous?.entries.forEach((entry, i) => old.set(identity(entry), i));
  let offsets = new Uint32Array((entries.length + 1) * 4), capacities = new Uint32Array(entries.length * 4);
  for (let k = 0; k < 4; k++) allocate(entries, previous, old, k, offsets, capacities);
  if (previous && offsets.length === previous.geometryLayout.offsets.length && offsets.every((v, i) => v === previous.geometryLayout.offsets[i])) offsets = previous.geometryLayout.offsets;
  const streams = geometryKeys.map((key, k) => {
    const chunks = [];
    const previousChunks = new Map(previous?.geometryLayout.streams[k].chunks.map((chunk) => [chunk.offset, chunk.values]));
    for (let e = 0; e < entries.length; e++) {
      const entry = entries[e], local = entry[key];
      if (!local.length) continue;
      const p = old.get(identity(entry)), prior = p === void 0 ? void 0 : previous.entries[p];
      const t = offsets[e * 4], b = offsets[e * 4 + 1], n = offsets[e * 4 + 2], u = offsets[e * 4 + 3];
      const dependencies = key === "triangles" ? [2, 3] : key === "nodes" ? [0, 1] : key === "uvs" ? [3] : [];
      let values;
      if (prior && dependencies.every((d) => offsets[e * 4 + d] === previous.geometryLayout.offsets[p * 4 + d]) && equal(local, prior[key])) values = previousChunks.get(previous.geometryLayout.offsets[p * 4 + k]);
      if (!values) {
        const relocate = key === "triangles" ? n !== 0 || u !== 0 : key === "nodes" ? t !== 0 || b !== 0 : key === "uvs" ? u !== 0 : false;
        values = relocate ? local.slice() : local;
        if (key === "triangles" && relocate) for (let i = 0; i < values.length; i += 12) {
          if (values[i + 7] > 0) values[i + 7] += n / 4;
          if (values[i + 11] > 0) values[i + 11] += u / 8;
        }
        if (key === "uvs" && relocate) for (let i = 0; i < entry.triangles.length; i += 12) {
          const address = (entry.triangles[i + 11] - 1) * 8;
          if (address < 0) continue;
          for (let slot = 0; slot < 5; slot++) if (values[address + slot] >= 0) values[address + slot] += u / 4;
        }
        if (key === "nodes" && relocate) for (let i = 0; i < values.length; i += 12) {
          values[i + 3] += b / 12;
          if (values[i + 7] >= 0) values[i + 7] += t / 12;
          else values[i + 9] += b / 12;
        }
      }
      chunks.push({ offset: offsets[e * 4 + k], values });
    }
    chunks.sort((a, b) => a.offset - b.offset);
    const before = previous?.geometryLayout.streams[k], length = offsets[entries.length * 4 + k];
    return before && before.length === length && before.chunks.length === chunks.length && chunks.every((chunk, i) => chunk.offset === before.chunks[i].offset && chunk.values === before.chunks[i].values) ? before : new GeometryStream(length, chunks);
  });
  return withGeometry(
    {
      entries: entries.slice(),
      roots: entries.map((_, i) => offsets[i * 4 + 1] / 12),
      ends: entries.map((entry, i) => (offsets[i * 4 + 1] + entry.nodes.length) / 12),
      nodeCount: streams[1].length / 12,
      triangleCount: entries.reduce((n, entry) => n + entry.triangleCount, 0),
      origin: entries.length === 1 ? entries[0].origin : void 0
    },
    { allocation: previous?.geometryLayout.allocation ?? {}, offsets, capacities, revisions: entries.map((entry) => entry.revision), streams }
  );
}
function withGeometry(target, layout) {
  const result = Object.assign(target, { geometryLayout: layout });
  geometryKeys.forEach((key, k) => Object.defineProperty(result, key, { enumerable: true, get: layout.streams[k].read }));
  return result;
}
function geometryLayout(data) {
  const layout = data.geometryLayout;
  return layout && geometryKeys.every((key, k) => {
    const descriptor = Object.getOwnPropertyDescriptor(data, key);
    return descriptor?.get === layout.streams[k].read || !descriptor?.get && descriptor?.value !== void 0 && descriptor.value === layout.streams[k].materialized;
  }) ? layout : void 0;
}
function geometryStreams(data) {
  return geometryLayout(data)?.streams ?? geometryKeys.map((key) => data[key]);
}
function compatibleLayout(a, b) {
  const x = geometryLayout(a), y = geometryLayout(b);
  return !!a.instances && !!b.instances && !!x && !!y && x.allocation === y.allocation;
}

// ../sdk-oct2/src/viewing/techniques/rayTracing/shared/materialRecords.ts
function deduplicateMaterialRecords(classic, pbr, count) {
  const buckets = /* @__PURE__ */ new Map(), map = new Float32Array(Math.ceil(count / 4) * 4);
  const representatives = new Uint32Array(count), next = new Int32Array(count);
  const colors = new Uint32Array(classic.buffer, classic.byteOffset, classic.length), factors = new Uint32Array(pbr.buffer, pbr.byteOffset, pbr.length);
  let unique = 0;
  for (let i = 0; i < count; i++) {
    let hash = 2166136261;
    for (let k = 0; k < 8; k++) hash = Math.imul(hash ^ canonicalBits(colors[i * 8 + k]), 16777619);
    for (let k = 0; k < 24; k++) hash = Math.imul(hash ^ canonicalBits(factors[i * 24 + k]), 16777619);
    const first = buckets.get(hash) ?? -1;
    let id = first;
    while (id >= 0) {
      const source = representatives[id];
      let equal3 = true;
      for (let k = 0; k < 8; k++) if (canonicalBits(colors[i * 8 + k]) !== canonicalBits(colors[source * 8 + k])) {
        equal3 = false;
        break;
      }
      if (equal3) {
        for (let k = 0; k < 24; k++) if (canonicalBits(factors[i * 24 + k]) !== canonicalBits(factors[source * 24 + k])) {
          equal3 = false;
          break;
        }
      }
      if (equal3) break;
      id = next[id];
    }
    if (id < 0) {
      id = unique++;
      representatives[id] = i;
      next[id] = first;
      buckets.set(hash, id);
    }
    map[i] = id;
  }
  const materials = new Float32Array(unique * 8), packedPBR = new Float32Array(unique * 24);
  for (let i = 0; i < unique; i++) {
    const source = representatives[i];
    for (let k = 0; k < 8; k++) materials[i * 8 + k] = classic[source * 8 + k];
    for (let k = 0; k < 24; k++) packedPBR[i * 24 + k] = pbr[source * 24 + k];
  }
  return { materials, pbr: packedPBR, map, count: unique };
}
function canonicalBits(bits) {
  const magnitude = bits & 2147483647;
  return magnitude === 0 ? 0 : magnitude > 2139095040 ? 2143289344 : bits;
}

// ../sdk-oct2/src/viewing/techniques/rayTracing/shared/updates.ts
function geometrySignature(scene, view) {
  const values = [];
  for (const mesh of Object.values(scene.meshes)) {
    const g = mesh.geometry, object = mesh.object && view.objects[mesh.object.id];
    values.push(mesh, g, g.version, object?.visible, object?.culled, object?.viewTransform, mesh.representationId);
    for (let i = 0; i < 16; i++) values.push(mesh.worldMatrix[i]);
    for (const slot of mapSlots) {
      const texture = mesh.material?.[`${slot}Texture`];
      values.push(!!texture, !!texture?.flipY, mesh.material?.[`${slot}TextureTexCoord`] ?? 0);
      const transform = mesh.material?.[`${slot}TextureUVTransform`] ?? [1, 0, 0, 1, 0, 0];
      for (let i = 0; i < 6; i++) values.push(transform[i]);
    }
  }
  return values;
}
function sameSignature(a, b) {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}
async function refreshMaterials(previous, meshes, surfaces = {}, signal, view, requested) {
  const textures = /* @__PURE__ */ new Set();
  for (const mesh of meshes)
    for (const slot of mapSlots) {
      const t = mesh.material?.[`${slot}Texture`];
      if (t) textures.add(textureImageKey(t));
    }
  const textureSize = materialTextureSize(requested, textures.size), packer = createMaterialPacker(signal, textureSize, true), materials = new Float32Array(Math.max(4, meshes.length * 8));
  for (let i = 0; i < meshes.length; i++) {
    signal.throwIfAborted();
    const mesh = meshes[i], object = mesh.object && view.objects[mesh.object.id], surface = surfaces[mesh.id];
    for (let c = 0; c < 3; c++) materials[i * 8 + c] = mesh.effectiveColor[c] * (object?.colorize?.[c] ?? 1);
    materials[i * 8 + 7] = mesh.lightingDomain?._slot ?? 0;
    materials[i * 8 + 3] = Math.max(0, Math.min(1, surface?.reflectivity ?? 0.1));
    materials[i * 8 + 4] = surface?.checker ? 1 : 0;
    materials[i * 8 + 5] = Math.max(0, Math.min(1, mesh.effectiveOpacity * (object?.opacity ?? 1)));
    await packer.mesh(mesh, false);
  }
  signal.throwIfAborted();
  return {
    ...previous,
    materials: appendLightingDomains(
      appendFlatClipBoxes(materials, meshes, previous.origin ?? [0, 0, 0]),
      view.viewer?.scene ?? meshes[0]?.scene,
      previous.origin ?? [0, 0, 0],
      meshes.length
    ),
    pbr: new Float32Array(packer.pbr.length ? packer.pbr : [0, 0, 0, 0]),
    bindings: new Float32Array(packer.bindings.length ? packer.bindings : [0, 0, 0, 0]),
    textureSize,
    textureBindings: packer.textureBindings,
    imageSources: packer.imageSources,
    images: []
  };
}

// ../sdk-oct2/src/viewing/techniques/rayTracing/shared/compact.ts
async function compactAttributes(triangles, normals, uvs, signal) {
  let deadline = performance.now() + 8;
  const pause = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    signal?.throwIfAborted();
    deadline = performance.now() + 8;
  };
  signal?.throwIfAborted();
  const normalCount = normals.length === 4 ? 0 : normals.length / 12;
  const encoded = new Float32Array(normalCount * 8);
  for (let i = 0; i < normalCount; i++) for (let corner = 0; corner < 3; corner++) {
    if (corner === 0 && (i & 16383) === 0 && performance.now() >= deadline) await pause();
    const source = i * 12 + corner * 4, target = i * 8 + corner * 2;
    let x = normals[source], y = normals[source + 1], z = normals[source + 2];
    const length = Math.abs(x) + Math.abs(y) + Math.abs(z);
    if (length === 0) {
      encoded[target] = 2;
      encoded[target + 1] = 2;
      continue;
    }
    x /= length;
    y /= length;
    z /= length;
    if (z < 0) {
      const previous = x;
      x = (1 - Math.abs(y)) * (previous < 0 ? -1 : 1);
      y = (1 - Math.abs(previous)) * (y < 0 ? -1 : 1);
    }
    encoded[target] = x;
    encoded[target + 1] = y;
  }
  const count = uvs.length === 4 ? 0 : uvs.length / 40;
  const references = new Uint8Array(count * 5);
  references.fill(255);
  const addresses = new Uint32Array(count);
  let size = 0;
  for (let i = 0; i < count; i++) {
    if ((i & 16383) === 0 && performance.now() >= deadline) await pause();
    let unique = 0;
    for (let slot = 0; slot < 5; slot++) {
      const source = i * 40 + slot * 8;
      if (uvs[source + 6] === 0) continue;
      let same2 = -1;
      for (let previous = 0; previous < slot && same2 < 0; previous++) {
        let equal3 = true;
        for (let k = 0; k < 8; k++) if (uvs[source + k] !== uvs[i * 40 + previous * 8 + k]) {
          equal3 = false;
          break;
        }
        if (equal3) same2 = previous;
      }
      references[i * 5 + slot] = same2 >= 0 ? references[i * 5 + same2] : slot;
      if (same2 < 0) unique++;
    }
    if (unique) size += 8 + unique * 8;
  }
  const compact = new Float32Array(size);
  let used = 0;
  for (let i = 0; i < count; i++) {
    if ((i & 16383) === 0 && performance.now() >= deadline) await pause();
    let present = false;
    for (let slot = 0; slot < 5; slot++) if (references[i * 5 + slot] !== 255) present = true;
    if (!present) {
      addresses[i] = 4294967295;
      continue;
    }
    const header = used;
    addresses[i] = header / 4;
    used += 8;
    for (let slot = 0; slot < 5; slot++) {
      const source = references[i * 5 + slot];
      if (source === 255) {
        compact[header + slot] = -1;
        continue;
      }
      if (source < slot) {
        compact[header + slot] = compact[header + source];
        continue;
      }
      compact[header + slot] = used / 4;
      compact.set(uvs.subarray(i * 40 + slot * 8, i * 40 + slot * 8 + 8), used);
      used += 8;
    }
  }
  for (let t = 0; t < triangles.length; t += 12) {
    if (t % (16384 * 12) === 0 && performance.now() >= deadline) await pause();
    if (triangles[t + 7] > 0) triangles[t + 7] = (triangles[t + 7] - 1) / 3 * 2 + 1;
    if (triangles[t + 11] > 0) {
      const address = addresses[triangles[t + 11] - 1];
      triangles[t + 11] = address === 4294967295 ? 0 : address / 2 + 1;
    }
  }
  return { normals: encoded, uvs: compact };
}

// ../sdk-oct2/src/viewing/techniques/rayTracing/shared/tlas.ts
function createTLASUpdater() {
  let previous, generation = 0;
  return async (proxies, ids, signal) => {
    const ticket = ++generation;
    signal?.throwIfAborted();
    if (proxies.length !== ids.length * 12) throw new Error("Invalid TLAS instance stream.");
    const bounds = new Float32Array(ids.length * 6);
    for (let i = 0; i < ids.length; i++) for (let a = 0; a < 3; a++) {
      const start = proxies[i * 12 + a], end = start + proxies[i * 12 + 4 + a];
      const lo = Math.min(start, end), hi = Math.max(start, end);
      if (!Number.isFinite(lo + hi)) throw new Error("Non-finite TLAS coordinates.");
      const padding = Math.max(2e-4, Math.max(Math.abs(lo), Math.abs(hi)) * 12e-8);
      bounds[i * 6 + a] = lo - padding;
      bounds[i * 6 + a + 3] = hi + padding;
    }
    const old = previous;
    if (old && equal2(ids, old.ids)) {
      if (equal2(bounds, old.bounds)) return old;
      const nodes = old.nodes.slice();
      for (let n = old.nodeCount - 1; n >= 0; n--) {
        const o = n * 12, instance = nodes[o + 7];
        if (instance >= 0) {
          for (let a = 0; a < 3; a++) {
            nodes[o + a] = bounds[instance * 6 + a];
            nodes[o + 4 + a] = bounds[instance * 6 + 3 + a];
          }
        } else {
          const left = o + 12, right = nodes[o + 9] * 12;
          for (let a = 0; a < 3; a++) {
            nodes[o + a] = Math.min(nodes[left + a], nodes[right + a]);
            nodes[o + 4 + a] = Math.max(nodes[left + 4 + a], nodes[right + 4 + a]);
          }
        }
      }
      if (treeCost(nodes) <= old.quality * 1.5) {
        signal?.throwIfAborted();
        const result2 = { nodes, nodeCount: old.nodeCount, ids: old.ids, bounds, quality: old.quality };
        if (ticket === generation) previous = result2;
        return result2;
      }
    }
    const built = await buildBVH(proxies, signal, { leafSize: 1, maxLeafSize: 1, worker: false });
    for (let n = 0; n < built.nodeCount; n++) {
      const o = n * 12;
      if (built.nodes[o + 7] >= 0) built.nodes[o + 7] = built.triangles[built.nodes[o + 7] * 12 + 3];
    }
    signal?.throwIfAborted();
    const result = { nodes: built.nodes, nodeCount: built.nodeCount, ids: ids.slice(), bounds, quality: treeCost(built.nodes) };
    if (ticket === generation) previous = result;
    return result;
  };
}
function equal2(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function treeCost(nodes) {
  if (!nodes.length) return 0;
  const area = (o) => {
    const x = nodes[o + 4] - nodes[o], y = nodes[o + 5] - nodes[o + 1], z = nodes[o + 6] - nodes[o + 2];
    return x * y + y * z + z * x;
  };
  let sum = 0;
  for (let o = 0; o < nodes.length; o += 12) if (nodes[o + 7] < 0) sum += area(o);
  return sum / (area(0) || 1);
}

// ../sdk-oct2/src/viewing/techniques/rayTracing/shared/instances.ts
function createInstancePacker(bvh) {
  const cache = /* @__PURE__ */ new WeakMap();
  const meshIds = /* @__PURE__ */ new WeakMap();
  let nextMeshId = 0, updateTLAS = createTLASUpdater();
  let aggregate, prepared, generation = 0;
  return async function packInstances(scene, surfaces = {}, signal, view, requestedTextureSize = 512) {
    const ticket = ++generation;
    signal?.throwIfAborted();
    const meshes = [];
    const bounds = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
    for (const mesh of Object.values(scene.meshes)) {
      const g = mesh.geometry, m = mesh.worldMatrix, b = g.aabb, object = mesh.object && view?.objects[mesh.object.id];
      for (let c = 0; c < 8; c++)
        for (let a = 0; a < 3; a++) {
          const value = m[a] * b[c & 1 ? 3 : 0] + m[a + 4] * b[c & 2 ? 4 : 1] + m[a + 8] * b[c & 4 ? 5 : 2] + m[a + 12];
          bounds[a] = Math.min(bounds[a], value);
          bounds[a + 3] = Math.max(bounds[a + 3], value);
        }
      if (object && (!object.visible || object.culled)) continue;
      if (object?.viewTransform || mesh.representationId || g.framesCompressed?.length || g.morphTargets?.length || g.vertexStatesCompressed?.length) {
        throw new Error(
          "Ray tracing currently requires static triangle meshes without ViewTransforms or representations."
        );
      }
      meshes.push(mesh);
    }
    if (!meshes.length) {
      aggregate = void 0;
      prepared = void 0;
      updateTLAS = createTLASUpdater();
      return packScene(scene, surfaces, signal, view, requestedTextureSize, { deferTextures: true });
    }
    if (meshes.length > 8192) throw new Error("Ray tracing supports at most 8,192 instances.");
    const origin = bounds.every(Number.isFinite) && bounds.some((v) => Math.abs(v) > 1e4) ? [(bounds[0] + bounds[3]) / 2, (bounds[1] + bounds[4]) / 2, (bounds[2] + bounds[5]) / 2] : [0, 0, 0];
    const textures = /* @__PURE__ */ new Set();
    for (const mesh of meshes)
      for (const slot of mapSlots) {
        const t = mesh.material?.[`${slot}Texture`];
        if (t) textures.add(textureImageKey(t));
      }
    const textureSize = materialTextureSize(requestedTextureSize, textures.size);
    const materials = createMaterialPacker(signal, textureSize, true), instances = [];
    const entries = [], ids = /* @__PURE__ */ new Map();
    let deadline = performance.now() + 8;
    for (const mesh of meshes) {
      if (performance.now() >= deadline) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        deadline = performance.now() + 8;
      }
      signal?.throwIfAborted();
      const geometry = mesh.geometry, version = geometry.version;
      const signature = uvLayoutSignature(mesh);
      let record = cache.get(geometry);
      const previousVariant = record?.variants.get(signature);
      if (!record || record.version !== version) {
        record = { version, variants: /* @__PURE__ */ new Map(), identities: record?.identities ?? /* @__PURE__ */ new Map() };
        cache.set(geometry, record);
      }
      let blas = record.variants.get(signature);
      if (!blas) {
        const local = Object.create(mesh);
        Object.defineProperties(local, {
          clipBox: { value: null },
          worldMatrix: { value: createMat4Float64([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) },
          object: { value: void 0 }
        });
        const packed = await packScene(
          { meshes: { local } },
          {},
          signal,
          { objects: {} },
          textureSize,
          { deferTextures: true, preserveSmallTriangles: true, bvh }
        );
        const compact = await compactAttributes(packed.triangles, packed.normals, packed.uvs, signal);
        let identity2 = record.identities.get(signature);
        if (!identity2) {
          if (record.identities.size >= 4) record.identities.delete(record.identities.keys().next().value);
          identity2 = {};
          record.identities.set(signature, identity2);
        }
        blas = {
          identity: identity2,
          revision: {},
          triangles: packed.triangles,
          ...compact,
          nodes: packed.nodes,
          nodeCount: packed.nodeCount,
          triangleCount: packed.triangleCount,
          origin: packed.origin
        };
        reuseLocalStreams(blas, previousVariant);
        signal?.throwIfAborted();
        if (geometry.version !== version) throw new Error("Geometry changed during BLAS preparation.");
        if (record.variants.size >= 4) record.variants.delete(record.variants.keys().next().value);
        record.variants.set(signature, blas);
      }
      if (!blas.triangleCount) continue;
      let root = ids.get(blas);
      if (root === void 0) {
        root = entries.length;
        ids.set(blas, root);
        entries.push(blas);
      }
      instances.push({ mesh, blas, root });
    }
    if (!entries.length) {
      aggregate = void 0;
      prepared = void 0;
      updateTLAS = createTLASUpdater();
      return packScene(scene, surfaces, signal, view, requestedTextureSize, { deferTextures: true });
    }
    const triangleCount = entries.reduce((n, b) => n + b.triangleCount, 0);
    if (triangleCount > 2e6) throw new Error("Ray tracing supports at most 2,000,000 unique triangles.");
    if (!aggregate || entries.length !== aggregate.entries.length || entries.some((b, i) => b !== aggregate.entries[i]))
      aggregate = combineGeometry(entries, aggregate);
    const shared = aggregate;
    const count = instances.length, records = new Float32Array(count * 8), instanceIds = new Uint32Array(count);
    let expandedTriangleCount = 0;
    for (let i = 0; i < count; i++) {
      if (performance.now() >= deadline) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        deadline = performance.now() + 8;
      }
      signal?.throwIfAborted();
      const { mesh, blas } = instances[i];
      let meshId = meshIds.get(mesh);
      if (meshId === void 0) {
        meshId = nextMeshId++;
        meshIds.set(mesh, meshId);
      }
      instanceIds[i] = meshId;
      const object = mesh.object && view?.objects[mesh.object.id], surface = surfaces[mesh.id];
      const o = i * 8, color = mesh.effectiveColor;
      records[o] = color[0] * (object?.colorize?.[0] ?? 1);
      records[o + 1] = color[1] * (object?.colorize?.[1] ?? 1);
      records[o + 2] = color[2] * (object?.colorize?.[2] ?? 1);
      records[o + 3] = Math.max(0, Math.min(1, surface?.reflectivity ?? 0.1));
      records[o + 4] = surface?.checker ? 1 : 0;
      records[o + 5] = Math.max(0, Math.min(1, mesh.effectiveOpacity * (object?.opacity ?? 1)));
      records[o + 7] = mesh.lightingDomain?._slot ?? 0;
      records[o + 6] = mesh.clipBox?.active ? i + 1 : 0;
      await materials.mesh(mesh, false);
      expandedTriangleCount += blas.triangleCount;
    }
    signal?.throwIfAborted();
    const previous = prepared;
    let reusable = !!previous && previous.shared === shared && previous.ids.length === count && origin.every((v, i) => v === previous.origin[i]);
    if (reusable)
      for (let i = 0; i < count; i++) {
        if (previous.ids[i] !== instanceIds[i]) {
          reusable = false;
          break;
        }
        const m = instances[i].mesh.worldMatrix;
        for (let a = 0; a < 16; a++)
          if (m[a] !== previous.matrices[i * 16 + a]) {
            reusable = false;
            break;
          }
        if (!reusable) break;
      }
    let transforms, matrices, tlas;
    if (reusable) {
      transforms = previous.transforms;
      matrices = previous.matrices;
      tlas = previous.tlas;
    } else {
      transforms = new Float32Array(count * 28);
      matrices = new Float64Array(count * 16);
      const proxies = new Float32Array(count * 12), inverse = createMat4Float64(), relative = new Float64Array(16);
      const lo = new Float64Array(3), hi = new Float64Array(3);
      for (let i = 0; i < count; i++) {
        if (performance.now() >= deadline) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          deadline = performance.now() + 8;
        }
        signal?.throwIfAborted();
        const { mesh, blas, root } = instances[i], m = mesh.worldMatrix, localOrigin = blas.origin;
        matrices.set(m, i * 16);
        relative.set(m);
        for (let a = 0; a < 3; a++)
          relative[12 + a] = m[a] * (localOrigin?.[0] ?? 0) + m[a + 4] * (localOrigin?.[1] ?? 0) + m[a + 8] * (localOrigin?.[2] ?? 0) + m[12 + a] - origin[a];
        const determinant = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
        if (!Number.isFinite(determinant) || determinant === 0)
          throw new Error(`Singular ray-tracing instance transform: ${mesh.id}`);
        inverseMat4(relative, inverse);
        const offset = i * 28;
        for (let row = 0; row < 3; row++)
          for (let col = 0; col < 4; col++) {
            transforms[offset + row * 4 + col] = inverse[col * 4 + row];
            transforms[offset + 12 + row * 4 + col] = relative[col * 4 + row];
          }
        transforms[offset + 24] = shared.roots[root];
        transforms[offset + 25] = shared.ends[root];
        lo.fill(Infinity);
        hi.fill(-Infinity);
        const b = blas.nodes;
        for (let corner = 0; corner < 8; corner++)
          for (let axis = 0; axis < 3; axis++) {
            const v = relative[axis] * b[corner & 1 ? 4 : 0] + relative[axis + 4] * b[corner & 2 ? 5 : 1] + relative[axis + 8] * b[corner & 4 ? 6 : 2] + relative[axis + 12];
            lo[axis] = Math.min(lo[axis], v);
            hi[axis] = Math.max(hi[axis], v);
          }
        for (let a = 0; a < 3; a++) {
          proxies[i * 12 + a] = lo[a];
          proxies[i * 12 + 4 + a] = hi[a] - lo[a];
        }
        proxies[i * 12 + 3] = i;
      }
      tlas = await updateTLAS(proxies, instanceIds, signal);
    }
    signal?.throwIfAborted();
    const unique = deduplicateMaterialRecords(records, new Float32Array(materials.pbr), count);
    const transformOffset = unique.materials.length / 4, tlasOffset = transformOffset + count * 7, materialMapOffset = tlasOffset + tlas.nodes.length / 4;
    const clipOffset = materialMapOffset * 4 + unique.map.length;
    const clipCount = instances.filter(({ mesh }) => mesh.clipBox?.active).length;
    const materialStream = new Float32Array(clipOffset + clipCount * 12);
    materialStream.set(unique.materials);
    materialStream.set(transforms, transformOffset * 4);
    materialStream.set(tlas.nodes, tlasOffset * 4);
    materialStream.set(unique.map, materialMapOffset * 4);
    let clipCursor = clipOffset;
    for (let i = 0; i < unique.count; i++) {
      const source = materialStream[i * 8 + 6] - 1;
      if (source < 0) continue;
      const { mesh, blas } = instances[source];
      materialStream[i * 8 + 6] = clipCursor / 4;
      materialStream.set(localClipBoxRows(mesh, blas.origin), clipCursor);
      clipCursor += 12;
    }
    if (ticket === generation)
      prepared = {
        shared,
        origin,
        ids: instanceIds,
        matrices,
        transforms: materialStream.subarray(transformOffset * 4, tlasOffset * 4),
        tlas: { nodes: materialStream.subarray(tlasOffset * 4, materialMapOffset * 4), nodeCount: tlas.nodeCount }
      };
    return withGeometry(
      {
        nodeCount: shared.nodeCount,
        triangleCount: shared.triangleCount,
        materials: appendLightingDomains(materialStream, scene, origin, unique.count),
        pbr: unique.pbr,
        materialCount: unique.count,
        materialMapOffset,
        bindings: new Float32Array(materials.bindings.length ? materials.bindings : [0, 0, 0, 0]),
        imageSources: materials.imageSources,
        images: [],
        textureBindings: materials.textureBindings,
        meshCount: count,
        origin,
        textureSize,
        instances: {
          transformOffset,
          tlasOffset,
          tlasNodeCount: tlas.nodeCount,
          instanceCount: count,
          expandedTriangleCount
        }
      },
      shared.geometryLayout
    );
  };
}
function createScenePacker(instancing, bvh) {
  const views = /* @__PURE__ */ new WeakMap();
  const flat = /* @__PURE__ */ new WeakMap();
  const prepare = async (scene, surfaces, signal, view, size) => {
    let expanded = 0, unique = 0, instanceCount = 0, flatRequired = false;
    const seen = /* @__PURE__ */ new Map();
    for (const mesh of Object.values(scene.meshes)) {
      const object = mesh.object && view.objects[mesh.object.id];
      if (object && (!object.visible || object.culled)) continue;
      instanceCount++;
      const g = mesh.geometry, n = (g.indices?.length ?? g.positionsCompressed.length / 3) / 3;
      expanded += n;
      let layouts = seen.get(g);
      if (!layouts) {
        layouts = /* @__PURE__ */ new Set();
        seen.set(g, layouts);
      }
      const signature = uvLayoutSignature(mesh);
      if (!layouts.has(signature)) {
        layouts.add(signature);
        unique += n;
      }
      const m = mesh.worldMatrix, extent = Math.max(g.aabb[3] - g.aabb[0], g.aabb[4] - g.aabb[1], g.aabb[5] - g.aabb[2]);
      const determinant = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
      flatRequired ||= determinant === 0 || extent < 1e-6 || extent > 1e8;
      for (let axis = 0; axis < 3; axis++) {
        const scale = Math.hypot(m[axis * 4], m[axis * 4 + 1], m[axis * 4 + 2]);
        flatRequired ||= scale < 1e-8 || scale > 1e8;
      }
    }
    const savesStorage = unique <= expanded * 0.5 && (expanded - unique) * 48 > instanceCount * 212;
    if (flatRequired || instancing === false || instancing !== true && !savesStorage) {
      const signature = geometrySignature(scene, view), previous = flat.get(view);
      flat.delete(view);
      const snapshot = previous && sameSignature(previous.signature, signature) && previous.snapshot.sourceMeshes ? await refreshMaterials(previous.snapshot, previous.snapshot.sourceMeshes, surfaces, signal, view, size) : await packScene(scene, surfaces, signal, view, size, { deferTextures: true, trackMaterials: true, bvh });
      signal.throwIfAborted();
      flat.set(view, { signature, snapshot });
      views.delete(view);
      return snapshot;
    }
    flat.delete(view);
    let pack = views.get(view);
    if (!pack) {
      pack = createInstancePacker(bvh);
      views.set(view, pack);
    }
    return pack(scene, surfaces, signal, view, size);
  };
  return Object.assign(prepare, {
    release: (view) => {
      views.delete(view);
      flat.delete(view);
    }
  });
}
function uvLayoutSignature(mesh) {
  if (!mesh.material) return "";
  return JSON.stringify(
    mapSlots.map(
      (slot) => mesh.material?.[`${slot}Texture`] ? [
        mesh.material?.[`${slot}TextureTexCoord`] ?? 0,
        Array.from(mesh.material?.[`${slot}TextureUVTransform`] ?? [1, 0, 0, 1, 0, 0]),
        !!mesh.material?.[`${slot}Texture`]?.flipY
      ] : null
    )
  );
}

// ../sdk-oct2/src/viewing/techniques/rayTracing/shared/features.ts
function opaqueScene(data) {
  for (let i = 0; i < (data.materialCount ?? data.meshCount); i++) {
    if (data.materials[i * 8 + 7] > 0) return false;
    const index = i;
    if (data.materials[i * 8 + 5] < 1 || data.pbr[index * 24 + 3] !== 0 || data.pbr[index * 24 + 16] > 0) return false;
  }
  return true;
}

// ../sdk-oct2/src/viewing/techniques/rayTracing/shared/gpuUpdates.ts
function dataStreams(data, bindings, shared) {
  const g = geometryStreams(data);
  return [g[0], data.materials, g[1], g[2], data.pbr, g[3], bindings, shared];
}
var mutableStreams = [1, 4, 6, 7];
function compatibleGeometry(previous, next) {
  const a = geometryStreams(previous), b = geometryStreams(next);
  return (a.every((stream, k) => stream === b[k]) || compatibleLayout(previous, next)) && !!previous.instances === !!next.instances && opaqueScene(previous) === opaqueScene(next);
}
function* streamUploads(next, previous, alignment = 1) {
  if (next === previous) return;
  const old = new Map(previous ? streamChunks(previous).map((chunk) => [chunk.offset, chunk.values]) : []);
  for (const chunk of streamChunks(next)) {
    const before = old.get(chunk.offset);
    if (before === chunk.values) continue;
    const ranges = before ? changedRanges(before, chunk.values, alignment) : [0, chunk.values.length];
    for (let i = 0; i < ranges.length; i += 2) if (ranges[i + 1] > ranges[i]) yield { offset: chunk.offset + ranges[i], values: chunk.values.subarray(ranges[i], ranges[i + 1]) };
  }
}
function* batchUploads(uploads) {
  const limit = 65536;
  let pending = [];
  let size = 0;
  let scratch;
  function flush() {
    if (!pending.length) return;
    const first = pending[0];
    if (pending.length === 1) {
      pending = [];
      size = 0;
      return first;
    }
    scratch ??= new Float32Array(limit);
    let used = 0;
    for (const part of pending) {
      scratch.set(part.values, used);
      used += part.values.length;
    }
    pending = [];
    size = 0;
    return { offset: first.offset, values: scratch.subarray(0, used) };
  }
  for (const upload of uploads) {
    if (pending.length && (pending[0].offset + size !== upload.offset || size + upload.values.length > limit)) {
      const value2 = flush();
      if (value2) yield value2;
    }
    if (upload.values.length >= limit) {
      yield upload;
      continue;
    }
    pending.push(upload);
    size += upload.values.length;
  }
  const value = flush();
  if (value) yield value;
}
function changedRanges(previous, next, alignment = 1) {
  const a = new Uint32Array(previous.buffer, previous.byteOffset, previous.length);
  const b = new Uint32Array(next.buffer, next.byteOffset, next.length);
  const ranges = [];
  let collapsed = false;
  for (let i = 0; i < b.length; i++) {
    if (i < a.length && a[i] === b[i]) continue;
    const start = Math.floor(i / alignment) * alignment, end = Math.min(b.length, Math.ceil((i + 1) / alignment) * alignment);
    if (collapsed || ranges.length && start - ranges[ranges.length - 1] <= 32) ranges[ranges.length - 1] = end;
    else if (ranges.length === 64) {
      ranges.splice(2);
      ranges[1] = end;
      collapsed = true;
    } else ranges.push(start, end);
    i = end - 1;
  }
  return ranges;
}
function uploadTextureRange(gl, width, values, start, end, sourceStart = start) {
  let calls = 0;
  while (start < end) {
    const texel = start / 4, x = texel % width, y = Math.floor(texel / width), remaining = (end - start) / 4;
    const rows = x === 0 ? Math.floor(remaining / width) : 0;
    const w = rows ? width : Math.min(width - x, remaining), h = rows || 1;
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.FLOAT, values, sourceStart);
    start += w * h * 4;
    sourceStart += w * h * 4;
    calls++;
  }
  return calls;
}

// ../sdk-oct2/src/viewing/techniques/rayTracing/shared/lighting.ts
var unit = (axis) => {
  const length = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  return [axis[0] / length, axis[1] / length, axis[2] / length];
};
function rayLightingFrame(lighting, angle, origin, axes) {
  const right = unit(axes?.worldRight ?? [1, 0, 0]);
  const up = unit(axes?.worldUp ?? [0, 1, 0]);
  const forward = unit(axes?.worldForward ?? [0, 0, 1]);
  return {
    position: [0, 1, 2].map((i) => lighting.center[i] - origin[i] + lighting.scale * (4.5 * Math.cos(angle) * right[i] + 7 * up[i] + 4.5 * Math.sin(angle) * forward[i])),
    up,
    skyLight: unit([0, 1, 2].map((i) => -0.6 * right[i] + up[i] + 0.4 * forward[i]))
  };
}

// ../sdk-oct2/src/viewing/techniques/rayTracing/shared/fallbackImages.ts
var same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
var FallbackImages = class {
  revisions = /* @__PURE__ */ new WeakMap();
  previousKeys = /* @__PURE__ */ new WeakMap();
  unsubscribe = [];
  layers = [];
  pending = /* @__PURE__ */ new WeakMap();
  disposed = false;
  generation = 0;
  width = 0;
  height = 0;
  limit = 0;
  textureSize;
  slots;
  constructor(data, slots) {
    this.slots = slots;
    this.textureSize = data.textureSize;
    if (!slots.some((layer) => layer >= 0)) return;
    const scenes = new Set(data.imageSources?.map((source) => source.scene).filter(Boolean));
    for (const source of data.imageSources ?? []) this.previousKeys.set(source, textureImageKey(source));
    for (const scene of scenes) {
      this.unsubscribe.push(
        scene.events.onSceneTextureImageDataChanged.subscribe((_, texture) => {
          const key = textureImageKey(texture), old = this.previousKeys.get(texture);
          for (const value of /* @__PURE__ */ new Set([key, old]))
            if (value) this.revisions.set(value, (this.revisions.get(value) ?? 0) + 1);
          this.previousKeys.set(texture, key);
        })
      );
    }
    for (let i = 0; i < slots.length; i++)
      if (slots[i] >= 0) {
        const source = data.bindings[i * 12];
        this.layers[slots[i]] = { stamp: this.stamp(data, source), width: 0, height: 0 };
      }
  }
  stamp(data, index) {
    const source = data.imageSources?.[index];
    if (!source) {
      const image = data.images[index];
      return [image, image?.data, image?.width, image?.height];
    }
    const key = textureImageKey(source);
    this.previousKeys.set(source, key);
    return [
      data.images[index],
      key,
      this.revisions.get(key) ?? 0,
      source.compressed,
      source.src,
      source.mediaType,
      source.imageData?.width,
      source.imageData?.height,
      source.image?.width,
      source.image?.height,
      ...source.buffers ?? []
    ];
  }
  initialize(images, width, height, limit) {
    this.width = width;
    this.height = height;
    this.limit = limit;
    for (let i = 0; i < this.layers.length; i++) {
      this.layers[i].width = images[i].width;
      this.layers[i].height = images[i].height;
    }
  }
  async prepare(data, signal) {
    this.pending.delete(data);
    const generation = this.generation;
    if (this.disposed || !this.layers.length || data.textureSize !== this.textureSize || Math.floor(data.bindings.length / 12) !== this.slots.length)
      return;
    const sources = new Int32Array(this.layers.length).fill(-1);
    for (let i = 0; i < this.slots.length; i++) {
      const layer = this.slots[i];
      if (layer < 0) continue;
      const source = data.bindings[i * 12];
      if (sources[layer] >= 0 && sources[layer] !== source) return;
      sources[layer] = source;
    }
    if (new Set(sources).size !== sources.length) return;
    const layers = [], pixels = /* @__PURE__ */ new Map();
    for (let layer = 0; layer < sources.length; layer++) {
      signal?.throwIfAborted();
      if (this.disposed) return;
      const source = sources[layer], stamp = this.stamp(data, source), old = this.layers[layer];
      if (same(old.stamp, stamp)) {
        layers.push(old);
        continue;
      }
      const texture = data.imageSources?.[source];
      const image = data.images[source] ?? (texture ? await decodeTexture(texture, signal, data.textureSize) : void 0);
      signal?.throwIfAborted();
      if (this.disposed) return;
      if (!image) throw new Error("Missing ray-tracing fallback image.");
      if (!same(stamp, this.stamp(data, source)))
        throw new DOMException("Fallback image changed during decoding", "AbortError");
      layers.push({ stamp, width: image.width, height: image.height });
      pixels.set(layer, resizeTexturePixels(image, this.width, this.height));
    }
    let width = Math.max(1, ...layers.map((layer) => Math.min(this.limit, layer.width)));
    let height = Math.max(1, ...layers.map((layer) => Math.min(this.limit, layer.height)));
    while (width * height * layers.length * 32 / 3 > 128 * 1024 * 1024 && (width > 1 || height > 1)) {
      width = Math.max(1, Math.floor(width / 2));
      height = Math.max(1, Math.floor(height / 2));
    }
    if (width !== this.width || height !== this.height) return;
    signal?.throwIfAborted();
    if (!this.disposed) this.pending.set(data, { generation, layers, pixels });
  }
  get(data) {
    const update = this.pending.get(data);
    if (!update || this.disposed || update.generation !== this.generation) return;
    for (let i = 0; i < this.slots.length; i++)
      if (this.slots[i] >= 0 && !same(update.layers[this.slots[i]].stamp, this.stamp(data, data.bindings[i * 12])))
        return;
    return update;
  }
  commit(data) {
    const update = this.get(data);
    if (update) {
      this.layers = update.layers;
      this.generation++;
    }
    this.pending.delete(data);
  }
  dispose() {
    this.disposed = true;
    this.unsubscribe.splice(0).forEach((off) => off());
    this.pending = /* @__PURE__ */ new WeakMap();
    this.layers = [];
  }
};

// ../sdk-oct2/src/viewing/techniques/rayTracing/shared/progressive.ts
var ProgressiveState = class {
  signature = [];
  changedAt = 0;
  previewDrawn = false;
  refining = false;
  samples = 0;
  mode = "interactive";
  reset() {
    this.signature = [];
    this.samples = 0;
    this.previewDrawn = false;
    this.refining = false;
    this.mode = "interactive";
  }
  next(signature, now, antialiasing, bounces, ready = true) {
    const changed = signature.length !== this.signature.length || signature.some((v, i) => !Object.is(v, this.signature[i]));
    if (changed) {
      this.signature = Array.from(signature);
      this.changedAt = now;
      this.samples = 0;
      this.previewDrawn = false;
      this.refining = false;
    }
    if (now - this.changedAt < 150) {
      this.mode = "interactive";
      const trace = ready && !this.previewDrawn;
      if (trace) this.previewDrawn = true;
      return { trace, count: 0, jitter: [0, 0], bounces: Math.min(1, bounces), pending: true };
    }
    if (!this.refining) {
      this.refining = true;
      this.samples = 0;
    }
    const limit = antialiasing ? 64 : 1, count = this.samples;
    this.mode = count >= limit ? "high-quality" : "refinement";
    if (count >= limit) return { trace: false, count, jitter: [0, 0], bounces, pending: false };
    const jitter = !antialiasing ? [0, 0] : count < 4 ? [(count & 1) * 0.5 - 0.25, (count >> 1) * 0.5 - 0.25] : [halton(count + 1, 2) - 0.5, halton(count + 1, 3) - 0.5];
    if (!ready) return { trace: false, count, jitter, bounces, pending: true };
    this.samples++;
    return { trace: true, count, jitter, bounces, pending: this.samples < limit };
  }
};
function halton(index, base) {
  let result = 0, fraction = 1;
  while (index > 0) {
    fraction /= base;
    result += fraction * (index % base);
    index = Math.floor(index / base);
  }
  return result;
}

// ../sdk-oct2/src/viewing/techniques/rayTracing/shared/resources.ts
var ResourceLeases = class {
  constructor(destroy) {
    this.destroy = destroy;
  }
  destroy;
  entries = /* @__PURE__ */ new WeakMap();
  acquire(key, create) {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { resource: create(), references: 0 };
      this.entries.set(key, entry);
    }
    entry.references++;
    let released = false;
    const canRekey = (next) => !released && (next === key || entry.references === 1 && !this.entries.has(next));
    return { resource: entry.resource, canRekey, rekey: (next) => {
      if (!canRekey(next)) throw new Error("Cannot update a shared or conflicting GPU resource lease.");
      if (next !== key) {
        this.entries.delete(key);
        this.entries.set(next, entry);
        key = next;
      }
    }, release: () => {
      if (released) return;
      released = true;
      if (--entry.references === 0) {
        this.entries.delete(key);
        this.destroy(entry.resource);
      }
    } };
  }
};

// ../sdk-oct2/src/viewing/techniques/rayTracing/shared/compilationCache.ts
var CompilationCache = class {
  constructor(destroy, capacity = 4, lifetime) {
    this.destroy = destroy;
    this.capacity = capacity;
    if (lifetime?.aborted) this.disposed = true;
    else lifetime?.addEventListener("abort", () => this.dispose(), { once: true });
  }
  destroy;
  capacity;
  entries = /* @__PURE__ */ new Map();
  idle = /* @__PURE__ */ new Set();
  disposed = false;
  acquire(key, create) {
    if (this.disposed) throw new Error("Compilation cache lifetime has ended.");
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { value: create(), references: 0, ready: false };
      this.entries.set(key, entry);
    }
    const current = entry;
    current.references++;
    this.idle.delete(key);
    let released = false;
    const remove = () => {
      if (this.entries.get(key) === current) {
        this.entries.delete(key);
        this.idle.delete(key);
        this.destroy(current.value);
      }
    };
    return {
      value: current.value,
      ready: () => {
        if (!released && this.entries.get(key) === current) current.ready = true;
      },
      invalidate: remove,
      release: () => {
        if (released) return;
        released = true;
        if (--current.references !== 0 || this.entries.get(key) !== current) return;
        if (!current.ready || this.disposed || !this.capacity) {
          remove();
          return;
        }
        this.idle.add(key);
        while (this.idle.size > this.capacity) {
          const oldest = this.idle.values().next().value;
          const old = this.entries.get(oldest);
          this.idle.delete(oldest);
          this.entries.delete(oldest);
          this.destroy(old.value);
        }
      }
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const values = [...this.entries.values()];
    this.entries.clear();
    this.idle.clear();
    for (const entry of values) this.destroy(entry.value);
  }
};
function awaitCompilation(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    void promise.catch(() => {
    });
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then((value) => {
      signal.removeEventListener("abort", abort);
      resolve(value);
    }, (error) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
  });
}

export {
  TRACING_DOMAINS_GLSL,
  TRACING_DOMAINS_WGSL,
  geometryUnits,
  streamLiveLength,
  MATERIAL_TEXTURE_SIZE,
  materialTextureSize,
  decodeTexture,
  resizeTexturePixels,
  createScenePacker,
  rayLightingFrame,
  FallbackImages,
  opaqueScene,
  dataStreams,
  mutableStreams,
  compatibleGeometry,
  streamUploads,
  batchUploads,
  uploadTextureRange,
  CompilationCache,
  awaitCompilation,
  ProgressiveState,
  ResourceLeases
};
