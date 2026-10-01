from typing import List

import torch
import bentoml
from PIL.Image import Image as PILImage
from pydantic import Field

from lgrad_inference import StyleGANModel, LGradModel


@bentoml.service(http={
    "cors": {
        "enabled": True,
        "access_control_allow_origins": ["*"],
        "access_control_allow_methods": ["GET", "OPTIONS", "POST", "HEAD", "PUT"],
        "access_control_allow_credentials": True,
        "access_control_allow_headers": ["*"],
        "access_control_allow_origin_regex": "https://.*\.my_org\.com",
        "access_control_max_age": 1200,
        "access_control_expose_headers": ["Content-Length"]
    }
})
class LgradService:

    # model_ref = bentoml.models.get('lgrad_model:20240905')

    def __init__(self) -> None:
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

        # self.preprocess_path = self.model_ref.path_of('preprocess.pth')
        # self.lgrad_path = self.model_ref.path_of('lgrad.pth')
        self.preprocess_path = 'karras2019stylegan-bedrooms-256x256_discriminator.pth'
        self.lgrad_path = 'LGrad.pth'
        print('preprocess_path', self.preprocess_path)
        print('lgrad_path', self.lgrad_path)

        self.model1 = StyleGANModel(self.device, self.preprocess_path)
        self.model2 = LGradModel(self.device, self.lgrad_path)

    @bentoml.api(
        batchable=True,
        batch_dim=(0, 0),
        max_batch_size=8,
        max_latency_ms=5000,
    )
    def inference(
        self, img: List[PILImage] = Field(description="An image to inference")) -> List[dict]:
        out1 = self.model1.forward(img)
        out2 = self.model2.forward(out1)
        out = [{'output': o.tolist()} for o in out2]
        return out
