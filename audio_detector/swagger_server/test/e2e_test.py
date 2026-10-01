import requests
import json
import base64
import time
import sys
from os import path

requests.packages.urllib3.disable_warnings(requests.packages.urllib3.exceptions.InsecureRequestWarning)

swagger_server_url = 'http://127.0.0.1:8085' 
url_spoof = swagger_server_url + '/spoof_detector'
url_auth = swagger_server_url + '/auth/{}'

proxies = {
  "http": None,
  "https": None
}
verifySSL = False

def test_security(user_id, auth):
    headers = {'accept': 'text/plain',
                'Authorization': auth}
    response = requests.get(url_auth.format(user_id), headers=headers, proxies=proxies, verify=verifySSL)
    return response.text, response.status_code

def test_spf_detect(reference_id, audio_data, model_version):  
    data = {
                'reference_id': reference_id, 
                'audio_data': audio_data,
                'model_version': model_version}
            
    response = requests.post(url_spoof, json=data, headers=headers, proxies=proxies, verify=verifySSL)
    try:
        rdata = response.json()
    except:
        print(response.content)
        rdata = None
    status_code = response.status_code
    return rdata, status_code   
    
if __name__ == '__main__':
    auth = "Bearer 123456"   
    headers = {'Authorization': '%s'%auth}     
    rdata, status = test_security(user_id='12', auth=auth)
    print('jwt:', rdata)
    
    test_audio_root = './swagger_server/test/audio_data/'
    reference_id = 'REF00000001'
    model_version = 'v1'
    audio_name = 'BCRf1033_8k_bit16_16k_bit16.wav'
#    audio_name = 'SCEf1018_8k_bit16_16k_bit16.wav'
    audio_path = test_audio_root + audio_name

    with open(audio_path, 'rb') as f: 
        encode_string = base64.b64encode(f.read()).decode('utf-8')
        
    rdata, status_code = test_spf_detect(reference_id=reference_id, 
                            							   audio_data=encode_string, 
                            							   model_version=model_version)
    print(rdata)   
    
    