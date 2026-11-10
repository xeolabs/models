var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../sdk-oct2/src/base/constants/index.ts
var RepeatWrapping = 1e3;
var ClampToEdgeWrapping = 1001;
var MirroredRepeatWrapping = 1002;
var NearestFilter = 1003;
var NearestMipMapNearestFilter = 1004;
var NearestMipMapLinearFilter = 1005;
var LinearFilter = 1006;
var LinearMipMapNearestFilter = 1007;
var LinearMipmapLinearFilter = 1008;
var LinearMipMapLinearFilter = 1008;
var LinearEncoding = 3e3;
var sRGBEncoding = 3001;
var GIFMediaType = 1e4;
var JPEGMediaType = 10001;
var PNGMediaType = 10002;
var PointsPrimitive = 2e4;
var LinesPrimitive = 20001;
var TrianglesPrimitive = 20002;
var SolidPrimitive = 20003;
var SurfacePrimitive = 20004;
var GaussianSplatsPrimitive = 20005;
var PerspectiveProjectionType = 5e5;
var OrthoProjectionType = 500001;
var FrustumProjectionType = 500002;
var CustomProjectionType = 500003;
var OrbitNavigationMode = 600001;
var FirstPersonNavigationMode = 600002;
var PlanViewNavigationMode = 600003;
var QWERTYLayout = 800001;
var AZERTYLayout = 800002;

// ../sdk-oct2/src/base/math/vector.ts
function createVec2Float64(values) {
  return values ? new Float64Array(values) : new Float64Array(2);
}
function createVec2Float32(values) {
  return values ? new Float32Array(values) : new Float32Array(2);
}
function createVec2Int32(values) {
  return values ? new Int32Array(values) : new Int32Array(2);
}
function createVec3Float64(values) {
  return values ? new Float64Array(values) : new Float64Array(3);
}
function createVec3Float32(values) {
  return values ? new Float32Array(values) : new Float32Array(3);
}
function createVec4Float64(values) {
  return values ? new Float64Array(values) : new Float64Array(4);
}
function createVec4Float32(values) {
  return values ? new Float32Array(values) : new Float32Array(4);
}
function createVec9Float64(values) {
  return values ? new Float64Array(values) : new Float64Array(9);
}
function dotVec3(u, v) {
  return u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
}
function mulVec4Scalar(v, s, dest) {
  if (!dest) {
    dest = v;
  }
  dest[0] = v[0] * s;
  dest[1] = v[1] * s;
  dest[2] = v[2] * s;
  dest[3] = v[3] * s;
  return dest;
}
function mulVec3Scalar(v, s, dest) {
  if (!dest) {
    dest = v;
  }
  dest[0] = v[0] * s;
  dest[1] = v[1] * s;
  dest[2] = v[2] * s;
  return dest;
}
function addVec3(u, v, dest) {
  if (!dest) {
    dest = u;
  }
  dest[0] = u[0] + v[0];
  dest[1] = u[1] + v[1];
  dest[2] = u[2] + v[2];
  return dest;
}
function compareVec3(v1, v2) {
  return v1[0] === v2[0] && v1[1] === v2[1] && v1[2] === v2[2];
}
function subVec3(u, v, dest) {
  if (!dest) {
    dest = u;
  }
  dest[0] = u[0] - v[0];
  dest[1] = u[1] - v[1];
  dest[2] = u[2] - v[2];
  return dest;
}
function subVec2(u, v, dest) {
  if (!dest) {
    dest = u;
  }
  dest[0] = u[0] - v[0];
  dest[1] = u[1] - v[1];
  return dest;
}
function dotVec4(u, v) {
  return u[0] * v[0] + u[1] * v[1] + u[2] * v[2] + u[3] * v[3];
}
function cross3Vec3(u, v, dest) {
  if (!dest) {
    dest = u;
  }
  const x = u[0];
  const y = u[1];
  const z = u[2];
  const x2 = v[0];
  const y2 = v[1];
  const z2 = v[2];
  dest[0] = y * z2 - z * y2;
  dest[1] = z * x2 - x * z2;
  dest[2] = x * y2 - y * x2;
  return dest;
}
function sqLenVec4(v) {
  return dotVec4(v, v);
}
function lenVec4(v) {
  return Math.sqrt(sqLenVec4(v));
}
function dotVec2(u, v) {
  return u[0] * v[0] + u[1] * v[1];
}
function sqLenVec3(v) {
  return dotVec3(v, v);
}
function sqLenVec2(v) {
  return dotVec2(v, v);
}
function lenVec3(v) {
  return Math.sqrt(sqLenVec3(v));
}
var distVec3 = (() => {
  const vec = createVec3Float64();
  return (v, w) => lenVec3(subVec3(v, w, vec));
})();
function lenVec2(v) {
  return Math.sqrt(sqLenVec2(v));
}
function lerpVec3(t, t1, t2, p1, p2, dest) {
  const result = dest || createVec3Float64();
  const f = (t - t1) / (t2 - t1);
  result[0] = p1[0] + f * (p2[0] - p1[0]);
  result[1] = p1[1] + f * (p2[1] - p1[1]);
  result[2] = p1[2] + f * (p2[2] - p1[2]);
  return result;
}
var distVec2 = (() => {
  const vec = createVec2Float64();
  return (v, w) => lenVec2(subVec2(v, w, vec));
})();
function normalizeVec4(v, dest) {
  const f = 1 / lenVec4(v);
  return mulVec4Scalar(v, f, dest);
}
function normalizeVec3(v, dest) {
  const f = 1 / lenVec3(v);
  return mulVec3Scalar(v, f, dest);
}
function testOrthogonalAxis(axes, epsilon = 1e-6) {
  const x = axes.slice(0, 3);
  const y = axes.slice(3, 6);
  const z = axes.slice(6, 9);
  return Math.abs(dotVec3(x, y)) < epsilon && Math.abs(dotVec3(x, z)) < epsilon && Math.abs(dotVec3(y, z)) < epsilon;
}

// ../sdk-oct2/src/base/math/matrix.ts
function perspectiveMat4(fovyrad, aspectratio, znear, zfar, m) {
  const pmin = createVec3Float64();
  const pmax = createVec3Float64();
  pmin[2] = znear;
  pmax[2] = zfar;
  pmax[1] = pmin[2] * Math.tan(fovyrad / 2);
  pmin[1] = -pmax[1];
  pmax[0] = pmax[1] * aspectratio;
  pmin[0] = -pmax[0];
  return frustumMat4v(pmin, pmax, m);
}
function createMat4Float32(values) {
  return values ? new Float32Array(values) : new Float32Array(16);
}
var tempMat4a = createMat4Float64();
var tempMat4b = createVec3Float64();
var tempVec4a = createVec4Float64();
var tempVec4b = createVec4Float64();
function createMat4Float64(values) {
  return values ? new Float64Array(values) : new Float64Array(16);
}
function frustumMat4v(fmin, fmax, m) {
  if (!m) {
    m = createMat4Float64();
  }
  const left = fmin[0], right = fmax[0];
  const bottom = fmin[1], top = fmax[1];
  const near = fmin[2], far = fmax[2];
  const rl = right - left;
  const tb = top - bottom;
  const fn = far - near;
  m[0] = 2 * near / rl;
  m[1] = 0;
  m[2] = 0;
  m[3] = 0;
  m[4] = 0;
  m[5] = 2 * near / tb;
  m[6] = 0;
  m[7] = 0;
  m[8] = (right + left) / rl;
  m[9] = (top + bottom) / tb;
  m[10] = -(far + near) / fn;
  m[11] = -1;
  m[12] = 0;
  m[13] = 0;
  m[14] = -(2 * near * far) / fn;
  m[15] = 0;
  return m;
}
function orthoMat4c(left, right, bottom, top, near, far, dest) {
  if (!dest) {
    dest = createMat4Float64();
  }
  const rl = right - left;
  const tb = top - bottom;
  const fn = far - near;
  dest[0] = 2 / rl;
  dest[1] = 0;
  dest[2] = 0;
  dest[3] = 0;
  dest[4] = 0;
  dest[5] = 2 / tb;
  dest[6] = 0;
  dest[7] = 0;
  dest[8] = 0;
  dest[9] = 0;
  dest[10] = -2 / fn;
  dest[11] = 0;
  dest[12] = -(left + right) / rl;
  dest[13] = -(top + bottom) / tb;
  dest[14] = -(far + near) / fn;
  dest[15] = 1;
  return dest;
}
function frustumMat4(left, right, bottom, top, near, far, dest) {
  if (!dest) {
    dest = createMat4Float64();
  }
  const rl = right - left;
  const tb = top - bottom;
  const fn = far - near;
  dest[0] = near * 2 / rl;
  dest[1] = 0;
  dest[2] = 0;
  dest[3] = 0;
  dest[4] = 0;
  dest[5] = near * 2 / tb;
  dest[6] = 0;
  dest[7] = 0;
  dest[8] = (right + left) / rl;
  dest[9] = (top + bottom) / tb;
  dest[10] = -(far + near) / fn;
  dest[11] = -1;
  dest[12] = 0;
  dest[13] = 0;
  dest[14] = -(far * near * 2) / fn;
  dest[15] = 0;
  return dest;
}
function identityMat4(dest) {
  if (!dest) {
    dest = createMat4Float64();
  }
  dest[0] = 1;
  dest[1] = 0;
  dest[2] = 0;
  dest[3] = 0;
  dest[4] = 0;
  dest[5] = 1;
  dest[6] = 0;
  dest[7] = 0;
  dest[8] = 0;
  dest[9] = 0;
  dest[10] = 1;
  dest[11] = 0;
  dest[12] = 0;
  dest[13] = 0;
  dest[14] = 0;
  dest[15] = 1;
  return dest;
}
function isIdentityMat4(m) {
  if (m[0] !== 1 || m[1] !== 0 || m[2] !== 0 || m[3] !== 0 || m[4] !== 0 || m[5] !== 1 || m[6] !== 0 || m[7] !== 0 || m[8] !== 0 || m[9] !== 0 || m[10] !== 1 || m[11] !== 0 || m[12] !== 0 || m[13] !== 0 || m[14] !== 0 || m[15] !== 1) {
    return false;
  }
  return true;
}
function rotationMat4v(anglerad, axis, m) {
  if (!m) {
    m = createMat4Float64();
  }
  const ax = normalizeVec4([axis[0], axis[1], axis[2], 0], createVec4Float64());
  const s = Math.sin(anglerad);
  const c = Math.cos(anglerad);
  const q = 1 - c;
  const x = ax[0];
  const y = ax[1];
  const z = ax[2];
  const xy = x * y;
  const yz = y * z;
  const zx = z * x;
  const xs = x * s;
  const ys = y * s;
  const zs = z * s;
  m[0] = q * x * x + c;
  m[1] = q * xy + zs;
  m[2] = q * zx - ys;
  m[3] = 0;
  m[4] = q * xy - zs;
  m[5] = q * y * y + c;
  m[6] = q * yz + xs;
  m[7] = 0;
  m[8] = q * zx + ys;
  m[9] = q * yz - xs;
  m[10] = q * z * z + c;
  m[11] = 0;
  m[12] = 0;
  m[13] = 0;
  m[14] = 0;
  m[15] = 1;
  return m;
}
function lookAtMat4v(pos, target, up, dest) {
  if (!dest) {
    dest = createMat4Float64();
  }
  const [posx, posy, posz] = pos;
  const [upx, upy, upz] = up;
  const [targetx, targety, targetz] = target;
  if (posx === targetx && posy === targety && posz === targetz) {
    return identityMat4();
  }
  let z0 = posx - targetx;
  let z1 = posy - targety;
  let z2 = posz - targetz;
  let len = 1 / Math.sqrt(z0 * z0 + z1 * z1 + z2 * z2);
  z0 *= len;
  z1 *= len;
  z2 *= len;
  let x0 = upy * z2 - upz * z1;
  let x1 = upz * z0 - upx * z2;
  let x2 = upx * z1 - upy * z0;
  len = Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2);
  if (len) {
    len = 1 / len;
    x0 *= len;
    x1 *= len;
    x2 *= len;
  } else {
    x0 = x1 = x2 = 0;
  }
  let y0 = z1 * x2 - z2 * x1;
  let y1 = z2 * x0 - z0 * x2;
  let y2 = z0 * x1 - z1 * x0;
  len = Math.sqrt(y0 * y0 + y1 * y1 + y2 * y2);
  if (len) {
    len = 1 / len;
    y0 *= len;
    y1 *= len;
    y2 *= len;
  } else {
    y0 = y1 = y2 = 0;
  }
  dest[0] = x0;
  dest[1] = y0;
  dest[2] = z0;
  dest[3] = 0;
  dest[4] = x1;
  dest[5] = y1;
  dest[6] = z1;
  dest[7] = 0;
  dest[8] = x2;
  dest[9] = y2;
  dest[10] = z2;
  dest[11] = 0;
  dest[12] = -(x0 * posx + x1 * posy + x2 * posz);
  dest[13] = -(y0 * posx + y1 * posy + y2 * posz);
  dest[14] = -(z0 * posx + z1 * posy + z2 * posz);
  dest[15] = 1;
  return dest;
}
function inverseMat4(mat, dest) {
  if (!dest) {
    dest = mat;
  }
  const [
    a00,
    a01,
    a02,
    a03,
    a10,
    a11,
    a12,
    a13,
    a20,
    a21,
    a22,
    a23,
    a30,
    a31,
    a32,
    a33
  ] = mat;
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const invDet = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  dest[0] = (a11 * b11 - a12 * b10 + a13 * b09) * invDet;
  dest[1] = (-a01 * b11 + a02 * b10 - a03 * b09) * invDet;
  dest[2] = (a31 * b05 - a32 * b04 + a33 * b03) * invDet;
  dest[3] = (-a21 * b05 + a22 * b04 - a23 * b03) * invDet;
  dest[4] = (-a10 * b11 + a12 * b08 - a13 * b07) * invDet;
  dest[5] = (a00 * b11 - a02 * b08 + a03 * b07) * invDet;
  dest[6] = (-a30 * b05 + a32 * b02 - a33 * b01) * invDet;
  dest[7] = (a20 * b05 - a22 * b02 + a23 * b01) * invDet;
  dest[8] = (a10 * b10 - a11 * b08 + a13 * b06) * invDet;
  dest[9] = (-a00 * b10 + a01 * b08 - a03 * b06) * invDet;
  dest[10] = (a30 * b04 - a31 * b02 + a33 * b00) * invDet;
  dest[11] = (-a20 * b04 + a21 * b02 - a23 * b00) * invDet;
  dest[12] = (-a10 * b09 + a11 * b07 - a12 * b06) * invDet;
  dest[13] = (a00 * b09 - a01 * b07 + a02 * b06) * invDet;
  dest[14] = (-a30 * b03 + a31 * b01 - a32 * b00) * invDet;
  dest[15] = (a20 * b03 - a21 * b01 + a22 * b00) * invDet;
  return dest;
}
function transposeMat4(mat, dest) {
  const [
    m00,
    m01,
    m02,
    m03,
    m10,
    m11,
    m12,
    m13,
    m20,
    m21,
    m22,
    m23,
    m30,
    m31,
    m32,
    m33
  ] = mat;
  if (!dest || mat === dest) {
    mat[1] = m10;
    mat[2] = m20;
    mat[3] = m30;
    mat[4] = m01;
    mat[6] = m21;
    mat[7] = m31;
    mat[8] = m02;
    mat[9] = m12;
    mat[11] = m32;
    mat[12] = m03;
    mat[13] = m13;
    mat[14] = m23;
    return mat;
  }
  dest[0] = m00;
  dest[1] = m10;
  dest[2] = m20;
  dest[3] = m30;
  dest[4] = m01;
  dest[5] = m11;
  dest[6] = m21;
  dest[7] = m31;
  dest[8] = m02;
  dest[9] = m12;
  dest[10] = m22;
  dest[11] = m32;
  dest[12] = m03;
  dest[13] = m13;
  dest[14] = m23;
  dest[15] = m33;
  return dest;
}
function mulMat4(a, b, dest) {
  dest = dest || a;
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a;
  const [b00, b01, b02, b03, b10, b11, b12, b13, b20, b21, b22, b23, b30, b31, b32, b33] = b;
  dest[0] = b00 * a00 + b01 * a10 + b02 * a20 + b03 * a30;
  dest[1] = b00 * a01 + b01 * a11 + b02 * a21 + b03 * a31;
  dest[2] = b00 * a02 + b01 * a12 + b02 * a22 + b03 * a32;
  dest[3] = b00 * a03 + b01 * a13 + b02 * a23 + b03 * a33;
  dest[4] = b10 * a00 + b11 * a10 + b12 * a20 + b13 * a30;
  dest[5] = b10 * a01 + b11 * a11 + b12 * a21 + b13 * a31;
  dest[6] = b10 * a02 + b11 * a12 + b12 * a22 + b13 * a32;
  dest[7] = b10 * a03 + b11 * a13 + b12 * a23 + b13 * a33;
  dest[8] = b20 * a00 + b21 * a10 + b22 * a20 + b23 * a30;
  dest[9] = b20 * a01 + b21 * a11 + b22 * a21 + b23 * a31;
  dest[10] = b20 * a02 + b21 * a12 + b22 * a22 + b23 * a32;
  dest[11] = b20 * a03 + b21 * a13 + b22 * a23 + b23 * a33;
  dest[12] = b30 * a00 + b31 * a10 + b32 * a20 + b33 * a30;
  dest[13] = b30 * a01 + b31 * a11 + b32 * a21 + b33 * a31;
  dest[14] = b30 * a02 + b31 * a12 + b32 * a22 + b33 * a32;
  dest[15] = b30 * a03 + b31 * a13 + b32 * a23 + b33 * a33;
  return dest;
}
function transformPoint3(m, p, dest) {
  dest = dest || p;
  const [x, y, z] = p;
  dest[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  dest[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  dest[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return dest;
}
function transformPoint4(m, v, dest) {
  const [v0, v1, v2, v3] = v;
  dest[0] = m[0] * v0 + m[4] * v1 + m[8] * v2 + m[12] * v3;
  dest[1] = m[1] * v0 + m[5] * v1 + m[9] * v2 + m[13] * v3;
  dest[2] = m[2] * v0 + m[6] * v1 + m[10] * v2 + m[14] * v3;
  dest[3] = m[3] * v0 + m[7] * v1 + m[11] * v2 + m[15] * v3;
  return dest;
}
function transformVec3(m, v, dest = createVec3Float64()) {
  const v0 = v[0], v1 = v[1], v2 = v[2];
  dest[0] = m[0] * v0 + m[4] * v1 + m[8] * v2;
  dest[1] = m[1] * v0 + m[5] * v1 + m[9] * v2;
  dest[2] = m[2] * v0 + m[6] * v1 + m[10] * v2;
  return dest;
}
function transformVec4(m, v, dest = createVec4Float64()) {
  const v0 = v[0], v1 = v[1], v2 = v[2], v3 = v[3];
  dest[0] = m[0] * v0 + m[4] * v1 + m[8] * v2 + m[12] * v3;
  dest[1] = m[1] * v0 + m[5] * v1 + m[9] * v2 + m[13] * v3;
  dest[2] = m[2] * v0 + m[6] * v1 + m[10] * v2 + m[14] * v3;
  dest[3] = m[3] * v0 + m[7] * v1 + m[11] * v2 + m[15] * v3;
  return dest;
}
function scaleMat4v(xyz, m = identityMat4()) {
  const [x, y, z] = xyz;
  m[0] *= x;
  m[4] *= y;
  m[8] *= z;
  m[1] *= x;
  m[5] *= y;
  m[9] *= z;
  m[2] *= x;
  m[6] *= y;
  m[10] *= z;
  m[3] *= x;
  m[7] *= y;
  m[11] *= z;
  return m;
}
function scalingMat4v(v, m = identityMat4()) {
  m[0] = v[0];
  m[5] = v[1];
  m[10] = v[2];
  return m;
}
var scalingMat4c = (() => {
  const xyz = createVec3Float64();
  return (x, y, z, dest) => {
    xyz[0] = x;
    xyz[1] = y;
    xyz[2] = z;
    return scalingMat4v(xyz, dest);
  };
})();
function composeMat4(position, quaternion, scale2, mat = createMat4Float64()) {
  quatToRotationMat4(quaternion, mat);
  scaleMat4v(scale2, mat);
  translateMat4v(position, mat);
  return mat;
}
var decomposeMat4 = (() => {
  const vec = createVec3Float64();
  const matrix = createMat4Float64();
  return function decompose(mat, position, quaternion, scale2) {
    vec[0] = mat[0];
    vec[1] = mat[1];
    vec[2] = mat[2];
    let sx = lenVec3(vec);
    vec[0] = mat[4];
    vec[1] = mat[5];
    vec[2] = mat[6];
    const sy = lenVec3(vec);
    vec[0] = mat[8];
    vec[1] = mat[9];
    vec[2] = mat[10];
    const sz = lenVec3(vec);
    const det = determinantMat4(mat);
    if (det < 0) {
      sx = -sx;
    }
    position[0] = mat[12];
    position[1] = mat[13];
    position[2] = mat[14];
    matrix.set(mat);
    const scales = [sx, sy, sz];
    const axes = scales.map((value, axis) => value === 0 ? null : [mat[axis * 4] / value, mat[axis * 4 + 1] / value, mat[axis * 4 + 2] / value]);
    const cross = (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
    const unit = (a) => {
      const length = Math.hypot(...a);
      return a.map((v) => v / length);
    };
    const present = axes.filter(Boolean).length;
    if (present === 0) {
      axes[0] = [1, 0, 0];
      axes[1] = [0, 1, 0];
      axes[2] = [0, 0, 1];
    } else {
      if (present === 1) {
        const i = axes.findIndex(Boolean), axis = axes[i];
        const least = axis.map(Math.abs).indexOf(Math.min(...axis.map(Math.abs)));
        const seed = [0, 0, 0];
        seed[least] = 1;
        axes[(i + 1) % 3] = unit(cross(seed, axis));
      }
      for (let i = 0; i < 3; i++) {
        if (!axes[i]) axes[i] = unit(cross(axes[(i + 1) % 3], axes[(i + 2) % 3]));
      }
    }
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) matrix[i * 4 + j] = axes[i][j];
    mat4ToQuat(matrix, quaternion);
    scale2[0] = sx;
    scale2[1] = sy;
    scale2[2] = sz;
  };
})();
function translateMat4v(xyz, m = identityMat4()) {
  return translateMat4c(xyz[0], xyz[1], xyz[2], m);
}
function translateMat4c(x, y, z, m = identityMat4()) {
  const m3 = m[3];
  m[0] += m3 * x;
  m[1] += m3 * y;
  m[2] += m3 * z;
  const m7 = m[7];
  m[4] += m7 * x;
  m[5] += m7 * y;
  m[6] += m7 * z;
  const m11 = m[11];
  m[8] += m11 * x;
  m[9] += m11 * y;
  m[10] += m11 * z;
  const m15 = m[15];
  m[12] += m15 * x;
  m[13] += m15 * y;
  m[14] += m15 * z;
  return m;
}
function setMat4Translation(m, translation, dest) {
  dest[0] = m[0];
  dest[1] = m[1];
  dest[2] = m[2];
  dest[3] = m[3];
  dest[4] = m[4];
  dest[5] = m[5];
  dest[6] = m[6];
  dest[7] = m[7];
  dest[8] = m[8];
  dest[9] = m[9];
  dest[10] = m[10];
  dest[11] = m[11];
  dest[12] = translation[0];
  dest[13] = translation[1];
  dest[14] = translation[2];
  dest[15] = m[15];
  return dest;
}
function translationMat4v(v, dest) {
  const m = dest || identityMat4();
  m[12] = v[0];
  m[13] = v[1];
  m[14] = v[2];
  return m;
}
var translationMat4c = (() => {
  const xyz = createVec3Float64();
  return (x, y, z, dest) => {
    xyz[0] = x;
    xyz[1] = y;
    xyz[2] = z;
    return translationMat4v(xyz, dest);
  };
})();
function determinantMat4(mat) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = mat;
  return a30 * a21 * a12 * a03 - a20 * a31 * a12 * a03 - a30 * a11 * a22 * a03 + a10 * a31 * a22 * a03 + a20 * a11 * a32 * a03 - a10 * a21 * a32 * a03 - a30 * a21 * a02 * a13 + a20 * a31 * a02 * a13 + a30 * a01 * a22 * a13 - a00 * a31 * a22 * a13 - a20 * a01 * a32 * a13 + a00 * a21 * a32 * a13 + a30 * a11 * a02 * a23 - a10 * a31 * a02 * a23 - a30 * a01 * a12 * a23 + a00 * a31 * a12 * a23 + a10 * a01 * a32 * a23 - a00 * a11 * a32 * a23 - a20 * a11 * a02 * a33 + a10 * a21 * a02 * a33 + a20 * a01 * a12 * a33 - a00 * a21 * a12 * a33 - a10 * a01 * a22 * a33 + a00 * a11 * a22 * a33;
}
function mat4ToEuler(mat, order, dest = createVec3Float64()) {
  const [m11, m12, m13, m21, m22, m23, m31, m32, m33] = mat;
  if (order === "XYZ") {
    dest[1] = Math.asin(clamp(m13, -1, 1));
    if (Math.abs(m13) < 0.99999) {
      dest[0] = Math.atan2(-m23, m33);
      dest[2] = Math.atan2(-m12, m11);
    } else {
      dest[0] = Math.atan2(m32, m22);
      dest[2] = 0;
    }
  } else if (order === "YXZ") {
    dest[0] = Math.asin(-clamp(m23, -1, 1));
    if (Math.abs(m23) < 0.99999) {
      dest[1] = Math.atan2(m13, m33);
      dest[2] = Math.atan2(m21, m22);
    } else {
      dest[1] = Math.atan2(-m31, m11);
      dest[2] = 0;
    }
  } else if (order === "ZXY") {
    dest[0] = Math.asin(clamp(m32, -1, 1));
    if (Math.abs(m32) < 0.99999) {
      dest[1] = Math.atan2(-m31, m33);
      dest[2] = Math.atan2(-m12, m22);
    } else {
      dest[1] = 0;
      dest[2] = Math.atan2(m21, m11);
    }
  } else if (order === "ZYX") {
    dest[1] = Math.asin(-clamp(m31, -1, 1));
    if (Math.abs(m31) < 0.99999) {
      dest[0] = Math.atan2(m32, m33);
      dest[2] = Math.atan2(m21, m11);
    } else {
      dest[0] = 0;
      dest[2] = Math.atan2(-m12, m22);
    }
  } else if (order === "YZX") {
    dest[2] = Math.asin(clamp(m21, -1, 1));
    if (Math.abs(m21) < 0.99999) {
      dest[0] = Math.atan2(-m23, m22);
      dest[1] = Math.atan2(-m31, m11);
    } else {
      dest[0] = 0;
      dest[1] = Math.atan2(m13, m33);
    }
  } else if (order === "XZY") {
    dest[2] = Math.asin(-clamp(m12, -1, 1));
    if (Math.abs(m12) < 0.99999) {
      dest[0] = Math.atan2(m32, m22);
      dest[1] = Math.atan2(m13, m11);
    } else {
      dest[0] = Math.atan2(-m23, m33);
      dest[1] = 0;
    }
  }
  return dest;
}
function lerpMat4(t, t1, t2, m1, m2, dest) {
  const result = dest || createMat4Float64();
  const f = (t - t1) / (t2 - t1);
  result[0] = m1[0] + f * (m2[0] - m1[0]);
  result[1] = m1[1] + f * (m2[1] - m1[1]);
  result[2] = m1[2] + f * (m2[2] - m1[2]);
  result[3] = m1[3] + f * (m2[3] - m1[3]);
  result[4] = m1[4] + f * (m2[4] - m1[4]);
  result[5] = m1[5] + f * (m2[5] - m1[5]);
  result[6] = m1[6] + f * (m2[6] - m1[6]);
  result[7] = m1[7] + f * (m2[7] - m1[7]);
  result[8] = m1[8] + f * (m2[8] - m1[8]);
  result[9] = m1[9] + f * (m2[9] - m1[9]);
  result[10] = m1[10] + f * (m2[10] - m1[10]);
  result[11] = m1[11] + f * (m2[11] - m1[11]);
  result[12] = m1[12] + f * (m2[12] - m1[12]);
  result[13] = m1[13] + f * (m2[13] - m1[13]);
  result[14] = m1[14] + f * (m2[14] - m1[14]);
  result[15] = m1[15] + f * (m2[15] - m1[15]);
  return result;
}
var vec3FromMat4Scale = (() => {
  const tempVec3 = createVec3Float64();
  return function(m, dest) {
    tempVec3[0] = m[0];
    tempVec3[1] = m[1];
    tempVec3[2] = m[2];
    dest[0] = lenVec3(tempVec3);
    tempVec3[0] = m[4];
    tempVec3[1] = m[5];
    tempVec3[2] = m[6];
    dest[1] = lenVec3(tempVec3);
    tempVec3[0] = m[8];
    tempVec3[1] = m[9];
    tempVec3[2] = m[10];
    dest[2] = lenVec3(tempVec3);
    return dest;
  };
})();

// ../sdk-oct2/src/base/math/internal/decodeOctNormalsU16Into.ts
function decodeOctNormalsU16Into(octs, result, offset = 0, stride = 3, count = octs.length / 2) {
  if (octs.length % 2 !== 0) {
    throw new Error("Invalid input: octs must contain an even number of elements.");
  }
  for (let i = 0, j = offset, len = Math.min(octs.length, count * 2); i < len; i += 2, j += stride) {
    let x = octs[i] / 65535 * 2 - 1;
    let y = octs[i + 1] / 65535 * 2 - 1;
    const z = 1 - Math.abs(x) - Math.abs(y);
    if (z < 0) {
      const tempx = (1 - Math.abs(y)) * Math.sign(x);
      const tempy = (1 - Math.abs(x)) * Math.sign(y);
      x = tempx;
      y = tempy;
    }
    const length = Math.sqrt(x * x + y * y + z * z) || 1;
    result[j] = x / length;
    result[j + 1] = y / length;
    result[j + 2] = z / length;
    if (stride === 4) result[j + 3] = 1;
  }
  return result;
}

// ../sdk-oct2/src/base/math/compression.ts
var translate = createMat4Float64();
var scale = createMat4Float64();
function decompressPoint3WithMat4(position, decompressMatrix, dest = position) {
  dest[0] = position[0] * decompressMatrix[0] + decompressMatrix[12];
  dest[1] = position[1] * decompressMatrix[5] + decompressMatrix[13];
  dest[2] = position[2] * decompressMatrix[10] + decompressMatrix[14];
  return dest;
}
function decompressPoint3WithAABB3(position, aabb, dest = position) {
  const xScale = (aabb[3] - aabb[0]) / 65535;
  const xOffset = aabb[0];
  const yScale = (aabb[4] - aabb[1]) / 65535;
  const yOffset = aabb[1];
  const zScale = (aabb[5] - aabb[2]) / 65535;
  const zOffset = aabb[2];
  dest[0] = position[0] * xScale + xOffset;
  dest[1] = position[1] * yScale + yOffset;
  dest[2] = position[2] * zScale + zOffset;
  return dest;
}
function decompressPositions3WithAABB3(positions, aabb, dest = new Float32Array(positions.length)) {
  const xScale = (aabb[3] - aabb[0]) / 65535;
  const xOffset = aabb[0];
  const yScale = (aabb[4] - aabb[1]) / 65535;
  const yOffset = aabb[1];
  const zScale = (aabb[5] - aabb[2]) / 65535;
  const zOffset = aabb[2];
  for (let i = 0; i < positions.length; i += 3) {
    dest[i] = positions[i] * xScale + xOffset;
    dest[i + 1] = positions[i + 1] * yScale + yOffset;
    dest[i + 2] = positions[i + 2] * zScale + zOffset;
  }
  return dest;
}
function quantizePositions3(positions, aabb, out) {
  const lenPositions = positions.length;
  const positionsCompressed = out ?? new Uint16Array(lenPositions);
  if (positionsCompressed.length !== lenPositions) throw new Error("quantizePositions3: destination length must match positions");
  const [xmin, ymin, zmin, xmax, ymax, zmax] = aabb;
  const xwid = xmax - xmin;
  const ywid = ymax - ymin;
  const zwid = zmax - zmin;
  const widths = [xwid, ywid, zwid];
  if (![...aabb, ...widths].every(Number.isFinite) || widths.some((width) => width < 0)) {
    throw new Error("quantizePositions3: bounds must be finite and ordered");
  }
  for (let i = 0; i < lenPositions; i++) {
    if (!Number.isFinite(positions[i])) throw new Error("quantizePositions3: positions must be finite");
    const axis = i % 3;
    const normalized = widths[axis] === 0 ? 0 : (positions[i] - aabb[axis]) / widths[axis];
    positionsCompressed[i] = Math.max(0, Math.min(65535, Math.round(normalized * 65535)));
  }
  return positionsCompressed;
}
function compressRGBColors(colors) {
  const len = colors.length;
  const compressed = new Uint16Array(len);
  for (let i = 0; i < len; i++) {
    if (colors[i] < 0 || colors[i] > 1) {
      throw new Error(`Color value at index ${i} (${colors[i]}) is out of range [0, 1].`);
    }
    compressed[i] = Math.round(colors[i] * 255);
  }
  return compressed;
}
function quantizeColor3(src, dest = new Array(3)) {
  dest[0] = clampColorByte((src[0] ?? 0) * 255);
  dest[1] = clampColorByte((src[1] ?? 0) * 255);
  dest[2] = clampColorByte((src[2] ?? 0) * 255);
  return dest;
}
function clampColorByte(value) {
  return value < 0 ? 0 : value > 255 ? 255 : Math.floor(value);
}
function packUVsToFloat32(uvs) {
  if (uvs instanceof Float32Array) {
    return uvs;
  }
  const out = new Float32Array(uvs.length);
  for (let i = 0, len = uvs.length; i < len; i++) {
    out[i] = uvs[i];
  }
  return out;
}
function octEncodeNormalsToU16(normals, out) {
  const numNormals = normals.length / 3 | 0;
  out ??= new Uint16Array(numNormals * 2);
  if (out.length !== numNormals * 2) throw new Error("octEncodeNormalsToU16: destination length must match normal count");
  for (let i = 0; i < numNormals; i++) {
    let nx = normals[i * 3];
    let ny = normals[i * 3 + 1];
    let nz = normals[i * 3 + 2];
    const invLen = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
    nx *= invLen;
    ny *= invLen;
    nz *= invLen;
    const denom = Math.abs(nx) + Math.abs(ny) + Math.abs(nz) || 1;
    let ex = nx / denom;
    let ey = ny / denom;
    if (nz < 0) {
      const tx = (1 - Math.abs(ey)) * (ex >= 0 ? 1 : -1);
      const ty = (1 - Math.abs(ex)) * (ey >= 0 ? 1 : -1);
      ex = tx;
      ey = ty;
    }
    out[i * 2] = Math.round((ex * 0.5 + 0.5) * 65535);
    out[i * 2 + 1] = Math.round((ey * 0.5 + 0.5) * 65535);
  }
  return out;
}
function octDecodeNormalsU16(octs, result = new Float32Array(octs.length / 2 * 3)) {
  return decodeOctNormalsU16Into(octs, result);
}

// ../sdk-oct2/src/base/math/boundaries.ts
var tempVec3a = createVec3Float64();
var tempVec3b = createVec3Float64();
var tempVec3c = createVec3Float64();
var tempMat4a2 = createMat4Float64();
function createAABB3Float64(values) {
  return new Float64Array(values || 6);
}
function containsAABB3(aabb1, aabb2) {
  return aabb1[0] <= aabb2[0] && aabb2[3] <= aabb1[3] && aabb1[1] <= aabb2[1] && aabb2[4] <= aabb1[4] && aabb1[2] <= aabb2[2] && aabb2[5] <= aabb1[5];
}
function getAABB3Diag(aabb) {
  return Math.abs(lenVec3(subVec3([aabb[3], aabb[4], aabb[5]], [aabb[0], aabb[1], aabb[2]], tempVec3a)));
}
function getAABB3Center(aabb, dest = createVec3Float64()) {
  dest[0] = (aabb[0] + aabb[3]) / 2;
  dest[1] = (aabb[1] + aabb[4]) / 2;
  dest[2] = (aabb[2] + aabb[5]) / 2;
  return dest;
}
function collapseAABB3(aabb) {
  aabb.set([MAX_DOUBLE, MAX_DOUBLE, MAX_DOUBLE, MIN_DOUBLE, MIN_DOUBLE, MIN_DOUBLE]);
  return aabb;
}
function expandAABB3(aabb1, aabb2) {
  for (let i = 0; i < 3; i++) {
    aabb1[i] = Math.min(aabb1[i], aabb2[i]);
    aabb1[i + 3] = Math.max(aabb1[i + 3], aabb2[i + 3]);
  }
  return aabb1;
}
function expandAABB3Point3(aabb, p) {
  for (let i = 0; i < 3; i++) {
    aabb[i] = Math.min(aabb[i], p[i]);
    aabb[i + 3] = Math.max(aabb[i + 3], p[i]);
  }
  return aabb;
}
function expandAABB3Points3(aabb, positions) {
  for (let i = 0; i < positions.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      aabb[j] = Math.min(aabb[j], positions[i + j]);
      aabb[j + 3] = Math.max(aabb[j + 3], positions[i + j]);
    }
  }
  return aabb;
}
var positions3ToAABB3 = (() => {
  const p = createVec3Float64();
  return (positions, aabb = createAABB3Float64(), positionsDecompressMatrix) => {
    let xmin = MAX_DOUBLE, ymin = MAX_DOUBLE, zmin = MAX_DOUBLE;
    let xmax = MIN_DOUBLE, ymax = MIN_DOUBLE, zmax = MIN_DOUBLE;
    for (let i = 0, len = positions.length; i < len; i += 3) {
      let x = positions[i], y = positions[i + 1], z = positions[i + 2];
      if (positionsDecompressMatrix) {
        p[0] = x;
        p[1] = y;
        p[2] = z;
        decompressPoint3WithMat4(p, positionsDecompressMatrix, p);
        x = p[0];
        y = p[1];
        z = p[2];
      }
      xmin = Math.min(xmin, x);
      ymin = Math.min(ymin, y);
      zmin = Math.min(zmin, z);
      xmax = Math.max(xmax, x);
      ymax = Math.max(ymax, y);
      zmax = Math.max(zmax, z);
    }
    aabb[0] = xmin;
    aabb[1] = ymin;
    aabb[2] = zmin;
    aabb[3] = xmax;
    aabb[4] = ymax;
    aabb[5] = zmax;
    return aabb;
  };
})();
var FrustumPlane3 = class {
  /**
   * A vertex used to test intersections with this plane.
   */
  testVertex;
  /**
   * The distance of the plane from the origin along its normal.
   */
  offset;
  /**
   * The normal vector of the plane.
   */
  normal;
  /**
   * Creates a new frustum plane.
   */
  constructor() {
    this.normal = createVec3Float64();
    this.offset = 0;
    this.testVertex = createVec3Float64();
  }
  /**
   * Sets the position and direction of the frustum plane.
   *
   * @param nx - X component of the normal vector.
   * @param ny - Y component of the normal vector.
   * @param nz - Z component of the normal vector.
   * @param offset - Distance of the plane from the origin.
   */
  set(nx, ny, nz, offset) {
    const s = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    this.normal[0] = nx * s;
    this.normal[1] = ny * s;
    this.normal[2] = nz * s;
    this.offset = offset * s;
    this.testVertex[0] = this.normal[0] >= 0 ? 1 : 0;
    this.testVertex[1] = this.normal[1] >= 0 ? 1 : 0;
    this.testVertex[2] = this.normal[2] >= 0 ? 1 : 0;
  }
};
var INSIDE = 1;
var INTERSECT = 2;
var OUTSIDE = 3;
var Frustum3 = class {
  /**
   * The six planes that define the frustum boundary.
   */
  planes;
  /**
   * Creates a new 3D frustum.
   */
  constructor() {
    this.planes = [
      new FrustumPlane3(),
      new FrustumPlane3(),
      new FrustumPlane3(),
      new FrustumPlane3(),
      new FrustumPlane3(),
      new FrustumPlane3()
    ];
  }
};
function setFrustum3(viewMat, projMat, frustum) {
  const m = mulMat4(projMat, viewMat, tempMat4a2);
  const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3];
  const m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7];
  const m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11];
  const m12 = m[12], m13 = m[13], m14 = m[14], m15 = m[15];
  frustum = frustum || new Frustum3();
  frustum.planes[0].set(m3 - m0, m7 - m4, m11 - m8, m15 - m12);
  frustum.planes[1].set(m3 + m0, m7 + m4, m11 + m8, m15 + m12);
  frustum.planes[2].set(m3 - m1, m7 - m5, m11 - m9, m15 - m13);
  frustum.planes[3].set(m3 + m1, m7 + m5, m11 + m9, m15 + m13);
  frustum.planes[4].set(m3 - m2, m7 - m6, m11 - m10, m15 - m14);
  frustum.planes[5].set(m3 + m2, m7 + m6, m11 + m10, m15 + m14);
  return frustum;
}
function intersectFrustum3AABB3(frustum, aabb) {
  let ret = INSIDE;
  const min = tempVec3a;
  const max = tempVec3b;
  min[0] = aabb[0];
  min[1] = aabb[1];
  min[2] = aabb[2];
  max[0] = aabb[3];
  max[1] = aabb[4];
  max[2] = aabb[5];
  const bminmax = [min, max];
  for (let i = 0; i < 6; ++i) {
    const plane = frustum.planes[i];
    if (plane.normal[0] * bminmax[plane.testVertex[0]][0] + plane.normal[1] * bminmax[plane.testVertex[1]][1] + plane.normal[2] * bminmax[plane.testVertex[2]][2] + plane.offset < 0) {
      return OUTSIDE;
    }
    if (plane.normal[0] * bminmax[1 - plane.testVertex[0]][0] + plane.normal[1] * bminmax[1 - plane.testVertex[1]][1] + plane.normal[2] * bminmax[1 - plane.testVertex[2]][2] + plane.offset < 0) {
      ret = INTERSECT;
    }
  }
  return ret;
}

// ../sdk-oct2/src/base/math/rtc.ts
var tempVec3a2 = createVec3Float64();
var tempMat = createMat4Float64();
var rtcCenterWorld = createVec4Float64();
var rtcCenterView = createVec4Float64();
function createRTCViewMat(viewMat, rtcCenter, rtcViewMat = tempMat) {
  const [x, y, z] = rtcCenter;
  if (x === 0 && y === 0 && z === 0) {
    rtcViewMat.set(viewMat);
    return rtcViewMat;
  }
  rtcCenterWorld.set([x, y, z, 1]);
  transformVec4(viewMat, rtcCenterWorld, rtcCenterView);
  tempVec3a2[0] = rtcCenterView[0];
  tempVec3a2[1] = rtcCenterView[1];
  tempVec3a2[2] = rtcCenterView[2];
  setMat4Translation(viewMat, tempVec3a2, rtcViewMat);
  return rtcViewMat;
}
function worldToRTCPos(worldPos, rtcCenter, rtcPos) {
  const xHigh = Float32Array.from([worldPos[0]])[0];
  const xLow = worldPos[0] - xHigh;
  const yHigh = Float32Array.from([worldPos[1]])[0];
  const yLow = worldPos[1] - yHigh;
  const zHigh = Float32Array.from([worldPos[2]])[0];
  const zLow = worldPos[2] - zHigh;
  rtcCenter[0] = xHigh;
  rtcCenter[1] = yHigh;
  rtcCenter[2] = zHigh;
  rtcPos[0] = xLow;
  rtcPos[1] = yLow;
  rtcPos[2] = zLow;
}
function worldToRTCCenter(worldCenter, rtcCenter, tileSize) {
  rtcCenter[0] = Math.round(worldCenter[0] / tileSize) * tileSize;
  rtcCenter[1] = Math.round(worldCenter[1] / tileSize) * tileSize;
  rtcCenter[2] = Math.round(worldCenter[2] / tileSize) * tileSize;
  return rtcCenter;
}
function getRTCTileSize(worldPos) {
  const mag = Math.max(
    Math.abs(worldPos[0]),
    Math.abs(worldPos[1]),
    Math.abs(worldPos[2])
  );
  if (mag === 0) return 1e3;
  const baseTile = 200;
  const bucketDecades = 4;
  const allowedError = 5e-4;
  const maxTile = allowedError * 16777216;
  const exp10 = Math.floor(Math.log10(mag));
  const bucketedExp10 = exp10 - (exp10 % bucketDecades + bucketDecades) % bucketDecades;
  const decadeBase = Math.pow(10, bucketedExp10);
  const m = mag / decadeBase;
  let step;
  if (m < 2.5) step = 1;
  else if (m < 7.5) step = 2;
  else step = 5;
  let tileSize = baseTile / decadeBase / step;
  if (tileSize > maxTile) tileSize = maxTile;
  const minTile = 20;
  if (tileSize < minTile) tileSize = minTile;
  return tileSize;
}

// ../sdk-oct2/src/base/math/shadows.ts
function computeShadowCascadeSplits(params) {
  const count = Math.max(1, Math.floor(params.cascadeCount));
  const near = Math.max(1e-6, params.nearDistance);
  const far = Math.max(near + 1e-6, params.farDistance);
  const lambda = clamp01(params.lambda);
  const target = params.target ?? new Float32Array(count + 1);
  target[0] = near;
  for (let i = 1; i <= count; i++) {
    const p = i / count;
    const log = near * Math.pow(far / near, p);
    const uniform = near + (far - near) * p;
    target[i] = lambda * log + (1 - lambda) * uniform;
  }
  return target;
}
function stabilizeShadowOrthoBounds(params) {
  const resolution = Math.max(1, Math.floor(params.resolution));
  const extentX = params.right - params.left;
  const extentY = params.top - params.bottom;
  const fallbackTexelWorldSize = Math.max(1e-6, Math.max(extentX, extentY) / resolution);
  if (!Number.isFinite(extentX) || !Number.isFinite(extentY) || extentX <= 0 || extentY <= 0) {
    return {
      left: params.left,
      right: params.right,
      bottom: params.bottom,
      top: params.top,
      texelWorldSize: fallbackTexelWorldSize
    };
  }
  const stableExtent = Math.max(extentX, extentY) * (1 + 2 / resolution);
  const texelWorldSize = Math.max(1e-6, stableExtent / resolution);
  const centerX = (params.left + params.right) * 0.5;
  const centerY = (params.bottom + params.top) * 0.5;
  const anchorX = Number.isFinite(params.anchorX) ? Number(params.anchorX) : 0;
  const anchorY = Number.isFinite(params.anchorY) ? Number(params.anchorY) : 0;
  const snappedCenterX = Math.round((centerX - anchorX) / texelWorldSize) * texelWorldSize + anchorX;
  const snappedCenterY = Math.round((centerY - anchorY) / texelWorldSize) * texelWorldSize + anchorY;
  const halfExtent = stableExtent * 0.5;
  return {
    left: snappedCenterX - halfExtent,
    right: snappedCenterX + halfExtent,
    bottom: snappedCenterY - halfExtent,
    top: snappedCenterY + halfExtent,
    texelWorldSize
  };
}
function fitShadowCascadeToCamera(params) {
  const aspect = Math.max(1e-6, params.canvasHeight > 0 ? params.canvasWidth / params.canvasHeight : 1);
  const nearDistance = Math.max(1e-6, params.nearDistance);
  const farDistance = Math.max(nearDistance + 1e-6, params.farDistance);
  const { halfNearW, halfNearH, halfFarW, halfFarH } = getFrustumHalfExtents(
    params.projection,
    aspect,
    nearDistance,
    farDistance
  );
  const corners = [
    [-halfNearW, -halfNearH, -nearDistance],
    [halfNearW, -halfNearH, -nearDistance],
    [-halfNearW, halfNearH, -nearDistance],
    [halfNearW, halfNearH, -nearDistance],
    [-halfFarW, -halfFarH, -farDistance],
    [halfFarW, -halfFarH, -farDistance],
    [-halfFarW, halfFarH, -farDistance],
    [halfFarW, halfFarH, -farDistance]
  ];
  const lightView = params.lightViewMatrix;
  const inverseView = params.cameraInverseViewMatrix;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const corner of corners) {
    const wx = inverseView[0] * corner[0] + inverseView[4] * corner[1] + inverseView[8] * corner[2] + inverseView[12];
    const wy = inverseView[1] * corner[0] + inverseView[5] * corner[1] + inverseView[9] * corner[2] + inverseView[13];
    const wz = inverseView[2] * corner[0] + inverseView[6] * corner[1] + inverseView[10] * corner[2] + inverseView[14];
    const lx = lightView[0] * wx + lightView[4] * wy + lightView[8] * wz + lightView[12];
    const ly = lightView[1] * wx + lightView[5] * wy + lightView[9] * wz + lightView[13];
    const lz = lightView[2] * wx + lightView[6] * wy + lightView[10] * wz + lightView[14];
    minX = Math.min(minX, lx);
    maxX = Math.max(maxX, lx);
    minY = Math.min(minY, ly);
    maxY = Math.max(maxY, ly);
    minZ = Math.min(minZ, lz);
    maxZ = Math.max(maxZ, lz);
  }
  const sceneAABB = params.sceneAABB;
  if (sceneAABB && isFiniteShadowAABB(sceneAABB)) {
    let sceneMinX = Infinity;
    let sceneMaxX = -Infinity;
    let sceneMinY = Infinity;
    let sceneMaxY = -Infinity;
    let sceneMinZ = Infinity;
    let sceneMaxZ = -Infinity;
    for (let cornerIdx = 0; cornerIdx < 8; cornerIdx++) {
      const wx = cornerIdx & 1 ? sceneAABB[3] : sceneAABB[0];
      const wy = cornerIdx & 2 ? sceneAABB[4] : sceneAABB[1];
      const wz = cornerIdx & 4 ? sceneAABB[5] : sceneAABB[2];
      const lx = lightView[0] * wx + lightView[4] * wy + lightView[8] * wz + lightView[12];
      const ly = lightView[1] * wx + lightView[5] * wy + lightView[9] * wz + lightView[13];
      const lz = lightView[2] * wx + lightView[6] * wy + lightView[10] * wz + lightView[14];
      sceneMinX = Math.min(sceneMinX, lx);
      sceneMaxX = Math.max(sceneMaxX, lx);
      sceneMinY = Math.min(sceneMinY, ly);
      sceneMaxY = Math.max(sceneMaxY, ly);
      sceneMinZ = Math.min(sceneMinZ, lz);
      sceneMaxZ = Math.max(sceneMaxZ, lz);
    }
    const intersectMinX = Math.max(minX, sceneMinX);
    const intersectMaxX = Math.min(maxX, sceneMaxX);
    const intersectMinY = Math.max(minY, sceneMinY);
    const intersectMaxY = Math.min(maxY, sceneMaxY);
    const intersectMinZ = Math.max(minZ, sceneMinZ);
    const intersectMaxZ = Math.min(maxZ, sceneMaxZ);
    if (intersectMinX < intersectMaxX && intersectMinY < intersectMaxY && intersectMinZ < intersectMaxZ) {
      minX = intersectMinX;
      maxX = intersectMaxX;
      minY = intersectMinY;
      maxY = intersectMaxY;
      minZ = intersectMinZ;
      maxZ = intersectMaxZ;
    }
  }
  const padMul = Math.max(1, params.padding);
  const padX = (maxX - minX) * (padMul - 1) * 0.5;
  const padY = (maxY - minY) * (padMul - 1) * 0.5;
  const stableBounds = stabilizeShadowOrthoBounds({
    left: minX - padX,
    right: maxX + padX,
    bottom: minY - padY,
    top: maxY + padY,
    resolution: params.resolution,
    anchorX: params.anchorX ?? lightView[12],
    anchorY: params.anchorY ?? lightView[13]
  });
  if (params.casterAABB && isFiniteShadowAABB(params.casterAABB)) {
    const b = params.casterAABB;
    for (let c = 0; c < 8; c++) {
      const z = lightView[2] * b[c & 1 ? 3 : 0] + lightView[6] * b[c & 2 ? 4 : 1] + lightView[10] * b[c & 4 ? 5 : 2] + lightView[14];
      maxZ = Math.max(maxZ, z);
    }
  }
  const near = -maxZ;
  const far = -minZ + farDistance;
  return {
    left: stableBounds.left,
    right: stableBounds.right,
    bottom: stableBounds.bottom,
    top: stableBounds.top,
    near,
    far,
    depthRange: Math.max(1e-3, far - near),
    texelWorldSize: stableBounds.texelWorldSize
  };
}
function isFiniteShadowAABB(aabb) {
  return aabb[0] <= aabb[3] && aabb[1] <= aabb[4] && aabb[2] <= aabb[5] && Number.isFinite(aabb[0]) && Number.isFinite(aabb[3]) && Number.isFinite(aabb[1]) && Number.isFinite(aabb[4]) && Number.isFinite(aabb[2]) && Number.isFinite(aabb[5]);
}
function getFrustumHalfExtents(projection, aspect, nearDistance, farDistance) {
  if (projection.type === "perspective") {
    const fovRad = projection.fovDegrees * Math.PI / 180;
    const tanHalfFov = Math.tan(fovRad * 0.5);
    if (aspect >= 1) {
      const halfNearH2 = tanHalfFov * nearDistance;
      const halfFarH = tanHalfFov * farDistance;
      return {
        halfNearW: halfNearH2 * aspect,
        halfNearH: halfNearH2,
        halfFarW: halfFarH * aspect,
        halfFarH
      };
    }
    const halfNearW2 = tanHalfFov * nearDistance;
    const halfFarW = tanHalfFov * farDistance;
    return {
      halfNearW: halfNearW2,
      halfNearH: halfNearW2 / aspect,
      halfFarW,
      halfFarH: halfFarW / aspect
    };
  }
  const halfNearH = projection.scale * 0.5;
  const halfNearW = halfNearH * aspect;
  return {
    halfNearW,
    halfNearH,
    halfFarW: halfNearW,
    halfFarH: halfNearH
  };
}
function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// ../sdk-oct2/src/base/math/index.ts
var MIN_DOUBLE = -Number.MAX_SAFE_INTEGER;
var MAX_DOUBLE = Number.MAX_SAFE_INTEGER;
var DEGTORAD = 0.0174532925;
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function clamp012(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// ../sdk-oct2/src/base/math/quat.ts
var tempMat4a3 = createMat4Float64();
var tempQuat = createQuatFloat64();
function createQuatFloat64(values) {
  return new Float64Array(values || [0, 0, 0, 1]);
}
function identityQuat(dest = createVec4Float64()) {
  dest[0] = 0;
  dest[1] = 0;
  dest[2] = 0;
  dest[3] = 1;
  return dest;
}
function eulerToQuat(euler, order, dest = createQuatFloat64()) {
  const a = euler[0] * DEGTORAD / 2;
  const b = euler[1] * DEGTORAD / 2;
  const c = euler[2] * DEGTORAD / 2;
  const c1 = Math.cos(a);
  const c2 = Math.cos(b);
  const c3 = Math.cos(c);
  const s1 = Math.sin(a);
  const s2 = Math.sin(b);
  const s3 = Math.sin(c);
  switch (order) {
    case "XYZ":
      dest[0] = s1 * c2 * c3 + c1 * s2 * s3;
      dest[1] = c1 * s2 * c3 - s1 * c2 * s3;
      dest[2] = c1 * c2 * s3 + s1 * s2 * c3;
      dest[3] = c1 * c2 * c3 - s1 * s2 * s3;
      break;
    case "YXZ":
      dest[0] = s1 * c2 * c3 + c1 * s2 * s3;
      dest[1] = c1 * s2 * c3 - s1 * c2 * s3;
      dest[2] = c1 * c2 * s3 - s1 * s2 * c3;
      dest[3] = c1 * c2 * c3 + s1 * s2 * s3;
      break;
    case "ZXY":
      dest[0] = s1 * c2 * c3 - c1 * s2 * s3;
      dest[1] = c1 * s2 * c3 + s1 * c2 * s3;
      dest[2] = c1 * c2 * s3 + s1 * s2 * c3;
      dest[3] = c1 * c2 * c3 - s1 * s2 * s3;
      break;
    case "ZYX":
      dest[0] = s1 * c2 * c3 - c1 * s2 * s3;
      dest[1] = c1 * s2 * c3 + s1 * c2 * s3;
      dest[2] = c1 * c2 * s3 - s1 * s2 * c3;
      dest[3] = c1 * c2 * c3 + s1 * s2 * s3;
      break;
    case "YZX":
      dest[0] = s1 * c2 * c3 + c1 * s2 * s3;
      dest[1] = c1 * s2 * c3 + s1 * c2 * s3;
      dest[2] = c1 * c2 * s3 - s1 * s2 * c3;
      dest[3] = c1 * c2 * c3 - s1 * s2 * s3;
      break;
    case "XZY":
      dest[0] = s1 * c2 * c3 - c1 * s2 * s3;
      dest[1] = c1 * s2 * c3 - s1 * c2 * s3;
      dest[2] = c1 * c2 * s3 + s1 * s2 * c3;
      dest[3] = c1 * c2 * c3 + s1 * s2 * s3;
      break;
    default:
      throw new Error(`Unsupported Euler angle order: ${order}`);
  }
  return dest;
}
function mat4ToQuat(m, dest = createQuatFloat64()) {
  const m11 = m[0], m12 = m[4], m13 = m[8];
  const m21 = m[1], m22 = m[5], m23 = m[9];
  const m31 = m[2], m32 = m[6], m33 = m[10];
  const trace = m11 + m22 + m33;
  let s;
  if (trace > 0) {
    s = 0.5 / Math.sqrt(trace + 1);
    dest[3] = 0.25 / s;
    dest[0] = (m32 - m23) * s;
    dest[1] = (m13 - m31) * s;
    dest[2] = (m21 - m12) * s;
  } else {
    if (m11 > m22 && m11 > m33) {
      s = 2 * Math.sqrt(1 + m11 - m22 - m33);
      dest[3] = (m32 - m23) / s;
      dest[0] = 0.25 * s;
      dest[1] = (m12 + m21) / s;
      dest[2] = (m13 + m31) / s;
    } else if (m22 > m33) {
      s = 2 * Math.sqrt(1 + m22 - m11 - m33);
      dest[3] = (m13 - m31) / s;
      dest[0] = (m12 + m21) / s;
      dest[1] = 0.25 * s;
      dest[2] = (m23 + m32) / s;
    } else {
      s = 2 * Math.sqrt(1 + m33 - m11 - m22);
      dest[3] = (m21 - m12) / s;
      dest[0] = (m13 + m31) / s;
      dest[1] = (m23 + m32) / s;
      dest[2] = 0.25 * s;
    }
  }
  return dest;
}
function quatToEuler(q, order, dest = createVec3Float64()) {
  quatToRotationMat4(q, tempMat4a3);
  mat4ToEuler(tempMat4a3, order, dest);
  return dest;
}
function quatToMat4(q, dest = identityMat4(createMat4Float64())) {
  const q0 = q[0], q1 = q[1], q2 = q[2], q3 = q[3];
  const tx = 2 * q0, ty = 2 * q1, tz = 2 * q2;
  const twx = tx * q3, twy = ty * q3, twz = tz * q3;
  const txx = tx * q0, txy = ty * q0, txz = tz * q0;
  const tyy = ty * q1, tyz = tz * q1, tzz = tz * q2;
  dest[0] = 1 - (tyy + tzz);
  dest[1] = txy + twz;
  dest[2] = txz - twy;
  dest[4] = txy - twz;
  dest[5] = 1 - (txx + tzz);
  dest[6] = tyz + twx;
  dest[8] = txz + twy;
  dest[9] = tyz - twx;
  dest[10] = 1 - (txx + tyy);
  return dest;
}
function quatToRotationMat4(q, m) {
  const x = q[0];
  const y = q[1];
  const z = q[2];
  const w = q[3];
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  m[0] = 1 - (yy + zz);
  m[4] = xy - wz;
  m[8] = xz + wy;
  m[1] = xy + wz;
  m[5] = 1 - (xx + zz);
  m[9] = yz - wx;
  m[2] = xz - wy;
  m[6] = yz + wx;
  m[10] = 1 - (xx + yy);
  m[3] = 0;
  m[7] = 0;
  m[11] = 0;
  m[12] = 0;
  m[13] = 0;
  m[14] = 0;
  m[15] = 1;
  return m;
}

// ../sdk-oct2/src/viewing/renderers/internal/lightingDomainsWGSL.ts
var LIGHTING_DOMAINS_WGSL = `
@group(0) @binding(10) var<storage,read> lightingDomains: array<vec4f>;
fn domainBRDF(n:vec3f,v:vec3f,l:vec3f,base:vec3f,rough:f32,metal:f32,ior:f32,coat:vec4f,pbr:bool,transmission:f32)->vec3f {
  let nl=max(dot(n,l),0.0);
  if(nl<=0.0){return vec3f(0);}
  if(!pbr){return base*nl*(1.0-transmission);}
  let h=normalize(v+l);
  let nv=max(dot(n,v),.001);let nh=max(dot(n,h),0.0);let vh=max(dot(v,h),0.0);
  let f0=pow((ior-1.0)/(ior+1.0),2.0);
  var f=mix(vec3f(f0),base,metal);f=f+(vec3f(1)-f)*pow(1.0-vh,5.0);
  let a=pow(max(rough,.045),4.0);let den=nh*nh*(a-1.0)+1.0;
  let d=a/(3.14159265*den*den);let k=pow(rough+1.0,2.0)/8.0;
  let g=nv/(nv*(1.0-k)+k)*nl/max(nl*(1.0-k)+k,.0001);
  let spec=d*g*f/max(4.0*nl*nv,.0001);
  let diff=(vec3f(1)-f)*(1.0-metal)*base/3.14159265;
  let cf=.04+.96*pow(1.0-vh,5.0);let ca=pow(max(coat.y,.045),4.0);let cd=nh*nh*(ca-1.0)+1.0;
  let ck=pow(coat.y+1.0,2.0)/8.0;
  let cg=nv/(nv*(1.0-ck)+ck)*nl/max(nl*(1.0-ck)+ck,.0001);
  let cs=coat.x*ca/(3.14159265*cd*cd)*cg*cf/max(4.0*nl*nv,.0001);
  let sheen=base*coat.z*pow(1.0-vh,mix(8.0,2.0,coat.w))*(1.0-metal);
  return ((diff+sheen)*(1.0-transmission)*(1.0-coat.x*cf)+spec*(1.0-coat.x*cf)+vec3f(cs))*nl;
}
fn shadeLightingDomain(slot:u32,p:vec3f,n:vec3f,v:vec3f,base:vec3f,rough:f32,metal:f32,ior:f32,coat:vec4f,pbr:bool,transmission:f32,ao:f32,emission:vec3f,environment:vec3f)->vec3f {
  let header=lightingDomains[slot*2u];
  var result=(lightingDomains[slot*2u+1u].rgb*base*(1.0-transmission)+environment*header.z)*ao+emission;
  for(var i=0u;i<u32(header.y);i++) {
    let address=u32(lightingDomains[u32(header.x)+i].x);
    let position=lightingDomains[address];let direction=lightingDomains[address+1u];let color=lightingDomains[address+2u];
    var l=-direction.xyz;var attenuation=1.0;
    if(position.w>.5) {
      let delta=position.xyz-p;let distance=length(delta);l=delta/max(distance,.00001);
      if(direction.w>0.0 && distance>=direction.w){continue;}
      attenuation=1.0/max(distance*distance,.0001);
      if(direction.w>0.0){attenuation*=pow(max(1.0-pow(distance/direction.w,4.0),0.0),2.0);}
      if(position.w>1.5){attenuation*=smoothstep(color.w,lightingDomains[address+3u].x,dot(-l,direction.xyz));}
    }
    result+=domainBRDF(n,v,l,base,rough,metal,ior,coat,pbr,transmission)*color.rgb*attenuation;
  }
  return result;
}
`;

// ../sdk-oct2/src/viewing/renderers/internal/lightingDomains.ts
var LightingDomainTable = class {
  data = new Float32Array(4);
  _scene;
  _version = -1;
  _meters = NaN;
  _frame = new Float64Array(16).fill(NaN);
  update(scene, frame) {
    const meters = scene.coordinateSystem?.scaleToMeters ?? { meters: 1, millimeters: 1e-3, feet: 0.3048, inches: 0.0254 }[scene.coordinateSystem?.units ?? "meters"];
    if (meters === this._meters && scene === this._scene && scene.lightingVersion === this._version && this._frame.every((v, i) => v === frame[i])) return false;
    this._meters = meters;
    this._scene = scene;
    this._version = scene.lightingVersion;
    this._frame.set(Array.from(frame));
    const domains = Object.values(scene.lightingDomains ?? {});
    const slots = domains.reduce((n, d) => Math.max(n, d._slot + 1), 1);
    const lights = /* @__PURE__ */ new Map();
    const lists = domains.map((domain) => ({ domain, lights: domain.lights.filter((light) => light.active && light.intensity > 0) }));
    let refs = 0;
    for (const list of lists) {
      refs += list.lights.length;
      for (const light of list.lights) lights.set(light, 0);
    }
    const size = domains.length ? slots * 8 + refs * 4 + lights.size * 16 : 4;
    if (this.data.length !== size) this.data = new Float32Array(size);
    else this.data.fill(0);
    let offset = slots * 8 + refs * 4;
    for (const light of lights.keys()) {
      lights.set(light, offset / 4);
      const { position: p, direction: d } = light._world();
      const color = light.color;
      for (let i = 0; i < 3; i++) {
        this.data[offset + i] = frame[i] * p[0] + frame[i + 4] * p[1] + frame[i + 8] * p[2] + frame[i + 12];
        this.data[offset + 4 + i] = frame[i] * d[0] + frame[i + 4] * d[1] + frame[i + 8] * d[2];
        this.data[offset + 8 + i] = color[i] * light.intensity / (light.type === "directional" ? 1 : meters * meters);
      }
      this.data[offset + 3] = light.type === "directional" ? 0 : light.type === "point" ? 1 : 2;
      this.data[offset + 7] = (light.range ?? 0) / meters;
      this.data[offset + 11] = Math.cos(light.outerConeAngle);
      this.data[offset + 12] = Math.cos(light.innerConeAngle);
      offset += 16;
    }
    offset = slots * 8;
    for (const { domain, lights: selected } of lists) {
      const base = domain._slot * 8;
      this.data.set([offset / 4, selected.length, domain.environment === "view" ? domain.environmentIntensity : 0, 0], base);
      this.data.set(Array.from(domain.ambient), base + 4);
      for (const light of selected) {
        this.data[offset] = lights.get(light);
        offset += 4;
      }
    }
    return true;
  }
};

// ../sdk-oct2/src/viewing/renderers/internal/lightingDomainsGLSL.ts
var LIGHTING_DOMAINS_GLSL = `
uniform highp sampler2D uLightingDomains;
vec4 domainRecord(int address) {
  int width=textureSize(uLightingDomains,0).x;
  return texelFetch(uLightingDomains,ivec2(address%width,address/width),0);
}
vec3 domainBRDF(vec3 n,vec3 v,vec3 l,vec3 base,float rough,float metal,float ior,vec4 coat,bool pbr,float transmission) {
  float nl=max(dot(n,l),0.0);
  if(nl<=0.0) return vec3(0);
  if(!pbr) return base*nl*(1.0-transmission);
  vec3 h=normalize(v+l);
  float nv=max(dot(n,v),0.001),nh=max(dot(n,h),0.0),vh=max(dot(v,h),0.0);
  float f0=pow((ior-1.0)/(ior+1.0),2.0);
  vec3 f=mix(vec3(f0),base,metal); f=f+(1.0-f)*pow(1.0-vh,5.0);
  float a=pow(max(rough,0.045),4.0),den=nh*nh*(a-1.0)+1.0;
  float d=a/(3.14159265*den*den),k=pow(rough+1.0,2.0)/8.0;
  float g=nv/(nv*(1.0-k)+k)*nl/max(nl*(1.0-k)+k,0.0001);
  vec3 spec=d*g*f/max(4.0*nl*nv,0.0001);
  vec3 diff=(1.0-f)*(1.0-metal)*base/3.14159265;
  float cf=.04+.96*pow(1.0-vh,5.0),ca=pow(max(coat.y,.045),4.0),cd=nh*nh*(ca-1.0)+1.0;
  float ck=pow(coat.y+1.0,2.0)/8.0;
  float cg=nv/(nv*(1.0-ck)+ck)*nl/max(nl*(1.0-ck)+ck,.0001);
  float cs=coat.x*ca/(3.14159265*cd*cd)*cg*cf/max(4.0*nl*nv,.0001);
  vec3 sheen=base*coat.z*pow(1.0-vh,mix(8.0,2.0,coat.w))*(1.0-metal);
  return ((diff+sheen)*(1.0-transmission)*(1.0-coat.x*cf)+spec*(1.0-coat.x*cf)+vec3(cs))*nl;
}
vec3 shadeLightingDomain(int slot,vec3 p,vec3 n,vec3 v,vec3 base,float rough,float metal,float ior,vec4 coat,bool pbr,float transmission,float ao,vec3 emission,vec3 environment) {
  vec4 header=domainRecord(slot*2);
  vec3 result=(domainRecord(slot*2+1).rgb*base*(1.0-transmission)+environment*header.z)*ao+emission;
  for(int i=0;i<int(header.y);i++) {
    int address=int(domainRecord(int(header.x)+i).x);
    vec4 position=domainRecord(address),direction=domainRecord(address+1),color=domainRecord(address+2);
    vec3 l=-direction.xyz; float attenuation=1.0;
    if(position.w>0.5) {
      vec3 delta=position.xyz-p; float distance=length(delta); l=delta/max(distance,.00001);
      if(direction.w>0.0 && distance>=direction.w) continue;
      attenuation=1.0/max(distance*distance,.0001);
      if(direction.w>0.0) attenuation*=pow(max(1.0-pow(distance/direction.w,4.0),0.0),2.0);
      if(position.w>1.5) attenuation*=smoothstep(color.w,domainRecord(address+3).x,dot(-l,direction.xyz));
    }
    result+=domainBRDF(n,v,l,base,rough,metal,ior,coat,pbr,transmission)*color.rgb*attenuation;
  }
  return result;
}
`;

export {
  __commonJS,
  __export,
  __toESM,
  createVec2Float64,
  createVec2Float32,
  createVec2Int32,
  createVec3Float64,
  createVec3Float32,
  createVec4Float64,
  createVec4Float32,
  createVec9Float64,
  dotVec3,
  mulVec3Scalar,
  addVec3,
  compareVec3,
  subVec3,
  subVec2,
  dotVec4,
  cross3Vec3,
  sqLenVec3,
  lenVec3,
  distVec3,
  lerpVec3,
  distVec2,
  normalizeVec3,
  testOrthogonalAxis,
  createQuatFloat64,
  identityQuat,
  eulerToQuat,
  quatToEuler,
  quatToMat4,
  perspectiveMat4,
  createMat4Float32,
  createMat4Float64,
  orthoMat4c,
  frustumMat4,
  identityMat4,
  isIdentityMat4,
  rotationMat4v,
  lookAtMat4v,
  inverseMat4,
  transposeMat4,
  mulMat4,
  transformPoint3,
  transformPoint4,
  transformVec3,
  transformVec4,
  scalingMat4v,
  composeMat4,
  decomposeMat4,
  translationMat4v,
  determinantMat4,
  lerpMat4,
  decodeOctNormalsU16Into,
  decompressPoint3WithAABB3,
  decompressPositions3WithAABB3,
  quantizePositions3,
  compressRGBColors,
  quantizeColor3,
  packUVsToFloat32,
  octEncodeNormalsToU16,
  octDecodeNormalsU16,
  createAABB3Float64,
  containsAABB3,
  getAABB3Diag,
  getAABB3Center,
  collapseAABB3,
  expandAABB3,
  expandAABB3Point3,
  expandAABB3Points3,
  INSIDE,
  OUTSIDE,
  Frustum3,
  setFrustum3,
  intersectFrustum3AABB3,
  createRTCViewMat,
  worldToRTCPos,
  worldToRTCCenter,
  getRTCTileSize,
  computeShadowCascadeSplits,
  fitShadowCascadeToCamera,
  isFiniteShadowAABB,
  DEGTORAD,
  clamp,
  clamp012 as clamp01,
  RepeatWrapping,
  ClampToEdgeWrapping,
  MirroredRepeatWrapping,
  NearestFilter,
  NearestMipMapNearestFilter,
  NearestMipMapLinearFilter,
  LinearFilter,
  LinearMipMapNearestFilter,
  LinearMipmapLinearFilter,
  LinearMipMapLinearFilter,
  LinearEncoding,
  sRGBEncoding,
  GIFMediaType,
  JPEGMediaType,
  PNGMediaType,
  PointsPrimitive,
  LinesPrimitive,
  TrianglesPrimitive,
  SolidPrimitive,
  SurfacePrimitive,
  GaussianSplatsPrimitive,
  PerspectiveProjectionType,
  OrthoProjectionType,
  FrustumProjectionType,
  CustomProjectionType,
  OrbitNavigationMode,
  FirstPersonNavigationMode,
  PlanViewNavigationMode,
  QWERTYLayout,
  AZERTYLayout,
  LIGHTING_DOMAINS_WGSL,
  LightingDomainTable,
  LIGHTING_DOMAINS_GLSL
};
