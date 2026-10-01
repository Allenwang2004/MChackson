import json
import io

import gradio as gr
import requests
from PIL import Image

def greet(image):
    with io.BytesIO() as f:
        image.save(f, format='png')
        f.seek(0)
        files = {'img': f}
        ret = requests.post('http://localhost:3000/inference', files=files)
    if ret.ok:
        ret1 = json.loads(ret.text)[0]
        print(ret1)
        output = ret1['output']
        return {'AI': output[0], 'Not AI': 1 - output[0]}
    else:
        return ret.text()

demo = gr.Interface(
    fn=greet,
    inputs=[gr.Image(type='pil')],
    outputs=[gr.Label()],
)

demo.launch(share=False)
