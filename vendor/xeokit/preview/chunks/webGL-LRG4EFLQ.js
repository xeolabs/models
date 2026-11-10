import {
  createSharedRenderer
} from "./chunk-AOCZUIY4.js";
import {
  createScenePacker,
  materialTextureSize
} from "./chunk-3HYABQVT.js";
import {
  PerspectiveProjectionType
} from "./chunk-NFE4WVL6.js";

// ../sdk-oct2/src/viewing/techniques/rayTracing/webGL/technique.ts
function webglRayTracingTechnique(options = {}) {
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
    create(context, snapshot, view) {
      const renderer = createSharedRenderer(context, snapshot, options.lighting, void 0, options.progressive);
      snapshots.set(view, snapshot);
      runtimes.set(view, renderer);
      return {
        update(prepared) {
          const next = prepared;
          if (!renderer.update(next)) return false;
          snapshots.set(view, next);
          runtimes.set(view, renderer);
          return true;
        },
        output: "linear-hdr",
        isReady: renderer.isReady,
        render(frame) {
          const camera = frame.view.camera, inverse = camera.inverseViewMatrix;
          if (camera.projectionType !== PerspectiveProjectionType) throw new Error("Ray tracing currently supports perspective cameras; raster rendering remains active.");
          renderer.draw({ basis: () => ({
            eye: Array.from(camera.eye),
            right: [inverse[0], inverse[1], inverse[2]],
            up: [inverse[4], inverse[5], inverse[6]],
            forward: [-inverse[8], -inverse[9], -inverse[10]],
            tanHalfFov: 1 / camera.projMatrix[5]
          }) }, {
            ...settings,
            toneMapping: frame.view.effects.tonemap.applied ? frame.view.effects.tonemap.mode : "none",
            exposure: frame.view.effects.tonemap.applied ? frame.view.effects.tonemap.exposure : 1
          }, frame, context.getEnvironment?.(frame.view));
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
  return Object.assign(technique, {
    settings,
    getSnapshot: (view) => snapshots.get(view),
    /** Diagnostics; these handles are borrowed and must not be changed or deleted. */
    getRuntime: (view) => runtimes.get(view)
  });
}
export {
  webglRayTracingTechnique
};
