'use strict';

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const Busboy = require('busboy');
const path = require('path');
const fsSync = require('fs'); // usado para operações sincrônicas finais (leitura/remover)
ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Handler para receber multipart/form-data (vídeo) e retornar GIF base64.
 * - Aceita campos: start OR startTime OR inicio, end OR fim, duration OR dur
 * - Opcional: optimize=true para usar paleta (maior qualidade, duas passagens)
 * - Retorna body como base64 (isBase64Encoded: true)
 */
exports.handler = async (event) => {
  console.log('>>>> Iniciando função de conversão (handler) <<<<');
  console.log('method:', event.httpMethod, 'isBase64Encoded:', !!event.isBase64Encoded);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  return new Promise((resolve) => {
    // Normalizar headers (busboy espera algo com content-type)
    const rawHeaders = event.headers || {};
    const headers = {};
    Object.keys(rawHeaders).forEach(k => {
      headers[k.toLowerCase()] = rawHeaders[k];
    });
    console.log('DEBUG headers keys:', Object.keys(headers));

    if (!headers['content-type']) {
      console.error('ERRO: header Content-Type ausente. Esperado multipart/form-data.');
      return resolve({
        statusCode: 400,
        body: JSON.stringify({ error: 'Content-Type header faltando. Envie multipart/form-data.' }),
      });
    }

    // Criando Busboy
    let busboy;
    try {
      busboy = new Busboy({ headers });
    } catch (err) {
      console.error('Erro criando Busboy:', err && err.message);
      return resolve({ statusCode: 500, body: `Erro interno: ${err.message}` });
    }

    const fields = {};
    const uploads = []; // { tmpPath, filename, mimetype }
    const writePromises = [];

    busboy.on('field', (name, val) => {
      fields[name] = val;
    });

    busboy.on('file', (fieldname, fileStream, filename, encoding, mimetype) => {
      console.log(`Recebendo arquivo [${fieldname}]: ${filename} (${mimetype})`);
      const safeFilename = path.basename(filename || 'upload'); // prevenir path traversal
      const tmpPath = path.join('/tmp', `${Date.now()}_${Math.random().toString(36).slice(2)}_${safeFilename}`);

      const writeStream = fsSync.createWriteStream(tmpPath);
      fileStream.pipe(writeStream);

      // Promessa para esperar escrita terminar
      const p = new Promise((res, rej) => {
        writeStream.on('finish', () => {
          console.log('Upload gravado em', tmpPath);
          uploads.push({ tmpPath, filename: safeFilename, mimetype });
          res();
        });
        writeStream.on('error', (err) => {
          console.error('Erro ao gravar arquivo:', err && err.message);
          rej(err);
        });
        fileStream.on('error', (err) => {
          console.error('Erro no stream do arquivo:', err && err.message);
          rej(err);
        });
      });

      writePromises.push(p);
    });

    busboy.on('error', (err) => {
      console.error('Busboy error:', err && err.message);
      return resolve({ statusCode: 500, body: `Erro ao processar upload: ${err.message}` });
    });

    busboy.on('finish', async () => {
      console.log('Busboy finished. Fields:', fields);

      try {
        // Aguarda arquivos gravarem completamente
        await Promise.all(writePromises);
      } catch (err) {
        console.error('Erro ao salvar uploads:', err && err.message);
        // tentar limpar arquivos parcialmente gravados
        cleanupFiles(uploads.map(u => u.tmpPath));
        return resolve({ statusCode: 500, body: `Erro ao salvar upload: ${err.message}` });
      }

      if (uploads.length === 0) {
        console.warn('Nenhum arquivo foi enviado');
        return resolve({ statusCode: 400, body: JSON.stringify({ error: 'Nenhum arquivo enviado' }) });
      }

      // Pegar primeiro arquivo (suporta 1 upload)
      const input = uploads[0].tmpPath;
      const jobId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const output = path.join('/tmp', `${jobId}_out.gif`);
      const palette = path.join('/tmp', `${jobId}_palette.png`);

      // Validar/normalizar start & duration / end
      const rawStart = fields.start ?? fields.startTime ?? fields.inicio ?? fields.inicioTime;
      const rawDuration = fields.duration ?? fields.dur;
      const rawEnd = fields.end ?? fields.fim;

      let start = parseFloat(rawStart);
      if (!isFinite(start) || start < 0) start = 0;

      let duration = parseFloat(rawDuration);
      const end = parseFloat(rawEnd);
      if (!isFinite(duration)) {
        if (isFinite(end)) {
          duration = Math.max(0, end - start);
        } else {
          duration = 5; // default 5s
        }
      }
      // limitar duração entre 0.1 e 60s (ajuste conforme sua necessidade)
      duration = Math.min(Math.max(duration, 0.1), 60);

      const fps = parseInt(fields.fps || '10', 10) || 10;
      const width = parseInt(fields.width || '320', 10) || 320;
      const optimize = (fields.optimize === 'true' || fields.palette === 'true');

      console.log(`Processamento: start=${start}s duration=${duration}s fps=${fps} width=${width} optimize=${optimize}`);

      // Função auxiliar de limpeza (sincrona para garantir)
      function cleanupFiles(paths = []) {
        for (const p of paths) {
          try { if (fsSync.existsSync(p)) fsSync.unlinkSync(p); } catch (e) { /* ignore */ }
        }
      }

      // Execute ffmpeg (com ou sem paleta)
      try {
        if (optimize) {
          // 1) gerar paleta
          await new Promise((res, rej) => {
            ffmpeg(input)
              .setStartTime(start)
              .setDuration(duration)
              .outputOptions([`-vf`, `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen`])
              .on('start', cmd => console.log('FFmpeg palette start:', cmd))
              .on('stderr', line => console.log('[ffmpeg palette stderr]', line))
              .on('error', (err) => {
                console.error('FFmpeg palette error:', err && err.message);
                rej(err);
              })
              .on('end', () => {
                console.log('Palette gerada:', palette);
                res();
              })
              .save(palette);
          });

          // 2) aplicar paleta
          await new Promise((res, rej) => {
            // input + palette as second input
            ffmpeg()
              .input(input)
              .input(palette)
              .setStartTime(start)
              .setDuration(duration)
              // usamos lavfi para compor corretamente com palette
              .outputOptions(['-lavfi', `fps=${fps},scale=${width}:-1:flags=lanczos [x]; [x][1:v] paletteuse`, '-f', 'gif'])
              .on('start', cmd => console.log('FFmpeg apply palette start:', cmd))
              .on('stderr', line => console.log('[ffmpeg apply stderr]', line))
              .on('error', (err) => {
                console.error('FFmpeg apply error:', err && err.message);
                rej(err);
              })
              .on('end', () => {
                console.log('GIF criado com paleta em', output);
                res();
              })
              .save(output);
          });

        } else {
          // Simples (1-pass)
          await new Promise((res, rej) => {
            ffmpeg(input)
              .setStartTime(start)
              .setDuration(duration)
              .outputOptions([`-vf`, `fps=${fps},scale=${width}:-1:flags=lanczos`, '-f', 'gif'])
              .on('start', cmd => console.log('FFmpeg start:', cmd))
              .on('stderr', line => console.log('[ffmpeg stderr]', line))
              .on('error', (err) => {
                console.error('FFmpeg error:', err && err.message);
                rej(err);
              })
              .on('end', () => {
                console.log('GIF criado em', output);
                res();
              })
              .save(output);
          });
        }

        // Ler GIF e enviar base64
        const gifBuffer = fsSync.readFileSync(output);

        // limpeza final
        const toRemove = [input, output, palette];
        cleanupFiles(toRemove);

        return resolve({
          statusCode: 200,
          headers: { 'Content-Type': 'image/gif' },
          body: gifBuffer.toString('base64'),
          isBase64Encoded: true,
        });

      } catch (err) {
        console.error('Erro no processamento FFmpeg:', err && (err.message || err));
        // limpar arquivos temporários
        cleanupFiles([input, output, palette]);
        return resolve({
          statusCode: 500,
          body: JSON.stringify({ error: 'Erro durante conversão', message: err && err.message ? err.message : String(err) }),
        });
      }
    });

    // Decodificar corretamente o body e enviar para Busboy
    try {
      const bodyBuffer = event.isBase64Encoded
        ? Buffer.from(event.body || '', 'base64')
        : Buffer.from(event.body || '', 'utf8');

      busboy.end(bodyBuffer);
    } catch (err) {
      console.error('Erro ao decodificar body:', err && err.message);
      return resolve({ statusCode: 400, body: JSON.stringify({ error: 'Corpo inválido' }) });
    }
  });
};
