import base64
import binascii
import datetime
import time
import traceback

from swagger_server.controllers.log_setting import setup_logger
from swagger_server.core.inference import ModelNotAvailable, predict_fake_probability

logger = setup_logger()
logger.info('Logging setup complete.')

all_models = ['v0', 'v1']

# fake_probability 超過此值判定為偽造
FAKE_THRESHOLD = 0.5

UID = "20210827142959-42f091f4"


def convert_time(t):
    dt = datetime.datetime.utcfromtimestamp(t).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3]
    return dt


def _processing_time(start):
    end = time.time()
    return {
        "start_time": convert_time(start),
        "end_time": convert_time(end),
        "duration_in_s": end - start
    }


def _error(reference_id, start, status_code, message):
    body = {
        "reference_id": reference_id,
        "uid": UID,
        "status_code": status_code,
        "processing_time": _processing_time(start),
        "error_message": message
    }
    return body, status_code, {"Content-Type": "application/json"}


def spoof_detector(body):  # noqa: E501
    start = time.time()
    reference_id = body.get('reference_id')

    if body.get('model_version') not in all_models:
        return _error(reference_id, start, 400, "incorrect input values")

    try:
        audio_bytes = base64.b64decode(body['audio_data'], validate=True)
    except (binascii.Error, ValueError):
        return _error(reference_id, start, 400, "audio_data is not valid base64")

    logger.info("analyzing...")

    try:
        prediction = predict_fake_probability(audio_bytes)
    except ModelNotAvailable as e:
        logger.error(str(e))
        return _error(reference_id, start, 503, "model not available")
    except ValueError as e:
        return _error(reference_id, start, 400, f"cannot decode audio: {e}")
    except Exception:
        logger.error(traceback.format_exc())
        return _error(reference_id, start, 500, "internal error")

    fake_probability = prediction['fake_probability']
    res_success = {
        "reference_id": reference_id,
        "uid": UID,
        "status_code": 200,
        "processing_time": _processing_time(start),
        "result": "spoofed" if fake_probability >= FAKE_THRESHOLD else "real",
        "fake_probability": fake_probability,
        "segment_probabilities": prediction['segment_probabilities']
    }
    logger.info(res_success)
    return res_success, 200, {"Content-Type": "application/json"}
