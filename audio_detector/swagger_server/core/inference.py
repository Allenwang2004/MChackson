"""SSL_Anti-spoofing（wav2vec2 XLS-R + AASIST）推論。

模型權重路徑由環境變數設定：
  SSL_MODEL_PATH  微調後的 LA_model.pth
  XLSR_PATH       預訓練的 xlsr2_300m.pt（由 ssl_model.SSLModel 讀取）
"""
import io
import os
import threading

import librosa
import numpy as np
import torch

SAMPLE_RATE = 16000
# 與原始訓練相同，每段約 4 秒
SEGMENT_SAMPLES = 64600
# 長音訊最多切幾段分析，避免單次請求太久
MAX_SEGMENTS = 10
# 原始資料集標籤：1 = bonafide，0 = spoof
SPOOF_CLASS = 0


class ModelNotAvailable(Exception):
    pass


_model = None
_device = None
_lock = threading.Lock()


def _load_model():
    global _model, _device
    with _lock:
        if _model is not None:
            return _model
        model_path = os.environ.get('SSL_MODEL_PATH', 'LA_model.pth')
        xlsr_path = os.environ.get('XLSR_PATH', 'xlsr2_300m.pt')
        for path in (model_path, xlsr_path):
            if not os.path.isfile(path):
                raise ModelNotAvailable(f'model file not found: {path}')

        from swagger_server.core.ssl_model import Model

        _device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        model = Model(None, _device)
        state = torch.load(model_path, map_location=_device)
        # 原始專案以 nn.DataParallel 訓練，權重 key 帶有 module. 前綴
        state = {k.removeprefix('module.'): v for k, v in state.items()}
        model.load_state_dict(state)
        model.to(_device)
        model.eval()
        _model = model
        return _model


def _pad(x: np.ndarray, max_len: int = SEGMENT_SAMPLES) -> np.ndarray:
    """與 data_utils_SSL.pad 相同：不足長度時重複填滿。"""
    if x.shape[0] >= max_len:
        return x[:max_len]
    num_repeats = int(max_len / x.shape[0]) + 1
    return np.tile(x, num_repeats)[:max_len]


def _segments(wave: np.ndarray) -> np.ndarray:
    if wave.shape[0] <= SEGMENT_SAMPLES:
        return _pad(wave)[None, :]
    count = min(wave.shape[0] // SEGMENT_SAMPLES, MAX_SEGMENTS)
    # 段數超過上限時平均取樣整段音訊
    starts = np.linspace(0, wave.shape[0] - SEGMENT_SAMPLES, count).astype(int)
    return np.stack([wave[s:s + SEGMENT_SAMPLES] for s in starts])


def predict_fake_probability(audio_bytes: bytes) -> dict:
    """回傳整段音訊的偽造機率（0 到 1）以及各段的機率。"""
    model = _load_model()

    wave, _ = librosa.load(io.BytesIO(audio_bytes), sr=SAMPLE_RATE, mono=True)
    if wave.size == 0:
        raise ValueError('empty audio')

    batch = torch.from_numpy(_segments(wave)).float().to(_device)
    with torch.no_grad():
        logits = model(batch)
        probs = torch.softmax(logits, dim=1)[:, SPOOF_CLASS].cpu().numpy()

    return {
        'fake_probability': float(probs.mean()),
        'segment_probabilities': [float(p) for p in probs],
    }
