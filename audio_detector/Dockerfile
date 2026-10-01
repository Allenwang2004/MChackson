FROM pytorch/pytorch:1.13.1-cuda11.6-cudnn8-runtime

# fairseq 需要編譯器，librosa 需要 libsndfile
RUN apt-get -y update \
    && apt-get install -y --no-install-recommends build-essential libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /home/docker/spoof_docker

COPY requirements.txt .
# fairseq 0.12.2 依賴的 omegaconf 2.0.x 套件資訊不被 pip>=24.1 接受
RUN pip install "pip<24.1" && pip install -r requirements.txt

COPY . .

# 模型權重不放進 image，啟動時掛載到 /models
ENV SSL_MODEL_PATH=/models/LA_model.pth \
    XLSR_PATH=/models/xlsr2_300m.pt

EXPOSE 8085
CMD ["uvicorn", "--factory", "swagger_server.__main__:main", "--host", "0.0.0.0", "--port", "8085"]
