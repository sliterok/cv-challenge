const cv = require('opencv4nodejs');
const ffmpeg = require('fluent-ffmpeg');
const { PassThrough } = require('stream');
const { createNoise2D, createNoise3D } = require('simplex-noise');

class Motion3DCaptcha {
    constructor(width = 640, height = 480, durationSec = 3) {
        this.width = width;
        this.height = height;
        this.fps = 30;
        this.totalFrames = durationSec * this.fps;
        this.noise2D = createNoise2D();
        this.noise3D = createNoise3D();
        
        // Define 3D Mesh: A more complex sphere-like blob for better "shape shifting"
        this.baseVertices = [];
        for (let i = 0; i < 8; i++) {
            // A simple cube-based structure that we will morph
            this.baseVertices.push(new cv.Point3(
                (i & 1 ? 1 : -1),
                (i & 2 ? 1 : -1),
                (i & 4 ? 1 : -1)
            ));
        }
        
        // Sane Camera Matrix: Focal length should be roughly equal to width for standard FOV
        const focalLength = width;
        this.cameraMatrix = new cv.Mat([
            [focalLength, 0, width / 2],
            [0, focalLength, height / 2],
            [0, 0, 1]
        ], cv.CV_64F);
        this.distCoeffs = [0, 0, 0, 0, 0];
    }

    async generate() {
        const targetIndex = Math.floor(Math.random() * 3); // 3 objects
        const solutionLog = [];
        const videoStream = new PassThrough();
        
        const ffmpegProcess = ffmpeg(videoStream)
            .inputFormat('rawvideo')
            .inputOptions([
                '-pix_fmt bgra', // OpenCV CV_8UC4 layout
                `-s ${this.width}x${this.height}`,
                `-r ${this.fps}`
            ])
            .videoCodec('libvpx-vp9')
            .outputOptions([
                '-pix_fmt yuva420p',    // YUV + Alpha channel
                '-auto-alt-ref 0',      // Required for alpha transparency in WebM
                '-metadata:s:v:0 alpha_mode=1',
                '-lossless 1'
            ])
            .toFormat('webm');

        const bufferStream = ffmpegProcess.pipe(new PassThrough());

        for (let t = 0; t < this.totalFrames; t++) {
            // Initializing with a slightly visible alpha (e.g., 1) can help debug
            // but [0,0,0,0] is true transparency.
            const frame = new cv.Mat(this.height, this.width, cv.CV_8UC4, [0, 0, 0, 0]);
            const time = t / this.fps;
            const mask = new cv.Mat(this.height, this.width, cv.CV_8UC1, 0);

            for (let i = 0; i < 3; i++) {
                const isTarget = (i === targetIndex);
                const seed = i * 50;
                
                // Movement Logic
                const freqMove = 0.5;
                const tvec = new cv.Vec3(
                    (i - 1) * 8 + (this.noise2D(seed, time * freqMove) * 2), // Spread out X
                    this.noise2D(seed + 1, time * freqMove) * 2,            // Y movement
                    25 // Z Depth (Make sure this is deep enough to be in FOV)
                );

                const rvec = new cv.Vec3(time, time * 0.5, time * 0.3);

                // SHAPE SHIFTING: Apply noise to each vertex individually
                const morphFreq = isTarget ? 4.0 : 1.0; // Target shifts shape faster/differently
                const morphedVertices = this.baseVertices.map((v, idx) => {
                    const offset = this.noise3D(seed + idx, time * morphFreq, i) * 1.5;
                    return new cv.Point3(v.x + offset, v.y + offset, v.z + offset);
                });

                // Project points using corrected API
                const projected = cv.projectPoints(
                    morphedVertices, 
                    rvec, 
                    tvec, 
                    this.cameraMatrix, 
                    this.distCoeffs
                );

                // DRAWING
                // Use bright colors to ensure they aren't "lost" in black
                const color = isTarget ? [255, 100, 100] : [180, 180, 180];
                const points = projected.imagePoints.map(p => new cv.Point2(p.x, p.y));
                if (points.length < 3) {
                    continue;
                }

                // Draw via mask so alpha gets written for the filled region.
                const hullPoints = new cv.Contour(points).convexHull().getPoints();
                mask.setTo(0);
                mask.drawFillConvexPoly(hullPoints, new cv.Vec3(255, 255, 255));
                frame.setTo(new cv.Vec4(color[0], color[1], color[2], 255), mask);

                if (isTarget) {
                    const center = points.reduce((a, b) => ({ x: a.x + b.x, y: a.y + b.y }));
                    solutionLog.push({
                        t: Math.round(time * 1000), 
                        x: center.x / points.length, 
                        y: center.y / points.length
                    });
                }
            }

            videoStream.write(Buffer.from(frame.getData()));
        }

        videoStream.end();

        return {
            videoBuffer: await this._streamToBuffer(bufferStream),
            solution: solutionLog
        };
    }

    _streamToBuffer(stream) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            stream.on('data', chunk => chunks.push(chunk));
            stream.on('error', reject);
            stream.on('end', () => resolve(Buffer.concat(chunks)));
        });
    }

    validate(userClick, solutionLog) {
        const { x, y, t } = userClick;
        // Find nearest recorded frame
        const frameData = solutionLog.reduce((prev, curr) => 
            Math.abs(curr.t - t) < Math.abs(prev.t - t) ? curr : prev
        );
        const dist = Math.sqrt(Math.pow(frameData.x - x, 2) + Math.pow(frameData.y - y, 2));
        return dist <= 40; // 40px radius tolerance
    }
}

module.exports = Motion3DCaptcha;
