import type { SceneModel } from '@xeokit/sdk/model/scene/SceneModel';
import { TrianglesPrimitive, SolidPrimitive, SurfacePrimitive } from '@xeokit/sdk/base/constants';
import { encodePNG } from './PNG';

type Point = [number, number, number];
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Point, b: Point): Point => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (v: Point): Point => {
  const n = Math.hypot(...v) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};
const transform = (m: ArrayLike<number>, x: number, y: number, z: number): Point => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

/**
 * A small, opaque engineering preview from geometry already in memory.
 * It uses a depth buffer and flat lighting, with a fixed image size and time budget.
 * Texture decoding, GPU startup and a second IFC parse are deliberately unnecessary.
 */
export class ModelThumbnail {
  readonly width = 384;
  readonly height = 288;
  render(model: SceneModel): { png: Buffer; simplified: boolean } {
    const meshes = Object.values(model.meshes).filter(
      (mesh) =>
        [TrianglesPrimitive, SolidPrimitive, SurfacePrimitive].includes(mesh.geometry.primitive) &&
        mesh.geometry.aabb &&
        mesh.geometry.positionsCompressed.length &&
        mesh.effectiveOpacity > 0,
    );
    if (!meshes.length) throw Error('No triangle geometry for thumbnail');
    const up = model.scene.coordinateSystem.worldUp,
      right = model.scene.coordinateSystem.worldRight,
      forward = model.scene.coordinateSystem.worldForward;
    const eye = unit([
      right[0] - forward[0] + up[0] * 0.8,
      right[1] - forward[1] + up[1] * 0.8,
      right[2] - forward[2] + up[2] * 0.8,
    ]);
    const horizontal = unit(cross(eye, [up[0], up[1], up[2]])),
      vertical = unit(cross(horizontal, eye));
    const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const entries = meshes
      .map((mesh) => {
        const a = mesh.geometry.aabb!,
          m = mesh.worldMatrix;
        let near = -Infinity;
        for (let bits = 0; bits < 8; bits++) {
          const p = transform(m, a[bits & 1 ? 3 : 0], a[bits & 2 ? 4 : 1], a[bits & 4 ? 5 : 2]);
          const q = [dot(p, horizontal), dot(p, vertical), dot(p, eye)];
          near = Math.max(near, q[2]);
          for (let axis = 0; axis < 3; axis++) {
            bounds[axis] = Math.min(bounds[axis], q[axis]);
            bounds[axis + 3] = Math.max(bounds[axis + 3], q[axis]);
          }
        }
        return { mesh, near };
      })
      .sort((a, b) => b.near - a.near);
    if (!bounds.every(Number.isFinite)) throw Error('Invalid thumbnail bounds');
    const scale = Math.min(
      (this.width - 36) / Math.max(bounds[3] - bounds[0], 0.001),
      (this.height - 36) / Math.max(bounds[4] - bounds[1], 0.001),
    );
    const center = [
      (bounds[0] + bounds[3]) / 2,
      (bounds[1] + bounds[4]) / 2,
      (bounds[2] + bounds[5]) / 2,
    ];
    const pixels = new Uint8Array(this.width * this.height * 3),
      depth = new Float32Array(this.width * this.height);
    depth.fill(-Infinity);
    for (let i = 0; i < pixels.length; i += 3) {
      pixels[i] = 31;
      pixels[i + 1] = 36;
      pixels[i + 2] = 44;
    }
    const light = unit([-0.4, 0.65, 1]);
    const deadline = Date.now() + 10000;
    let triangles = 0,
      simplified = false;
    render: for (const { mesh } of entries) {
      const geometry = mesh.geometry,
        a = geometry.aabb!,
        positions = geometry.positionsCompressed,
        indices = geometry.indices,
        m = mesh.worldMatrix;
      const points = new Float32Array(positions.length);
      for (let i = 0; i < positions.length; i += 3) {
        const p = transform(
          m,
          a[0] + (positions[i] * (a[3] - a[0])) / 65535,
          a[1] + (positions[i + 1] * (a[4] - a[1])) / 65535,
          a[2] + (positions[i + 2] * (a[5] - a[2])) / 65535,
        );
        points[i] = this.width / 2 + (dot(p, horizontal) - center[0]) * scale;
        points[i + 1] = this.height / 2 - (dot(p, vertical) - center[1]) * scale;
        points[i + 2] = dot(p, eye) - center[2];
      }
      const color = mesh.effectiveColor;
      const count = indices?.length ?? positions.length / 3;
      for (let i = 0; i + 2 < count; i += 3) {
        if ((++triangles & 255) === 0 && (triangles > 1500000 || Date.now() > deadline)) {
          simplified = true;
          break render;
        }
        const ia = (indices ? indices[i] : i) * 3,
          ib = (indices ? indices[i + 1] : i + 1) * 3,
          ic = (indices ? indices[i + 2] : i + 2) * 3;
        const ax = points[ia],
          ay = points[ia + 1],
          az = points[ia + 2],
          bx = points[ib],
          by = points[ib + 1],
          bz = points[ib + 2],
          cx = points[ic],
          cy = points[ic + 1],
          cz = points[ic + 2];
        const area = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (!Number.isFinite(area) || Math.abs(area) < 0.05) continue;
        const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))),
          maxX = Math.min(this.width - 1, Math.ceil(Math.max(ax, bx, cx)));
        const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))),
          maxY = Math.min(this.height - 1, Math.ceil(Math.max(ay, by, cy)));
        const normal = unit(
          cross(
            [(bx - ax) / scale, -(by - ay) / scale, bz - az],
            [(cx - ax) / scale, -(cy - ay) / scale, cz - az],
          ),
        );
        const shade = 0.4 + 0.6 * Math.abs(dot(normal, light));
        const rgb = [0, 1, 2].map((channel) =>
          Math.round(
            255 * Math.min(1, Math.max(0.12, Math.sqrt(Math.max(0, color[channel])) * shade)),
          ),
        );
        for (let y = minY; y <= maxY; y++)
          for (let x = minX; x <= maxX; x++) {
            const u = ((by - cy) * (x + 0.5 - cx) + (cx - bx) * (y + 0.5 - cy)) / area;
            const v = ((cy - ay) * (x + 0.5 - cx) + (ax - cx) * (y + 0.5 - cy)) / area;
            if (u < 0 || v < 0 || u + v > 1) continue;
            const z = u * az + v * bz + (1 - u - v) * cz,
              index = y * this.width + x;
            if (z <= depth[index]) continue;
            depth[index] = z;
            pixels.set(rgb, index * 3);
          }
      }
    }
    // A subtle depth outline keeps small architectural shapes readable on cards.
    const threshold = Math.max(0.0001, (bounds[5] - bounds[2]) * 0.015);
    for (let y = 1; y < this.height - 1; y++)
      for (let x = 1; x < this.width - 1; x++) {
        const i = y * this.width + x;
        if (!Number.isFinite(depth[i])) continue;
        if (
          [i - 1, i + 1, i - this.width, i + this.width].some(
            (neighbor) => Math.abs(depth[i] - depth[neighbor]) > threshold,
          )
        )
          for (let c = 0; c < 3; c++) pixels[i * 3 + c] *= 0.7;
      }
    return { png: encodePNG(this.width, this.height, pixels), simplified };
  }
}
