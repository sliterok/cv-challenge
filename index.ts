import cv from 'opencv4nodejs';
import ffmpeg from 'fluent-ffmpeg';
import { PassThrough } from 'node:stream';
import { createNoise2D, createNoise3D } from 'simplex-noise';

type Vec3 = { x: number; y: number; z: number };
type Rgb = { r: number; g: number; b: number };

export type Hitbox = { x: number; y: number; width: number; height: number };

type SceneObject = {
  id: number;
  isMoving: boolean;
  isTarget: boolean;
  basePosition: Vec3;
  moveAmplitude: Vec3;
  moveSpeed: number;
  rotationAxis: Vec3;
  rotationSpeed: number;
  scaleBase: number;
  scaleAmp: number;
  scaleSpeed: number;
  morphAmp: number;
  morphSpeed: number;
  color: Rgb;
  seed: number;
};

type SceneInfo = {
  objects: SceneObject[];
  targetId: number;
  movingCount: number;
  staticCount: number;
};

type FaceRender = {
  points: cv.Point2[];
  depth: number;
  color: Rgb;
};

const CUBE_VERTICES: Vec3[] = [
  { x: -1, y: -1, z: 1 },
  { x: 1, y: -1, z: 1 },
  { x: 1, y: 1, z: 1 },
  { x: -1, y: 1, z: 1 },
  { x: -1, y: -1, z: -1 },
  { x: 1, y: -1, z: -1 },
  { x: 1, y: 1, z: -1 },
  { x: -1, y: 1, z: -1 }
];

const CUBE_FACES: number[][] = [
  [0, 1, 2, 3],
  [4, 7, 6, 5],
  [0, 4, 5, 1],
  [3, 2, 6, 7],
  [1, 5, 6, 2],
  [0, 3, 7, 4]
];

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const randRange = (min: number, max: number): number =>
  min + Math.random() * (max - min);

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scaleVec = (v: Vec3, s: number): Vec3 => ({ x: v.x * s, y: v.y * s, z: v.z * s });

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
});

const length = (v: Vec3): number => Math.sqrt(dot(v, v));
const normalize = (v: Vec3): Vec3 => {
  const len = length(v);
  return len === 0 ? { x: 0, y: 0, z: 0 } : scaleVec(v, 1 / len);
};

const rotationMatrixFromAxisAngle = (axis: Vec3, angle: number): number[][] => {
  const nAxis = normalize(axis);
  const x = nAxis.x;
  const y = nAxis.y;
  const z = nAxis.z;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c]
  ];
};

const applyMatrix = (m: number[][], v: Vec3): Vec3 => ({
  x: m[0][0] * v.x + m[0][1] * v.y + m[0][2] * v.z,
  y: m[1][0] * v.x + m[1][1] * v.y + m[1][2] * v.z,
  z: m[2][0] * v.x + m[2][1] * v.y + m[2][2] * v.z
});

const shuffle = <T>(items: T[]): T[] => {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const randomUnitVector = (): Vec3 => {
  const u = Math.random();
  const v = Math.random();
  const theta = 2 * Math.PI * u;
  const phi = Math.acos(2 * v - 1);
  return {
    x: Math.sin(phi) * Math.cos(theta),
    y: Math.sin(phi) * Math.sin(theta),
    z: Math.cos(phi)
  };
};

const hslToRgb = (h: number, s: number, l: number): Rgb => {
  const hue2rgb = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  if (s === 0) {
    const gray = Math.round(l * 255);
    return { r: gray, g: gray, b: gray };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, h + 1 / 3);
  const g = hue2rgb(p, q, h);
  const b = hue2rgb(p, q, h - 1 / 3);
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
};

const randomColor = (): Rgb => {
  const h = Math.random();
  const s = randRange(0.6, 0.92);
  const l = randRange(0.52, 0.7);
  return hslToRgb(h, s, l);
};

const shadeColor = (color: Rgb, intensity: number): Rgb => ({
  r: clamp(Math.round(color.r * intensity), 0, 255),
  g: clamp(Math.round(color.g * intensity), 0, 255),
  b: clamp(Math.round(color.b * intensity), 0, 255)
});

class Motion3DCaptcha {
  private width: number;
  private height: number;
  private fps: number;
  private totalFrames: number;
  private objectCount: number;
  private noise2D: ReturnType<typeof createNoise2D>;
  private noise3D: ReturnType<typeof createNoise3D>;
  private camera: { fx: number; fy: number; cx: number; cy: number };
  private keyLight: Vec3;
  private fillLight: Vec3;
  private ambient = 0.32;
  private keyStrength = 0.9;
  private fillStrength = 0.45;

  constructor(width = 432, height = 180, durationSec = 3, objectCount = 20) {
    this.width = width;
    this.height = height;
    this.fps = 30;
    this.totalFrames = Math.max(1, Math.round(durationSec * this.fps));
    this.objectCount = clamp(Math.round(objectCount), 8, 20);
    this.noise2D = createNoise2D();
    this.noise3D = createNoise3D();
    this.camera = {
      fx: width,
      fy: width,
      cx: width / 2,
      cy: height / 2
    };
    this.keyLight = normalize({ x: -0.25, y: 0.35, z: 1 });
    this.fillLight = normalize({ x: 0.6, y: -0.15, z: 0.7 });
  }

  async generate(): Promise<{
    videoBuffer: Buffer;
    hitbox: Hitbox;
    debug: { targetId: number; staticCount: number; movingCount: number; objectCount: number; hitbox: Hitbox };
  }> {
    const { objects, targetId, movingCount, staticCount } = this.createScene();
    const hitbox = this.computeTargetHitbox(objects, targetId);
    const videoStream = new PassThrough();

    const ffmpegProcess = ffmpeg(videoStream)
      .inputFormat('rawvideo')
      .inputOptions([
        '-pix_fmt bgra',
        `-s ${this.width}x${this.height}`,
        `-r ${this.fps}`
      ])
      .videoCodec('libvpx-vp9')
      .outputOptions([
        '-pix_fmt yuva420p',
        '-auto-alt-ref 0',
        '-metadata:s:v:0 alpha_mode=1',
        '-lossless 1'
      ])
      .toFormat('webm');

    const bufferStream = ffmpegProcess.pipe(new PassThrough());
    const mask = new cv.Mat(this.height, this.width, cv.CV_8UC1, 0);

    for (let t = 0; t < this.totalFrames; t += 1) {
      const time = t / this.fps;
      const frame = new cv.Mat(this.height, this.width, cv.CV_8UC4, [0, 0, 0, 0]);
      this.renderFrame(frame, mask, objects, time);
      videoStream.write(Buffer.from(frame.getData()));
    }

    videoStream.end();

    return {
      videoBuffer: await this.streamToBuffer(bufferStream),
      hitbox,
      debug: {
        targetId,
        staticCount,
        movingCount,
        objectCount: objects.length,
        hitbox
      }
    };
  }

  validate(userClick: { x: number; y: number }, hitbox: Hitbox): boolean {
    const { x, y } = userClick;
    return (
      x >= hitbox.x &&
      x <= hitbox.x + hitbox.width &&
      y >= hitbox.y &&
      y <= hitbox.y + hitbox.height
    );
  }

  private createScene(): SceneInfo {
    const movingCount = Math.floor(this.objectCount / 2);
    const staticCount = this.objectCount - movingCount;
    const motionFlags = shuffle([
      ...Array(movingCount).fill(true),
      ...Array(staticCount).fill(false)
    ]);
    const positions = this.createGridPositions(this.objectCount);

    const objects = positions.map((position, index) => {
      const isMoving = motionFlags[index];
      const seed = randRange(0, 1000);
      return {
        id: index,
        isMoving,
        isTarget: false,
        basePosition: position,
        moveAmplitude: isMoving
          ? { x: randRange(1.6, 3.0), y: randRange(1.0, 2.2), z: randRange(0.5, 1.3) }
          : { x: 0, y: 0, z: 0 },
        moveSpeed: isMoving ? randRange(0.7, 1.4) : 0,
        rotationAxis: randomUnitVector(),
        rotationSpeed: isMoving ? randRange(0.7, 1.4) : randRange(0.15, 0.45),
        scaleBase: randRange(0.75, 1.1),
        scaleAmp: isMoving ? randRange(0.08, 0.18) : randRange(0.04, 0.1),
        scaleSpeed: isMoving ? randRange(0.6, 1.2) : randRange(0.25, 0.6),
        morphAmp: isMoving ? randRange(0.08, 0.2) : randRange(0.03, 0.1),
        morphSpeed: isMoving ? randRange(0.9, 1.7) : randRange(0.35, 0.8),
        color: randomColor(),
        seed
      };
    });

    const staticIndices = objects.filter(obj => !obj.isMoving).map(obj => obj.id);
    const targetId = staticIndices[Math.floor(Math.random() * staticIndices.length)];
    const target = objects[targetId];
    target.isTarget = true;
    target.rotationSpeed *= 2.6;
    target.scaleBase *= 1.05;
    target.scaleAmp *= 2.2;
    target.scaleSpeed *= 1.8;
    target.morphAmp *= 1.9;
    target.morphSpeed *= 2.2;

    return { objects, targetId, movingCount, staticCount };
  }

  private createGridPositions(count: number): Vec3[] {
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const baseZ = 16;
    const margin = 6;
    const packX = 0.78;
    const packY = 0.82;
    const maxX = ((this.width / 2) - margin) * (baseZ / this.camera.fx) * packX;
    const maxY = ((this.height / 2) - margin) * (baseZ / this.camera.fy) * packY;
    const spacingX = cols > 1 ? (maxX * 2) / (cols - 1) : 0;
    const spacingY = rows > 1 ? (maxY * 2) / (rows - 1) : 0;
    const jitterX = spacingX * 0.12;
    const jitterY = spacingY * 0.12;
    const positions: Vec3[] = [];

    for (let i = 0; i < count; i += 1) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      positions.push({
        x: -maxX + col * spacingX + randRange(-jitterX, jitterX),
        y: -maxY + row * spacingY + randRange(-jitterY, jitterY),
        z: baseZ + randRange(-0.8, 0.8)
      });
    }

    return positions;
  }

  private computeTargetHitbox(objects: SceneObject[], targetId: number): Hitbox {
    const samples = Math.min(12, this.totalFrames);
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const padding = 10;

    for (let i = 0; i < samples; i += 1) {
      const time = (i / Math.max(samples - 1, 1)) * (this.totalFrames / this.fps);
      const vertices = this.buildObjectVertices(objects[targetId], time);
      for (const vertex of vertices) {
        const projected = this.projectPoint(vertex);
        if (!projected) continue;
        minX = Math.min(minX, projected.x);
        minY = Math.min(minY, projected.y);
        maxX = Math.max(maxX, projected.x);
        maxY = Math.max(maxY, projected.y);
      }
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
      minX = this.width * 0.4;
      maxX = this.width * 0.6;
      minY = this.height * 0.4;
      maxY = this.height * 0.6;
    }

    minX = clamp(minX - padding, 0, this.width - 1);
    minY = clamp(minY - padding, 0, this.height - 1);
    maxX = clamp(maxX + padding, 0, this.width - 1);
    maxY = clamp(maxY + padding, 0, this.height - 1);

    return {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY)
    };
  }

  private buildObjectVertices(obj: SceneObject, time: number): Vec3[] {
    const baseScale = obj.scaleBase + this.noise2D(obj.seed, time * obj.scaleSpeed) * obj.scaleAmp;
    const pulse = obj.isTarget ? 1 + Math.sin(time * 6) * 0.12 : 1;
    const scale = baseScale * pulse;
    const angle = obj.rotationSpeed * time + this.noise2D(obj.seed + 11, time * 0.5) * 0.6;
    const rotation = rotationMatrixFromAxisAngle(obj.rotationAxis, angle);
    const movePhase = time * obj.moveSpeed;
    const moveOffset = obj.isMoving
      ? {
          x: this.noise2D(obj.seed + 21, movePhase) * obj.moveAmplitude.x,
          y: this.noise2D(obj.seed + 31, movePhase) * obj.moveAmplitude.y,
          z: this.noise2D(obj.seed + 41, movePhase) * obj.moveAmplitude.z
        }
      : { x: 0, y: 0, z: 0 };
    const position = add(obj.basePosition, moveOffset);

    return CUBE_VERTICES.map((v, idx) => {
      const morphTime = time * obj.morphSpeed;
      const offsetX = this.noise3D(obj.seed + idx * 3, morphTime, obj.id) * obj.morphAmp;
      const offsetY = this.noise3D(obj.seed + idx * 3 + 1, morphTime, obj.id) * obj.morphAmp;
      const offsetZ = this.noise3D(obj.seed + idx * 3 + 2, morphTime, obj.id) * obj.morphAmp;
      const local = {
        x: (v.x + offsetX) * scale,
        y: (v.y + offsetY) * scale,
        z: (v.z + offsetZ) * scale
      };
      return add(applyMatrix(rotation, local), position);
    });
  }

  private projectPoint(point: Vec3): { x: number; y: number; z: number } | null {
    if (point.z <= 0.1) return null;
    return {
      x: (point.x * this.camera.fx) / point.z + this.camera.cx,
      y: (point.y * this.camera.fy) / point.z + this.camera.cy,
      z: point.z
    };
  }

  private renderFrame(frame: cv.Mat, mask: cv.Mat, objects: SceneObject[], time: number): void {
    const facesToDraw: FaceRender[] = [];

    for (const obj of objects) {
      const worldVertices = this.buildObjectVertices(obj, time);
      for (const face of CUBE_FACES) {
        const v0 = worldVertices[face[0]];
        const v1 = worldVertices[face[1]];
        const v2 = worldVertices[face[2]];
        const normal = normalize(cross(sub(v1, v0), sub(v2, v0)));
        const center = scaleVec(
          add(add(worldVertices[face[0]], worldVertices[face[1]]), add(worldVertices[face[2]], worldVertices[face[3]])),
          0.25
        );
        const viewDir = normalize(scaleVec(center, -1));
        if (dot(normal, viewDir) <= 0) continue;

        const key = Math.max(0, dot(normal, this.keyLight));
        const fill = Math.max(0, dot(normal, this.fillLight));
        const intensity = clamp(this.ambient + this.keyStrength * key + this.fillStrength * fill, 0.1, 1.35);
        const color = shadeColor(obj.color, intensity);

        const projected = face.map(idx => this.projectPoint(worldVertices[idx]));
        if (projected.some(point => point === null)) continue;

        const points = projected.map(point => new cv.Point2(point!.x, point!.y));
        const depth = (v0.z + v1.z + v2.z + worldVertices[face[3]].z) / 4;
        facesToDraw.push({ points, depth, color });
      }
    }

    facesToDraw.sort((a, b) => b.depth - a.depth);

    for (const face of facesToDraw) {
      mask.setTo(0);
      mask.drawFillConvexPoly(face.points, new cv.Vec3(255, 255, 255));
      frame.setTo(new cv.Vec4(face.color.b, face.color.g, face.color.r, 255), mask);
    }
  }

  private streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }
}

export default Motion3DCaptcha;
