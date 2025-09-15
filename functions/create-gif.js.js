const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const Busboy = require('busboy');
const { Writable } = require('stream');
const path = require('path');
const os = require('os');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const busboy = new Busboy({ headers: event.headers });
  let videoBuffer = Buffer.from('');
  let fields = {};

  busboy.on('file', (fieldname, file, filename) => {
    file.on('data', (data) => {
      videoBuffer = Buffer.concat([videoBuffer, data]);
    });
  });

  busboy.on('field', (fieldname, val) => {
    fields[fieldname] = val;
  });

  await new Promise(resolve => busboy.on('finish', resolve));

  const { startTime, duration } = fields;
  
  if (!videoBuffer || videoBuffer.length === 0) {
    return { statusCode: 400, body: 'Nenhum arquivo de vídeo recebido.' };
  }

  const tempDir = os.tmpdir();
  const inputPath = path.join(tempDir, 'input.mp4');
  const outputPath = path.join(tempDir, 'output.gif');

  try {
    fs.writeFileSync(inputPath, videoBuffer);
    
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(parseFloat(startTime))
        .setDuration(parseFloat(duration))
        .outputOptions([
          '-vf', 'fps=10,scale=320:-1:flags=lanczos',
          '-c:v', 'gif',
          '-q:v', '2'
        ])
        .on('end', () => {
          resolve();
        })
        .on('error', (err) => {
          reject(err);
        })
        .save(outputPath);
    });

    const gifBuffer = fs.readFileSync(outputPath);
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'image/gif' },
      body: gifBuffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (e) {
    return { statusCode: 500, body: `Erro durante a conversão: ${e.message}` };
  }
};
