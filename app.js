const express = require('express');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const FormData = require('form-data');

const execFileAsync = promisify(execFile);

const app = express();
const port = 4000;

const IMAGE_SERVICE_URL = process.env.IMAGE_SERVICE_URL || 'http://localhost:3000/inference';
const AUDIO_SERVICE_URL = process.env.AUDIO_SERVICE_URL || 'http://localhost:8085/spoof_detector';
const AUDIO_SERVICE_TOKEN = process.env.AUDIO_SERVICE_TOKEN || '456123';

// fake_probability 超過此值判定為偽造
const FAKE_THRESHOLD = 0.5;
// 影片抽幾張畫面給圖片模型
const VIDEO_FRAME_COUNT = 4;

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus'];
const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.mkv', '.avi'];

// 使用 multer 來處理文件上傳
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // 存放上傳的文件
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname)); // 確保文件名唯一
  }
});

const upload = multer({ storage: storage });

app.use(express.static('public'));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// 以表單欄位 kind 為準，沒有的話依副檔名判斷
function detectKind(requestedKind, filename) {
  if (['image', 'audio', 'video'].includes(requestedKind)) return requestedKind;
  const ext = path.extname(filename).toLowerCase();
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (AUDIO_EXTS.includes(ext)) return 'audio';
  if (VIDEO_EXTS.includes(ext)) return 'video';
  return null;
}

async function runFfmpeg(args) {
  try {
    return await execFileAsync('ffmpeg', ['-v', 'error', '-y', ...args]);
  } catch (err) {
    if (err.code === 'ENOENT') throw new HttpError(500, 'ffmpeg is not installed on the backend');
    throw new HttpError(422, `Cannot decode media: ${(err.stderr || err.message).trim()}`);
  }
}

async function probe(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', filePath
    ]);
    const info = JSON.parse(stdout);
    const types = (info.streams || []).map(s => s.codec_type);
    const hasVideo = types.includes('video');
    let duration = parseFloat(info.format?.duration) || 0;
    // 瀏覽器 MediaRecorder 錄的 webm 沒有長度資訊，改用最後一個畫面的時間戳
    if (!duration && hasVideo) {
      const { stdout: pts } = await execFileAsync('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', filePath
      ], { maxBuffer: 16 * 1024 * 1024 });
      duration = Math.max(0, ...pts.split('\n').map(parseFloat).filter(Number.isFinite));
    }
    return { hasAudio: types.includes('audio'), hasVideo, duration };
  } catch (err) {
    if (err.code === 'ENOENT') throw new HttpError(500, 'ffprobe is not installed on the backend');
    throw new HttpError(422, 'Cannot read media file');
  }
}

// 圖片模型回傳 [{ output: [p] }]，p 為 AI 生成機率
async function detectImage(filePath) {
  const formData = new FormData();
  formData.append('img', fs.createReadStream(filePath));
  const response = await axios.post(IMAGE_SERVICE_URL, formData, { headers: formData.getHeaders() });
  const p = response.data?.[0]?.output?.[0];
  if (typeof p !== 'number') throw new HttpError(502, 'Unexpected response from image service');
  return { fake_probability: p };
}

// 語音模型輸入為 16 kHz 單聲道 wav
async function detectAudio(wavPath) {
  const response = await axios.post(AUDIO_SERVICE_URL, {
    reference_id: `REF${Date.now()}`,
    audio_data: fs.readFileSync(wavPath).toString('base64'),
    model_version: 'v0'
  }, {
    headers: {
      'Authorization': `Bearer ${AUDIO_SERVICE_TOKEN}`,
      'Content-Type': 'application/json',
      'accept': 'application/json'
    },
    maxBodyLength: Infinity
  });
  const { fake_probability, segment_probabilities } = response.data || {};
  if (typeof fake_probability !== 'number') throw new HttpError(502, 'Unexpected response from audio service');
  return { fake_probability, segment_probabilities };
}

async function extractAudio(inputPath, workDir) {
  const wavPath = path.join(workDir, 'audio.wav');
  await runFfmpeg(['-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', wavPath]);
  return wavPath;
}

// 在影片中平均取 VIDEO_FRAME_COUNT 張畫面
async function extractFrames(inputPath, duration, workDir) {
  const frames = [];
  for (let i = 0; i < VIDEO_FRAME_COUNT; i++) {
    const t = duration > 0 ? (duration * (i + 0.5)) / VIDEO_FRAME_COUNT : 0;
    const framePath = path.join(workDir, `frame${i}.png`);
    await runFfmpeg(['-ss', t.toFixed(3), '-i', inputPath, '-frames:v', '1', framePath]);
    if (fs.existsSync(framePath)) frames.push(framePath);
  }
  if (!frames.length) throw new HttpError(422, 'Cannot extract frames from video');
  return frames;
}

async function analyze(kind, filePath, workDir) {
  if (kind === 'image') {
    const image = await detectImage(filePath);
    return { fake_probability: image.fake_probability, details: { image } };
  }

  const media = await probe(filePath);
  const details = {};

  if (media.hasAudio) {
    details.audio = await detectAudio(await extractAudio(filePath, workDir));
  }
  if (kind === 'video' && media.hasVideo) {
    const frames = await extractFrames(filePath, media.duration, workDir);
    // 個別畫面失敗時以其餘畫面計算，全部失敗才回報錯誤
    const settled = await Promise.allSettled(frames.map(detectImage));
    const failed = settled.filter(r => r.status === 'rejected');
    if (failed.length === settled.length) throw failed[0].reason;
    failed.forEach(r => console.error('Frame detection failed:', r.reason.message));
    const probs = settled.filter(r => r.status === 'fulfilled').map(r => r.value.fake_probability);
    details.frames = {
      fake_probability: probs.reduce((a, b) => a + b, 0) / probs.length,
      frame_probabilities: probs
    };
  }

  const parts = [details.audio, details.frames].filter(Boolean);
  if (!parts.length) throw new HttpError(422, 'No audio or video stream found in media');
  // 音軌與畫面任一方判定偽造即視為偽造，取較高者
  return { fake_probability: Math.max(...parts.map(p => p.fake_probability)), details };
}

// 處理圖片、音訊或影片上傳，回傳偽造機率
app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const uploadedFilePath = req.file.path;
  const kind = detectKind(req.body?.kind, req.file.originalname);
  console.log('Received file:', req.file.originalname, kind);

  let workDir;
  try {
    if (!kind) throw new HttpError(400, 'Unsupported file type.');
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-'));
    const result = await analyze(kind, uploadedFilePath, workDir);
    res.json({
      kind,
      fake_probability: result.fake_probability,
      verdict: result.fake_probability >= FAKE_THRESHOLD ? 'fake' : 'real',
      details: result.details
    });
  } catch (error) {
    let status = error.status || 500;
    let message = error.message;
    if (error.isAxiosError) {
      status = 502;
      // 完整的服務網址只記在後端 log，回給前端的訊息不帶內部位址
      console.error('Upstream error:', error.config?.url, error.response?.status, error.response?.data || error.code);
      const service = error.config?.url === AUDIO_SERVICE_URL ? 'Audio' : 'Image';
      const data = error.response?.data;
      const detail = data?.error_message || data?.error || (error.response ? `HTTP ${error.response.status}` : 'service unavailable');
      message = `${service} detection failed: ${detail}`;
    }
    console.error('Error in detection:', message);
    res.status(status).json({ error: message });
  } finally {
    fs.unlink(uploadedFilePath, (err) => {
      if (err) console.error('Failed to delete temporary file:', err);
    });
    if (workDir) fs.rm(workDir, { recursive: true, force: true }, () => {});
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
