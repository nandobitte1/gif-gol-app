const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const Busboy = require('busboy');

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Método Não Permitido" };
  }

  const busboy = new Busboy({ headers: event.headers });
  const fields = {};
  const filePromises = [];

  busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
    const tempFilePath = path.join(os.tmpdir(), filename);
    const writeStream = fs.createWriteStream(tempFilePath);
    file.pipe(writeStream);

    filePromises.push(new Promise((resolve, reject) => {
      writeStream.on('finish', () => resolve(tempFilePath));
      writeStream.on('error', reject);
    }));
  });

  busboy.on('field', (fieldname, val) => {
    fields[fieldname] = val;
  });

  await new Promise(resolve => busboy.on('finish', resolve)).then(() => {
    busboy.end(Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8'));
  });

  try {
    const videoFilePath = await Promise.all(filePromises);
    const startTime = fields.startTime || '0';
    const duration = fields.duration || '5';
    const outputFilePath = path.join(os.tmpdir(), 'output.gif');

    await new Promise((resolve, reject) => {
      const ffmpegCommand = `ffmpeg -ss ${startTime} -i "${videoFilePath[0]}" -t ${duration} -f gif "${outputFilePath}"`;
      
      exec(ffmpegCommand, (error, stdout, stderr) => {
        if (error) {
          console.error(`Erro na execução do FFmpeg: ${error.message}`);
          reject(error);
        }
        console.log(`Saída do FFmpeg: ${stdout}`);
        console.error(`Erros do FFmpeg: ${stderr}`);
        resolve();
      });
    });

    const gifData = fs.readFileSync(outputFilePath);
    
    fs.unlinkSync(videoFilePath[0]);
    fs.unlinkSync(outputFilePath);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "image/gif"
      },
      body: gifData.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (error) {
    console.error("Erro completo:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Erro ao processar o vídeo." }),
    };
  }
};
