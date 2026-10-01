// 將 /upload 的回應整理成顯示文字
async function formatResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || response.statusText);
  }
  const percent = (p) => (p * 100).toFixed(1) + '%';
  const lines = [
    `Verdict: ${data.verdict === 'fake' ? 'Likely fake' : 'Likely real'}`,
    `Fake probability: ${percent(data.fake_probability)}`
  ];
  if (data.details?.audio) lines.push(`  Audio: ${percent(data.details.audio.fake_probability)}`);
  if (data.details?.frames) lines.push(`  Video frames: ${percent(data.details.frames.fake_probability)}`);
  return lines.join('\n');
}

document.getElementById('uploadForm').addEventListener('submit', async function (event) {
  event.preventDefault();

  const fileInput = document.getElementById('fileInput');
  if (fileInput.files.length === 0) {
    alert('Please select a file.');
    return;
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  //Fetch API
  try {
    const response = await fetch('/upload', {
      method: 'POST',
      body: formData
    });

    document.getElementById('result').textContent = await formatResponse(response);
  } catch (error) {
    document.getElementById('result').textContent = 'Error uploading file: ' + error.message;
  }
});

let mediaRecorder;
let audioChunks = [];
let startTime;
let recordingTimer;

const recordButton = document.getElementById('recordButton');
const stopButton = document.getElementById('stopButton');
const audioPlayback = document.getElementById('audioPlayback');
const downloadLink = document.getElementById('downloadLink');
const uploadRecordedAudio = document.getElementById('uploadRecordedAudio');
const recordingIndicator = document.getElementById('recordingIndicator'); // 錄音指示器
const recordingTime = document.getElementById('recordingTime'); // 錄音時間顯示

// 更新錄音時間顯示的函數
function updateRecordingTime() {
  const currentTime = Date.now();
  const elapsedTime = Math.floor((currentTime - startTime) / 1000); // 計算秒數
  const minutes = Math.floor(elapsedTime / 60);
  const seconds = elapsedTime % 60;
  recordingTime.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`; // 格式化時間顯示
}

navigator.mediaDevices.getUserMedia({
  audio: true
}).then(stream => {
  mediaRecorder = new MediaRecorder(stream);

  mediaRecorder.addEventListener('dataavailable', event => {
    audioChunks.push(event.data);
  });

  recordButton.addEventListener('click', () => {
    audioChunks = [];
    mediaRecorder.start();
    recordButton.disabled = true;
    stopButton.disabled = false;
    recordingIndicator.style.display = 'block'; // 顯示錄音指示器

    // 重置時間顯示
    recordingTime.textContent = '0:00';

    // 開始計時
    startTime = Date.now();
    recordingTimer = setInterval(updateRecordingTime, 1000); // 每秒更新一次時間
  });

  stopButton.addEventListener('click', () => {
    mediaRecorder.stop();
    recordButton.disabled = false;
    stopButton.disabled = true;
    recordingIndicator.style.display = 'none'; // 停止錄音後隱藏指示器
    clearInterval(recordingTimer); // 停止計時
  });

  mediaRecorder.addEventListener('stop', () => {
    const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
    const audioUrl = URL.createObjectURL(audioBlob);
    audioPlayback.src = audioUrl;
  
    // 當音頻元數據加載完成後觸發
    audioPlayback.onloadedmetadata = () => {
      // 設置音頻播放器的初始進度為 0 
      audioPlayback.currentTime = 0;
    };
  
    downloadLink.href = audioUrl;
    downloadLink.download = 'audio.wav';
    downloadLink.style.display = 'block';
    downloadLink.textContent = 'Download';
    uploadRecordedAudio.style.display = 'block';
  
    uploadRecordedAudio.addEventListener('click', async function () {
      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.wav');
  
      try {
        const response = await fetch('/upload', {
          method: 'POST',
          body: formData
        });
  
        document.getElementById('result').textContent = await formatResponse(response);
      } catch (error) {
        document.getElementById('result').textContent = 'Error uploading recorded audio: ' + error.message;
      }
    });
  });  
})
.catch(error => { console.error('Error accessing the chosen device:', error); });

