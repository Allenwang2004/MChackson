import logging
from logging.handlers import TimedRotatingFileHandler
import os
import sys
from time import strftime

def setup_logger(name="spoof-api", log_file_root='../log', level=logging.INFO):

    log_file = os.path.join(log_file_root, 'info.log')

    if not os.path.exists(log_file_root):
        os.makedirs(log_file_root)

    logger = logging.getLogger(name)
    logger.setLevel(level)

    formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")

    # StreamHandler
    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setLevel(logging.INFO)
    stream_handler.setFormatter(formatter)

    # TimedRotatingFileHandler 
    file_handler = TimedRotatingFileHandler(log_file, when='midnight', interval=1, backupCount=0)   #midnight/S/M
    file_handler.suffix = '%Y%m%d'
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(formatter)

    logger.addHandler(stream_handler)
    logger.addHandler(file_handler)

    return logger


