import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(__dirname, 'public');
const seasonPath = '20252026';
const baseNotesUrl = `https://link.nhl.com/static/gamenotes/public/${seasonPath}/`;
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const sendJson = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });

async function findGameNoteFile({ date, awayTeam, homeTeam }) {
  const dirResp = await fetch(baseNotesUrl);
  if (!dirResp.ok) {
    throw new Error(`Could not access NHL game notes directory (${dirResp.status})`);
  }

  const listing = await dirResp.text();
  const escapedDate = date.replace(/[-/]/g, '-');
  const pattern = new RegExp(`gn-${escapedDate}-(\\d{4})-${awayTeam}@${homeTeam}\\.pdf`, 'i');
  const hit = listing.match(pattern);

  if (!hit) {
    throw new Error('Matching game notes PDF not found for selected date/teams.');
  }

  const filename = `gn-${escapedDate}-${hit[1]}-${awayTeam}@${homeTeam}.pdf`;
  return {
    filename,
    url: `${baseNotesUrl}${filename}`,
  };
}

async function uploadPdfToOpenAI(pdfBuffer, filename) {
  const form = new FormData();
  const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
  form.append('purpose', 'user_data');
  form.append('file', blob, filename);

  const uploadResp = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });

  if (!uploadResp.ok) {
    const err = await uploadResp.text();
    throw new Error(`OpenAI file upload failed: ${uploadResp.status} ${err}`);
  }

  const uploadJson = await uploadResp.json();
  return uploadJson.id;
}

async function generateFromPdf({ fileId, awayTeam, homeTeam, gameDate }) {
  const prompt = [
    `You are supporting an NHL broadcast producer for ${awayTeam} at ${homeTeam} on ${gameDate}.`,
    'Use ONLY information that appears in the attached game notes PDF file.',
    'Do not use any outside knowledge. If something is missing, omit it.',
    'Return valid JSON with keys: producerBriefing and gfxList.',
    'producerBriefing format (all arrays of bullet strings):',
    '- situationOverview (2-3 bullets)',
    '- tier1MustUse (max 3)',
    '- tier2Supporting (max 3)',
    '- tier3DepthFill (max 3)',
    '- contingencyIfUnavailable',
    '- quickReferenceStats',
    'gfxList format:',
    '- lowerThirds: 20+ bullet strings in format "Player Name / One punchy stat with context / Suggested segment"',
    '- fullScreens: 8-10 bullet strings in format "Title / Type / Key data points / Suggested segment"',
    'Keep every item concise and high broadcast value with playoff context, milestones, and streaks when present.',
    'Bullet-oriented content only, no narrative paragraphs.',
  ].join('\n');

  const resp = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_file', file_id: fileId },
          ],
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'nhl_producer_outputs',
          schema: {
            type: 'object',
            properties: {
              producerBriefing: {
                type: 'object',
                properties: {
                  situationOverview: { type: 'array', items: { type: 'string' } },
                  tier1MustUse: { type: 'array', items: { type: 'string' } },
                  tier2Supporting: { type: 'array', items: { type: 'string' } },
                  tier3DepthFill: { type: 'array', items: { type: 'string' } },
                  contingencyIfUnavailable: { type: 'array', items: { type: 'string' } },
                  quickReferenceStats: { type: 'array', items: { type: 'string' } },
                },
                required: [
                  'situationOverview',
                  'tier1MustUse',
                  'tier2Supporting',
                  'tier3DepthFill',
                  'contingencyIfUnavailable',
                  'quickReferenceStats',
                ],
                additionalProperties: false,
              },
              gfxList: {
                type: 'object',
                properties: {
                  lowerThirds: { type: 'array', items: { type: 'string' } },
                  fullScreens: { type: 'array', items: { type: 'string' } },
                },
                required: ['lowerThirds', 'fullScreens'],
                additionalProperties: false,
              },
            },
            required: ['producerBriefing', 'gfxList'],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI response failed: ${resp.status} ${err}`);
  }

  const payload = await resp.json();
  const text = payload.output_text || payload?.output?.[0]?.content?.[0]?.text;

  if (!text) {
    throw new Error('OpenAI did not return parsable output_text.');
  }

  return JSON.parse(text);
}

const server = createServer(async (req, res) => {
  try {
    const { method, url } = req;

    if (method === 'GET' && url === '/api/health') {
      return sendJson(res, 200, { ok: true, seasonPath });
    }

    if (method === 'POST' && url === '/api/find-game-note') {
      const body = JSON.parse(await readBody(req));
      const { awayTeam, homeTeam, gameDate } = body;
      if (!awayTeam || !homeTeam || !gameDate) {
        return sendJson(res, 400, { error: 'awayTeam, homeTeam, and gameDate are required.' });
      }
      const data = await findGameNoteFile({ date: gameDate, awayTeam, homeTeam });
      return sendJson(res, 200, data);
    }

    if (method === 'POST' && url === '/api/generate') {
      const body = JSON.parse(await readBody(req));
      const { awayTeam, homeTeam, gameDate } = body;

      if (!awayTeam || !homeTeam || !gameDate) {
        return sendJson(res, 400, { error: 'awayTeam, homeTeam, and gameDate are required.' });
      }

      if (!OPENAI_API_KEY) {
        return sendJson(res, 500, {
          error: 'OPENAI_API_KEY is not set. Add it to your environment before generating outputs.',
        });
      }

      const gameFile = await findGameNoteFile({ date: gameDate, awayTeam, homeTeam });
      const pdfResp = await fetch(gameFile.url);
      if (!pdfResp.ok) {
        throw new Error(`Could not download PDF (${pdfResp.status})`);
      }
      const pdfBuffer = Buffer.from(await pdfResp.arrayBuffer());
      const fileId = await uploadPdfToOpenAI(pdfBuffer, gameFile.filename);
      const generated = await generateFromPdf({ fileId, awayTeam, homeTeam, gameDate });

      return sendJson(res, 200, {
        sourcePdfUrl: gameFile.url,
        sourcePdfFile: gameFile.filename,
        ...generated,
      });
    }

    const normalizedPath = url === '/' ? '/index.html' : url;
    const filePath = join(publicDir, normalizedPath);
    const ext = extname(filePath);
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    res.end(content);
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`NHL Producer app listening on http://localhost:${PORT}`);
});
