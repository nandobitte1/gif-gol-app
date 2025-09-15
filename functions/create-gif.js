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

  return new Promise((resolve) => {
    const busboy = new Busboy({ headers: event.headers });
    const fields = {};
    let uploadPath, gifPath;

    busboy.on('file', (fieldname, file, filename) => {
      uploadPath = path.join('/tmp', `${Date.now()}_${filename}`);
      gifPath = path.join('/tmp', `${Date.now()}_out.gif`);

      const writeStream = fs.createWriteStream(uploadPath);
      file.pipe(writeStream);

      writeStream.on('finish', () => {
        const start = parseFloat(fields.startTime) || 0;
        const duration = parseFloat(fields.duration) || 5;

        ffmpeg(uploadPath)
          .setStartTime(start)
          .setDuration(duration)
          .outputOptions([
            '-vf', 'fps=10,scale=320:-1:flags=lanczos',
            '-f', 'gif'
          ])
          .on('end', () => {
            try {
              const gifBuffer = fs.readFileSync(gifPath);

              // limpar arquivos temporários
              fs.unlinkSync(uploadPath);
              fs.unlinkSync(gifPath);

              resolve({
                statusCode: 200,
                headers: {
                  'Content-Type': 'image/gif',
                  'Cache-Control': 'no-cache'
                },
                body: gifBuffer.toString('binary'),
                isBase64Encoded: false
              });
            } catch (err) {
              resolve({
                statusCode: 500,
                body: `Erro ao ler GIF: ${err.message}`
              });
            }
          })
          .on('error', (err) => {
            console.error('FFmpeg error:', err.message);
            resolve({
              statusCode: 500,
              body: `Erro FFmpeg: ${err.message}`
            });
          })
          .save(gifPath);
      });
    });

    busboy.on('field', (name, val) => {
      fields[name] = val;
    });

    busboy.on('error', (err) => {
      console.error('Busboy error:', err.message);
      resolve({ statusCode: 500, body: `Erro upload: ${err.message}` });
    });

    // decodificar corretamente o body
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body, 'utf8');

    busboy.end(body);
  });
};
