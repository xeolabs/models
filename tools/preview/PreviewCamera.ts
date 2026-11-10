import { createMat4Float64 } from '@xeokit/sdk/base/math/matrix';
import { CameraFlightAnimation } from '@xeokit/sdk/viewing/cameraFlight';
import { getSceneCollisionIndex } from '@xeokit/sdk/spatial/collision';
import { createCoordinateSystemTransform, type SceneModel } from '@xeokit/sdk/model/scene';
import type { View } from '@xeokit/sdk/viewing/viewer';
import type { XGFStreamingIndex } from '@xeokit/sdk/formats/xgfstream/index/XGFStreamingIndex';

/**
 * A stream's index supplies its full extent before any geometry arrives.
 */
export class PreviewCamera {
  private readonly flight: CameraFlightAnimation;
  private bounds?: number[];
  constructor(private readonly view: View) {
    this.flight = new CameraFlightAnimation(view);
  }
  setModel(model: SceneModel, index?: XGFStreamingIndex) {
    if (index?.aabb && index.coordinateSystem) {
      const matrix = createCoordinateSystemTransform(
        index.coordinateSystem as Parameters<typeof createCoordinateSystemTransform>[0],
        model.coordinateSystem,
        createMat4Float64(),
      );
      const b = index.aabb,
        box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let corner = 0; corner < 8; corner++)
        for (let axis = 0; axis < 3; axis++) {
          const value =
            matrix[axis] * b[corner & 1 ? 3 : 0] +
            matrix[axis + 4] * b[corner & 2 ? 4 : 1] +
            matrix[axis + 8] * b[corner & 4 ? 5 : 2] +
            matrix[axis + 12];
          box[axis] = Math.min(box[axis], value);
          box[axis + 3] = Math.max(box[axis + 3], value);
        }
      this.bounds = box;
    } else
      this.bounds =
        index?.aabb ?? Array.from(getSceneCollisionIndex(model.scene).getSceneAABB() ?? []);
    this.fit();
  }
  fit() {
    const b = this.bounds;
    if (!b || b.length !== 6 || !b.every(Number.isFinite)) return;
    const size = Math.max(0.01, Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]));
    this.view.camera.perspectiveProjection.near = Math.max(0.001, size / 10000);
    this.view.camera.perspectiveProjection.far = Math.max(1000, size * 20);
    this.view.camera.eye = [b[0] + size, b[1] - size, b[2] + size * 0.7];
    this.view.camera.look = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
    this.view.camera.up = [0, 0, 1];
    this.flight.jumpTo({ aabb: new Float64Array(b), fitFOV: 45 });
    this.view.needsRender();
  }
  clear() {
    this.bounds = undefined;
    this.flight.stop();
  }
  destroy() {
    this.flight.destroy();
  }
}
