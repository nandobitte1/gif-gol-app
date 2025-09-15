const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const Busboy = require('busboy');
const path = require('path');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);

exports.handler = async (event) => {
  console.log(">>> Função chamada");
  console.log("Método:", event.httpMethod, "isBase64Encoded:", event.isBase64Encoded);
  console.log("Headers:", event.headers);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  return new Promise((resolve) => {
    const busboy = new Busboy({ headers: event.headers });
    const fields = {};
    let uploadPath, gifPath;

    busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
      console.log("Recebendo arquivo:", filename, "mimetype:", mimetype);

      uploadPath = path.join('/tmp', `${Date.now()}_${filename}`);
      gifPath = path.join('/tmp', `${Date.now()}_out.gif`);

      const writeStream = fs.createWriteStream(uploadPath);
      file.pipe(writeStream);

      writeStream.on('finish', () => {
        console.log("Arquivo salvo em:", uploadPath);
        console.log("Campos recebidos:", fields);

        const start = parseFloat(fields.startTime) || 0;
        const duration = parseFloat(fields.duration) || 5;
        console.log(`Iniciando ffmpeg com start=${start}, duration=${duration}`);

        ffmpeg(uploadPath)
          .setStartTime(start)
          .setDuration(duration)
          .outputOptions(['-vf', 'fps=10,scale=320:-1:flags=lanczos', '-f', 'gif'])
          .on('start', (cmd) => console.log("FFmpeg iniciado:", cmd))
          .on('stderr', (line) => console.log("FFmpeg STDERR:", line))
          .on('end', () => {
            console.log("FFmpeg terminou OK, lendo GIF...");

            try {
              const gifBuffer = fs.readFileSync(gifPath);
              fs.unlinkSync(uploadPath);
              fs.unlinkSync(gifPath);

              resolve({
                statusCode: 200,
                headers: { 'Content-Type': 'image/gif' },
                body: gifBuffer.toString('base64'),
                isBase64Encoded: true
              });
            } catch (err) {
              console.error("Erro ao ler GIF:", err);
              resolve({ statusCode: 500, body: "Erro ao ler GIF: " + err.message });
            }
          })
          .on('error', (err) => {
            console.error("Erro no FFmpeg:", err);
            resolve({ statusCode: 500, body: "Erro FFmpeg: " + err.message });
          })
          .save(gifPath);
      });

      writeStream.on('error', (err) => {
        console.error("Erro ao salvar arquivo temporário:", err);
        resolve({ statusCode: 500, body: "Erro ao salvar arquivo: " + err.message });
      });
    });

    busboy.on('field', (name, val) => {
      fields[name] = val;
    });

    busboy.on('error', (err) => {
      console.error("Erro no Busboy:", err);
      resolve({ statusCode: 500, body: "Erro no Busboy: " + err.message });
    });

    const body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body, 'utf8');

    console.log("Tamanho do body recebido:", body.length);
    busboy.end(body);
  });
};
