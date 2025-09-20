const Busboy = require('busboy');
const ffmpeg = require('fluent-ffmpeg');
const { createReadStream, createWriteStream } = require('fs');
const { promisify } = require('util');
const { pipeline } = require('stream');
const path = require('path');
const os = require('os');
const fs = require('fs');

const pipelineAsync = promisify(pipeline);

// Local do binário do FFmpeg (necessário para o Netlify)
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);

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

    let videoFileBuffer;
    let startTime;
    let duration;

    // Processa os campos do formulário
    const fieldsPromise = new Promise((resolve) => {
        busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
            if (fieldname === 'video') {
                const chunks = [];
                file.on('data', (chunk) => {
                    chunks.push(chunk);
                });
                file.on('end', () => {
                    videoFileBuffer = Buffer.concat(chunks);
                });
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

        busboy.end(Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'binary'));
    });

    await fieldsPromise;

    if (!videoFileBuffer || !startTime || !duration) {
        return {
            statusCode: 400,
            body: 'Missing video file or time parameters.'
        };
    }

    const tempDir = os.tmpdir();
    const inputFilePath = path.join(tempDir, 'input.mp4');
    const outputFilePath = path.join(tempDir, 'output.gif');

    try {
        // Salva o buffer do vídeo em um arquivo temporário
        await promisify(fs.writeFile)(inputFilePath, videoFileBuffer);

        // Promessa para processar o vídeo com FFmpeg
        await new Promise((resolve, reject) => {
            ffmpeg(inputFilePath)
                .seekInput(startTime)
                .duration(duration)
                .outputOptions([
                    '-vf', 'fps=10,scale=320:-1:flags=lanczos' // Filtros para otimizar o GIF
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

        // Lê o GIF gerado e o retorna como base64
        const gifBuffer = await promisify(fs.readFile)(outputFilePath);

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
        // Limpa os arquivos temporários
        if (fs.existsSync(inputFilePath)) fs.unlinkSync(inputFilePath);
        if (fs.existsSync(outputFilePath)) fs.unlinkSync(outputFilePath);
    }
};
