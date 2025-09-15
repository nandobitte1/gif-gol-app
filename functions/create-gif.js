const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const Busboy = require('busboy');
const path = require('path');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  return new Promise((resolve, reject) => {
    const busboy = new Busboy({ headers: event.headers });
    let fields = {};
    let uploadPath;
    let gifPath;

    busboy.on('file', (fieldname, file, filename) => {
      uploadPath = path.join('/tmp', `${Date.now()}_${filename}`);
      gifPath = path.join('/tmp', `${Date.now()}_out.gif`);
      const writeStream = fs.createWriteStream(uploadPath);
      file.pipe(writeStream);

      writeStream.on('finish', () => {
        const start = parseFloat(fields.startTime) || 0;
        const dur = parseFloat(fields.duration) || 5;

        ffmpeg(uploadPath)
          .setStartTime(start)
          .setDuration(dur)
          .outputOptions([
            '-vf', 'fps=10,scale=320:-1:flags=lanczos',
            '-f', 'gif'
          ])
          .on('end', () => {
            try {
              const gifBuffer = fs.readFileSync(gifPath);
              fs.unlinkSync(uploadPath);
              fs.unlinkSync(gifPath);

              resolve({
                statusCode: 200,
                headers: { 'Content-Type': 'image/gif' },
                body: gifBuffer.toString('base64'),
                isBase64Encoded: true,
              });
            } catch (err) {
              reject({ statusCode: 500, body: `Erro ao ler GIF: ${err.message}` });
            }
          })
          .on('error', (err) => {
            reject({ statusCode: 500, body: `Erro FFmpeg: ${err.message}` });
          })
          .save(gifPath);
      });
    });

    busboy.on('field', (fieldname, val) => {
      fields[fieldname] = val;
    });

    busboy.on('finish', () => {
      if (!uploadPath) {
        resolve({ statusCode: 400, body: 'Nenhum arquivo recebido' });
      }
    });

    // ✅ Decodificar corretamente o body
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : event.body;

    busboy.end(body);
  });
};
