const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const Busboy = require('busboy');
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
    let uploadPath;
    let gifPath;

    busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
      console.log(`Recebendo arquivo: ${filename} (${mimetype})`);

      // caminho temporário de entrada e saída
      uploadPath = path.join('/tmp', `${Date.now()}_${filename}`);
      gifPath = path.join('/tmp', `${Date.now()}_output.gif`);

      const writeStream = fs.createWriteStream(uploadPath);
      file.pipe(writeStream);

      writeStream.on('error', (err) => {
        console.error('Erro ao gravar arquivo temporário:', err.message);
        reject({ statusCode: 500, body: `Erro ao gravar o vídeo: ${err.message}` });
      });
    });

    busboy.on('field', (fieldname, val) => {
      fields[fieldname] = val;
    });

    busboy.on('finish', () => {
      if (!uploadPath || !fs.existsSync(uploadPath)) {
        return resolve({
          statusCode: 400,
          body: JSON.stringify({ error: 'Nenhum arquivo de vídeo recebido.' }),
        });
      }

      const { startTime, duration } = fields;
      console.log(`Iniciando conversão: start=${startTime}, duração=${duration}`);

      try {
        ffmpeg(uploadPath)
          .setStartTime(parseFloat(startTime))
          .setDuration(parseFloat(duration))
          .outputOptions([
            '-vf', 'fps=10,scale=320:-1:flags=lanczos',
            '-f', 'gif'
          ])
          .on('end', () => {
            console.log('Conversão concluída.');

            try {
              const gifBuffer = fs.readFileSync(gifPath);

              // limpeza de arquivos temporários
              fs.unlinkSync(uploadPath);
              fs.unlinkSync(gifPath);

              resolve({
                statusCode: 200,
                headers: { 'Content-Type': 'image/gif' },
                body: gifBuffer.toString('base64'),
                isBase64Encoded: true,
              });
            } catch (e) {
              console.error('Erro ao ler/limpar o GIF:', e.message);
              reject({ statusCode: 500, body: `Erro ao ler o GIF: ${e.message}` });
            }
          })
          .on('error', (err) => {
            console.error('Erro no FFmpeg:', err.message);
            if (fs.existsSync(uploadPath)) fs.unlinkSync(uploadPath);
            if (fs.existsSync(gifPath)) fs.unlinkSync(gifPath);
            reject({ statusCode: 500, body: `Erro durante a conversão: ${err.message}` });
          })
          .save(gifPath);
      } catch (e) {
        console.error('Erro ao iniciar o FFmpeg:', e.message);
        reject({ statusCode: 500, body: `Erro ao iniciar o processamento: ${e.message}` });
      }
    });

    // 🔑 Decodificação correta do body
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : event.body;

    busboy.end(body);
  });
};
