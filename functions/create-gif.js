const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const Busboy = require('busboy');
const { Writable } = require('stream');
const path = require('path');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);

exports.handler = async (event) => {
  console.log('--- Função de conversão iniciada (streaming) ---');
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  return new Promise((resolve, reject) => {
    const busboy = new Busboy({ headers: event.headers });
    let fields = {};
    let videoStream;
    let tempGifPath;

    busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
      console.log(`Recebendo arquivo: ${filename} (${mimetype})`);
      videoStream = file;
    });

    busboy.on('field', (fieldname, val) => {
      fields[fieldname] = val;
    });

    busboy.on('finish', () => {
      if (!videoStream) {
        return resolve({
          statusCode: 400,
          body: JSON.stringify({ error: 'Nenhum arquivo de vídeo recebido.' }),
        });
      }

      const { startTime, duration } = fields;
      console.log(`Iniciando conversão: tempo de início=${startTime}, duração=${duration}`);
      
      tempGifPath = path.join('/tmp', 'output.gif');
      
      try {
        const command = ffmpeg(videoStream)
          .inputFormat('mp4')
          .setStartTime(parseFloat(startTime))
          .setDuration(parseFloat(duration))
          .outputOptions([
            '-vf', 'fps=10,scale=320:-1:flags=lanczos',
            '-c:v', 'gif',
            '-q:v', '2',
            '-f', 'gif'
          ])
          .on('end', () => {
            console.log('Conversão do FFmpeg concluída.');
            try {
              const gifBuffer = fs.readFileSync(tempGifPath);
              console.log('GIF lido com sucesso. Enviando resposta...');
              fs.unlinkSync(tempGifPath);
              resolve({
                statusCode: 200,
                headers: { 'Content-Type': 'image/gif' },
                body: gifBuffer.toString('base64'),
                isBase64Encoded: true,
              });
            } catch (e) {
              console.error('Erro ao ler ou limpar o arquivo:', e.message);
              reject({ statusCode: 500, body: `Erro ao ler o GIF: ${e.message}` });
            }
          })
          .on('error', (err) => {
            console.error('Erro no FFmpeg:', err.message);
            if (fs.existsSync(tempGifPath)) {
              fs.unlinkSync(tempGifPath);
            }
            reject({ statusCode: 500, body: `Erro durante a conversão: ${err.message}` });
          })
          .save(tempGifPath);
      } catch (e) {
        console.error('Erro ao iniciar o FFmpeg:', e.message);
        reject({ statusCode: 500, body: `Erro ao iniciar o processamento: ${e.message}` });
      }
    });

    busboy.end(event.body);
  });
};
