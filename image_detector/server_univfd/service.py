from typing import Tuple, List

import numpy as np
import numpy.typing as npt
from PIL.Image import Image as PILImage
import bentoml
import onnxruntime as ort
from pydantic import Field


def padding(arr: npt.NDArray, shape: Tuple[int, int], pad_val) -> npt.NDArray:
    if arr.shape[0] < shape[0] or arr.shape[1] < shape[1]:
        ypad = max(shape[0] - arr.shape[0], 0)
        xpad = max(shape[1] - arr.shape[1], 0)
        new_img = np.full(
            (arr.shape[0] + ypad, arr.shape[1] + xpad, arr.shape[2]),
            pad_val,
            dtype=arr.dtype,
        )
        starty = ypad // 2
        startx = xpad // 2
        new_img[starty:starty + arr.shape[0], startx:startx + arr.shape[1]] = arr[:, :]
        return new_img
    else:
        return arr


def crop_center(arr: npt.NDArray, shape: Tuple[int, int]) -> npt.NDArray:
    y, x, _ = arr.shape
    starty = y // 2 - shape[0] // 2
    startx = x // 2 - shape[1] // 2
    return arr[starty:starty + shape[0], startx:startx + shape[1]]


def normalize(arr: npt.NDArray, mean: npt.ArrayLike, std: npt.ArrayLike):
    return (arr - mean) / std


def preprocess(arr: npt.NDArray, input_shape: Tuple[int, int]):
    arr = padding(arr, input_shape, 128)
    arr = crop_center(arr, input_shape)
    arr = arr.astype(np.float32) / 255.0
    mean = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
    std = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)
    arr = normalize(arr, mean, std)
    arr = np.transpose(arr, (2, 0, 1))

    arr = np.expand_dims(arr, 0)
    return arr


def sigmoid(z):
    return 1 / (1 + np.exp(-z))


@bentoml.service(http={
    "cors": {
        "enabled": True,
        "access_control_allow_origins": ["*"],
        "access_control_allow_methods": ["GET", "OPTIONS", "POST", "HEAD", "PUT"],
        "access_control_allow_credentials": True,
        "access_control_allow_headers": ["*"],
        "access_control_max_age": 1200,
        "access_control_expose_headers": ["Content-Length"]
    }
})
class UnivfdService:

    # model_file = bentoml.onnx.get('univfd_model:20240814')

    def __init__(self):
        sess_opt = ort.SessionOptions()
        sess_opt.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
        providers = ort.get_available_providers()
        self.model_file = 'univfd_model_20240814.onnx'
        print(self.model_file)
        # self.model = bentoml.onnx.load_model(
        #     self.model_file,
        #     providers=providers,
        #     session_options=sess_opt,
        # )
        self.model = ort.InferenceSession(
            self.model_file,
            sess_options=sess_opt,
            providers=providers,
        )

        input_shapes = [(i.name, i.shape) for i in self.model.get_inputs()]
        output_shapes = [(o.name, o.shape) for o in self.model.get_outputs()]
        print("input_shapes", input_shapes)
        print("output_shapes", output_shapes)

        self.input_name = input_shapes[0][0]
        self.input_shape = input_shapes[0][1][2:4]  # H, W

    @bentoml.api(
        batchable=True,
        batch_dim=(0, 0),
        max_batch_size=8,
        max_latency_ms=5000,
    )
    def inference(
        self, img: List[PILImage] = Field(description="An image to inference")) -> List[dict]:
        print("img", len(img))
        arrs = [np.asarray(i.convert("RGB")) for i in img]
        arrs = [preprocess(i, self.input_shape) for i in arrs]
        arrs = np.concatenate(arrs, axis=0)
        out = self.model.run(None, {self.input_name: arrs})
        out = out[0]
        out = sigmoid(out)
        out = [{'output': o.tolist()} for o in out]
        return out

    @bentoml.api
    def inference2(self, img: PILImage = Field(description="An image to inference")) -> dict:
        arr = np.asarray(img.convert("RGB"))
        arr = preprocess(arr, self.input_shape)
        out = self.model.run(None, {self.input_name: arr})
        out = out[0]  # First output
        out = sigmoid(out)
        out = out[0]  # Batch 0
        out = {'output': out.tolist()}

        return out


# def main():
#     srv = Service()
#     with PILImage.open("./00226.png") as img:
#         ret = srv.inference(img)
#     print(ret)

# if __name__ == "__main__":
#     main()
#     pass
