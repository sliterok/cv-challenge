const cv = require('opencv4nodejs');
const ffmpeg = require('fluent-ffmpeg');
const { PassThrough } = require('stream');
const { createNoise2D } = require('simplex-noise');

class Motion3DCaptcha {
    constructor(width = 400, height = 300, durationSec = 3) {
        this.width = width;
        this.height = height;
        this.fps = 30;
        this.totalFrames = durationSec * this.fps;
        this.noise2D = createNoise2D();
        
        // Define 3D Geometry (Cubes)
        this.cubeVertices = [
            new cv.Point3(-1, -1,  1), new cv.Point3(1, -1,  1),
            new cv.Point3(1,  1,  1), new cv.Point3(-1,  1,  1),
            new cv.Point3(-1, -1, -1), new cv.Point3(1, -1, -1),
            new cv.Point3(1,  1, -1), new cv.Point3(-1,  1, -1)
        ];
        
        // Camera setup
        const focalLength = width;
        this.cameraMatrix = new cv.Mat([
            [focalLength, 0, width / 2],
            [0, focalLength, height / 2],
            [0, 0, 1]
        ], cv.CV_64F);
        this.distCoeffs = new cv.Mat([0, 0, 0, 0], cv.CV_64F);
    }

    /**
     * Generates the captcha video and the validation data
     */
    async generate() {
        const targetIndex = Math.floor(Math.random() * 4); // 4 objects total
        const solutionLog = [];
        const videoStream = new PassThrough();
        
        // Initialize FFmpeg Command
        const ffmpegProcess = ffmpeg(videoStream)
            .inputFormat('rawvideo')
            .inputOptions([
                '-pix_fmt bgra',
                `-s ${this.width}x${this.height}`,
                `-r ${this.fps}`
            ])
            .videoCodec('libvpx-vp9')
            .outputOptions([
                '-pix_fmt yuva420p',    // Enables transparency
                '-auto-alt-ref 0',      // Required for alpha in some players
                '-lossless 1'
            ])
            .toFormat('webm');

        // Start the render loop
        const bufferStream = ffmpegProcess.pipe();

        for (let t = 0; t < this.totalFrames; t++) {
            const frame = new cv.Mat(this.height, this.width, cv.CV_8UC4, [0, 0, 0, 0]);
            const time = t / this.fps;

            for (let i = 0; i < 4; i++) {
                const isTarget = (i === targetIndex);
                
                // Use noise for smooth transformations
                // Target has higher frequency noise (jittery/different)
                const freq = isTarget ? 3.0 : 0.5;
                const seed = i * 100;

                const rvec = new cv.Vec3(
                    this.noise2D(seed, time * freq),
                    this.noise2D(seed + 1, time * freq),
                    this.noise2D(seed + 2, time * freq)
                );

                const tvec = new cv.Vec3(
                    (i - 1.5) * 4 + this.noise2D(seed + 3, time), 
                    this.noise2D(seed + 4, time), 
                    15 // Depth
                );

                const scale = 1.0 + this.noise2D(seed + 5, time * freq) * 0.5;
                const vertices = this.cubeVertices.map(v => v.mul(scale));

                // Project 3D to 2D
                const projected = cv.projectPoints(vertices, rvec, tvec, this.cameraMatrix, this.distCoeffs);
                
                // Draw 2D Polygon (simplified face rendering)
                const color = isTarget ? [200, 100, 255, 255] : [200, 200, 200, 255];
                const points = projected.map(p => new cv.Point2(p.x, p.y));
                
                frame.drawFillConvexPoly(points, new cv.Vec4(...color));

                // Store center point for validation
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

    /**
     * Efficiency Check: Validates a click coordinate at a specific timestamp
     */
    validate(userClick, solutionLog) {
        const { x, y, t } = userClick;
        const tolerancePx = 30; // Radius of correctness
        
        // Find the frame closest to the user's click timestamp
        const frameData = solutionLog.reduce((prev, curr) => 
            Math.abs(curr.t - t) < Math.abs(prev.t - t) ? curr : prev
        );

        const dist = Math.sqrt(Math.pow(frameData.x - x, 2) + Math.pow(frameData.y - y, 2));
        return dist <= tolerancePx;
    }
}

module.exports = Motion3DCaptcha;
