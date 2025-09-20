const Busboy = require('busboy');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { promisify } = require('util');

const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);
const unlinkAsync = promisify(fs.unlink);

const ffmpegPath = require('ffmpeg-static');
if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
} else {
    console.error('ffmpeg-static could not find FFmpeg binary.');
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: 'Method Not Allowed'
        };
    }

    const contentType = event.headers['content-type'];
    if (!contentType || !contentType.includes('multipart/form-data')) {
        return {
            statusCode: 400,
            body: 'Bad Request: Content-Type must be multipart/form-data'
        };
    }

    const busboy = new Busboy({
        headers: {
            'content-type': contentType
        }
    });

    let videoFileBuffer = null;
    let startTime = null;
    let duration = null;

    const filePromise = new Promise((resolve, reject) => {
        busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
            if (fieldname === 'video') {
                const chunks = [];
                file.on('data', (chunk) => {
                    chunks.push(chunk);
                });
                file.on('end', () => {
                    videoFileBuffer = Buffer.concat(chunks);
                });
                file.on('error', (err) => reject(err));
            }
        });

        busboy.on('field', (fieldname, val) => {
            if (fieldname === 'startTime') {
                startTime = parseFloat(val);
            }
            if (fieldname === 'duration') {
                duration = parseFloat(val);
            }
        });

        busboy.on('finish', () => {
            resolve();
        });

        busboy.on('error', (err) => reject(err));

        try {
            busboy.end(Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'binary'));
        } catch (e) {
            reject(e);
        }
    });

    try {
        await filePromise;

        if (!videoFileBuffer || startTime === null || duration === null) {
            return {
                statusCode: 400,
                body: 'Missing video file or time parameters.'
            };
        }

        const inputFilePath = path.join(os.tmpdir(), 'input.mp4');
        const outputFilePath = path.join(os.tmpdir(), 'output.gif');

        await writeFileAsync(inputFilePath, videoFileBuffer);

        await new Promise((resolve, reject) => {
            ffmpeg(inputFilePath)
                .seekInput(startTime)
                .duration(duration)
                .outputOptions([
                    '-vf', 'fps=10,scale=320:-1:flags=lanczos'
                ])
                .on('end', () => {
                    resolve();
                })
                .on('error', (err) => {
                    console.error('FFmpeg Error:', err.message);
                    reject(new Error('Failed to process video with FFmpeg.'));
                })
                .save(outputFilePath);
        });

        const gifBuffer = await readFileAsync(outputFilePath);

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'image/gif'
            },
            body: gifBuffer.toString('base64'),
            isBase64Encoded: true,
        };

    } catch (error) {
        console.error('Processing Error:', error);
        return {
            statusCode: 500,
            body: `Internal Server Error: ${error.message}`
        };
    } finally {
        if (fs.existsSync(inputFilePath)) await unlinkAsync(inputFilePath).catch(e => console.error("Error unlinking input file:", e));
        if (fs.existsSync(outputFilePath)) await unlinkAsync(outputFilePath).catch(e => console.error("Error unlinking output file:", e));
    }
};
