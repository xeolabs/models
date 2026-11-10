import {
  createSharedRenderer
} from "./chunk-2TLBS7OK.js";
import {
  createScenePacker,
  materialTextureSize
} from "./chunk-3HYABQVT.js";
import {
  PerspectiveProjectionType
} from "./chunk-NFE4WVL6.js";

// ../sdk-oct2/src/viewing/techniques/rayTracing/webGPU/technique.ts
function webgpuRayTracingTechnique(options = {}) {
  const prepareScene = createScenePacker(options.instancing, options.bvh ? { ...options.bvh } : void 0);
  const textureSize = materialTextureSize(options.textureSize);
  const settings = Object.assign({
    pbr: true,
    textures: true,
    shadows: true,
    transparency: true,
    smoothShading: true,
    antialiasing: "4x",
    toneMapping: "aces",
    exposure: 1,
    bounces: 2,
    lightAngle: 135,
    scale: 1
  }, options.settings);
  const snapshots = /* @__PURE__ */ new WeakMap();
  const runtimes = /* @__PURE__ */ new WeakMap();
  const technique = {
    id: "rayTracing",
    retainOnInvalidate: true,
    disposeView(view) {
      prepareScene.release(view);
      snapshots.delete(view);
      runtimes.delete(view);
    },
    async prepare(view, signal) {
      if (view.sectionPlanesList.some((plane) => plane.active)) throw new Error("Ray tracing does not yet support section planes; raster rendering remains active.");
      const snapshot = await prepareScene(view.viewer.scene, options.surfaces, signal, view, textureSize);
      await runtimes.get(view)?.prepareUpdate(snapshot, signal);
      signal.throwIfAborted();
      return snapshot;
    },
    async create(context, snapshot, view, signal) {
      const environment = context.prepareEnvironment?.(view, signal);
      void environment?.catch(() => {
      });
      const renderer = await createSharedRenderer(context, snapshot, options.lighting, signal, options);
      try {
        await environment;
        signal.throwIfAborted();
      } catch (error) {
        renderer.dispose();
        throw error;
      }
      snapshots.set(view, snapshot);
      runtimes.set(view, renderer);
      const rayCamera = () => {
        const camera = view.camera, inverse = camera.inverseViewMatrix;
        return { basis: () => ({
          eye: Array.from(camera.eye),
          right: [inverse[0], inverse[1], inverse[2]],
          up: [inverse[4], inverse[5], inverse[6]],
          forward: [-inverse[8], -inverse[9], -inverse[10]],
          tanHalfFov: 1 / camera.projMatrix[5]
        }) };
      };
      return {
        update(prepared) {
          const next = prepared;
          if (!renderer.update(next)) return false;
          snapshots.set(view, next);
          runtimes.set(view, renderer);
          return true;
        },
        prepareFrame: renderer.progressive ? (frame) => {
          if (view.camera.projectionType !== PerspectiveProjectionType) throw new Error("Ray tracing requires a perspective camera.");
          renderer.prepareFrame(rayCamera(), settings, frame);
        } : void 0,
        render(frame) {
          if (renderer.progressive) {
            renderer.present(frame);
            return;
          }
          const camera = frame.view.camera, inverse = camera.inverseViewMatrix;
          if (camera.projectionType !== PerspectiveProjectionType) throw new Error("Ray tracing currently supports perspective cameras; raster rendering remains active.");
          renderer.draw({ basis: () => ({
            eye: Array.from(camera.eye),
            right: [inverse[0], inverse[1], inverse[2]],
            up: [inverse[4], inverse[5], inverse[6]],
            forward: [-inverse[8], -inverse[9], -inverse[10]],
            tanHalfFov: 1 / camera.projMatrix[5]
          }) }, settings, frame);
        },
        dispose() {
          renderer.dispose();
          if (runtimes.get(view) === renderer) {
            runtimes.delete(view);
            snapshots.delete(view);
          }
        }
      };
    }
  };
  return Object.assign(technique, { settings, getSnapshot: (view) => snapshots.get(view), getRuntime: (view) => runtimes.get(view) });
}
export {
  webgpuRayTracingTechnique
};
