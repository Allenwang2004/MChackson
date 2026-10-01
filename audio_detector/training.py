import torch
import connexion
import six
import time
import datetime
import logging
import joblib
import sys
import base64
import numpy as np
from swagger_server.controllers.log_setting import setup_logger
from swagger_server.models.main_model import Model

logger = setup_logger()
logger.info('Logging setup complete.')

all_models = ['v1']

def convert_time(t):
    dt = datetime.datetime.utcfromtimestamp(t).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3]
    return dt

def decode_audio_data(audio_data):
    # Decode base64-encoded audio data
    audio_bytes = base64.b64decode(audio_data)
    
    # Convert bytes to numpy array or tensor
    audio_np = np.frombuffer(audio_bytes, dtype=np.float32)  # Adjust dtype if needed
    
    # Convert to torch tensor, and possibly add batch dimension
    audio_tensor = torch.from_numpy(audio_np).unsqueeze(0)  # Add batch dimension if necessary
    return audio_tensor

def read_audio_from_file(file_path):
    with open(file_path, 'r') as file:
        audio_data = file.read().strip()
    return audio_data

def spoof_detector(file_path):  # Now takes a file path as input
    headers = {"Content-Type": "application/json"}
    start_time_overall = time.time()

    try:
        # Read audio data from the specified file
        audio_data = read_audio_from_file(file_path)  # Read from the .txt file

        logger.info("analyzing...")

        # Step 1: Initialize the model (use CPU or GPU)
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        args = {}  # You can specify any arguments your model needs
        model = Model(args, device)  # Initialize the model
        model.to(device)  # Move model to the correct device
        model.eval()  # Set the model to evaluation mode

        # Step 2: Decode and process audio_data to the correct format (Tensor)
        audio_tensor = decode_audio_data(audio_data)  # Decode base64 data and convert to tensor

        # Step 3: Make predictions using the model
        with torch.no_grad():  # Disable gradient calculation for inference
            audio_tensor = audio_tensor.to(device)
            prediction = model(audio_tensor)  # Get prediction

        # Step 4: Process the prediction to get label and confidence score
        confidence = prediction.softmax(dim=1).max().item()  # Example confidence score extraction
        label = "real" if torch.argmax(prediction).item() == 0 else "spoofed"  # Binary classification result

        # Step 5: Return the result
        end_time_overall = time.time()
        overall_time = end_time_overall - start_time_overall

        res_success = {
            "status_code": 200,
            "processing_time": {
                "start_time": convert_time(start_time_overall),
                "end_time": convert_time(end_time_overall),
                "duration_in_s": overall_time
            },
            "result": label,  # Either "real" or "spoofed"
            "confidence": confidence  # Confidence score
        }

        logger.info(res_success)
        return res_success, 200, headers

    except Exception as e:
        logger.error(f"Exception occurred: {str(e)}")
        end_time_overall = time.time()
        overall_time = end_time_overall - start_time_overall
        res_excep_others = {
            "status_code": 500,
            "processing_time": {
                "start_time": convert_time(start_time_overall),
                "end_time": convert_time(end_time_overall),
                "duration_in_s": overall_time
            },
            "error_message": "internal error"
        }
        return res_excep_others, 500, headers