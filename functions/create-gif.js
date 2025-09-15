const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const Busboy = require('busboy');
const { Writable } = require('stream');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Readable } = require('stream');

ffmpeg.setFfmpegPath(ffmpegPath);

exports.handler = async (event) => {
    console.log('--- Função de conversão iniciada (streaming) ---');
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    return new Promise((resolve, reject) => {
        const busboy = new Busboy({ headers: event.headers, highWaterMark: 10 * 1024 * 1024 }); // 10MB
        let fields = {};
        let fileWriteStream;
        let tempFilePath;

        busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
            console.log(`Recebendo arquivo: ${filename} (${mimetype})`);
            const fileExtension = path.extname(filename);
            tempFilePath = path.join(os.tmpdir(), `input-${Date.now()}${fileExtension}`);
            fileWriteStream = fs.createWriteStream(tempFilePath);
            file.pipe(fileWriteStream);
        });

        busboy.on('field', (fieldname, val) => {
            fields[fieldname] = val;
        });

        busboy.on('finish', async () => {
            if (!tempFilePath) {
                return resolve({
                    statusCode: 400,
                    body: JSON.stringify({ error: 'Nenhum arquivo de vídeo recebido.' }),
                });
            }

            const { startTime, duration, userId } = fields;
            const newDuration = parseFloat(duration) - parseFloat(startTime);
            const title = fields.title || 'GIF de Gol';

            console.log(`Iniciando conversão: tempo de início=${startTime}, duração=${newDuration}`);

            const tempGifPath = path.join(os.tmpdir(), `output-${Date.now()}.gif`);

            try {
                await new Promise((resolveConvert, rejectConvert) => {
                    ffmpeg(tempFilePath)
                        .setStartTime(parseFloat(startTime))
                        .setDuration(newDuration)
                        .outputOptions([
                            '-vf', 'fps=10,scale=320:-1:flags=lanczos',
                            '-q:v', '2',
                            '-f', 'gif'
                        ])
                        .on('end', () => {
                            console.log('Conversão do FFmpeg concluída.');
                            resolveConvert();
                        })
                        .on('error', (err) => {
                            console.error('Erro no FFmpeg:', err.message);
                            rejectConvert(new Error(`Erro durante a conversão: ${err.message}`));
                        })
                        .save(tempGifPath);
                });

                const gifBuffer = fs.readFileSync(tempGifPath);

                // Salvar o GIF no Firestore
                // const docRef = await db.collection('gifs').add({
                //     title: title,
                //     gifBase64: gifBuffer.toString('base64'),
                //     createdAt: new Date(),
                //     userId: userId
                // });

                // console.log('GIF salvo no Firestore com ID:', docRef.id);

                // Limpar arquivos temporários
                fs.unlinkSync(tempFilePath);
                fs.unlinkSync(tempGifPath);

                resolve({
                    statusCode: 200,
                    body: JSON.stringify({ message: 'GIF criado e salvo com sucesso!' }),
                    headers: { 'Content-Type': 'application/json' },
                });

            } catch (e) {
                console.error('Erro ao processar o arquivo:', e.message);
                
                // Limpar arquivos temporários em caso de erro
                if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                if (fs.existsSync(tempGifPath)) fs.unlinkSync(tempGifPath);
                
                reject({ statusCode: 500, body: `Erro ao processar o vídeo: ${e.message}` });
            }
        });

        const writableStream = new Writable({
            write(chunk, encoding, callback) {
                busboy.write(chunk, encoding, callback);
            }
        });

        Readable.from(event.body).pipe(writableStream);
    });
};
