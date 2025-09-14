const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const Busboy = require('busboy');
const path = require('path');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);

exports.handler = async (event) => {
  console.log('--- Função de conversão iniciada ---');
  if (event.httpMethod !== 'POST') {
    console.log('Método HTTP não permitido:', event.httpMethod);
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  return new Promise((resolve, reject) => {
    const busboy = new Busboy({ headers: event.headers });
    const fields = {};
    let videoBuffer = null;

    busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
      console.log(`Recebendo arquivo: ${filename} (${mimetype})`);
      file.on('data', (data) => {
        if (!videoBuffer) {
          videoBuffer = data;
        } else {
          videoBuffer = Buffer.concat([videoBuffer, data]);
        }
      });
    });

    busboy.on('field', (fieldname, val) => {
      fields[fieldname] = val;
    });

    busboy.on('finish', () => {
      console.log('Processamento do formulário concluído.');
      if (!videoBuffer) {
        console.log('Nenhum arquivo de vídeo recebido.');
        return resolve({
          statusCode: 400,
          body: JSON.stringify({ error: 'Nenhum arquivo de vídeo recebido.' }),
        });
      }

      const { startTime, duration } = fields;
      console.log(`Iniciando conversão: tempo de início=${startTime}, duração=${duration}`);

      const tempVideoPath = path.join('/tmp', 'input.mp4');
      const tempGifPath = path.join('/tmp', 'output.gif');

      try {
        fs.writeFileSync(tempVideoPath, videoBuffer);
        console.log(`Vídeo salvo em ${tempVideoPath}`);

        ffmpeg(tempVideoPath)
          .setStartTime(parseFloat(startTime))
          .setDuration(parseFloat(duration))
          .outputOptions([
            '-vf', 'fps=10,scale=320:-1:flags=lanczos',
            '-c:v', 'gif',
            '-q:v', '2',
            '-f', 'gif'
          ])
          .output(tempGifPath)
          .on('end', () => {
            console.log('Conversão do FFmpeg concluída.');
            try {
              const gifBuffer = fs.readFileSync(tempGifPath);
              console.log('GIF lido com sucesso. Enviando resposta...');
              fs.unlinkSync(tempVideoPath);
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
            fs.unlinkSync(tempVideoPath);
            reject({ statusCode: 500, body: `Erro durante a conversão: ${err.message}` });
          })
          .run();
      } catch (e) {
        console.error('Erro ao escrever o arquivo:', e.message);
        reject({ statusCode: 500, body: `Erro ao processar o vídeo: ${e.message}` });
      }
    });

    busboy.end(event.body);
  });
};
// Este é um novo comentário de teste.