from pathlib import Path
import glob
import os

import numpy as np
import cv2 as cv
from PIL import Image
import torch
import torchvision.transforms as T

from preprocessing_model.LGrad_models import build_model
from networks.resnet import resnet50


def get_stage1_preprocess():
    preprocess = T.Compose([
        # T.CenterCrop((256, 256)),
        T.Resize((256, 256)),
        T.ToTensor(),
        T.Normalize(mean=[0.5, 0.5, 0.5], std=[0.5, 0.5, 0.5]),
    ])
    return preprocess


def get_stage1_model(device, model_path):
    premodel = build_model(
        gan_type='stylegan',
        module='discriminator',
        resolution=256,
        label_size=0,
        image_channels=3,
    )
    premodel.load_state_dict(
        torch.load(model_path, weights_only=True, map_location='cpu'),
        strict=True,
    )
    premodel.to(device)
    premodel.eval()
    return premodel


def normlize_np(img):
    img -= img.min()
    if img.max() != 0:
        img /= img.max()
    return img * 255.


def batchimg(pil_images, preprocess):
    img_list = []
    for img in pil_images:
        img_list.append(torch.unsqueeze(preprocess(img), 0))
    return torch.cat(img_list, 0)


def get_stage2_preprocess():
    preprocess = T.Compose([
        T.CenterCrop(256),
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])
    return preprocess


def get_stage2_model(device, model_path):
    model = resnet50(num_classes=1)
    state_dict = torch.load(model_path, map_location=device, weights_only=True)
    model.load_state_dict(state_dict['model'])
    model.to(device)
    model.eval()
    return model


class StyleGANModel():

    def __init__(self, device, model_path):
        self.device = device
        self.model_path = model_path
        self.preprocess = get_stage1_preprocess()
        self.model = get_stage1_model(device, model_path)

    def forward(self, images):
        batch = batchimg(images, self.preprocess)
        batch = batch.to(self.device)
        batch.requires_grad = True

        out = self.model(batch)
        self.model.zero_grad()
        grad = torch.autograd.grad(
            out.sum(),
            batch,
            create_graph=True,
            retain_graph=True,
            allow_unused=False,
        )[0]

        grad_images = []
        for grad_img in grad:
            img = grad_img.detach().cpu().permute((1, 2, 0)).numpy()
            img = normlize_np(img)
            img = img.astype(np.uint8)
            im = Image.fromarray(img)
            grad_images.append(im)
        return grad_images


class LGradModel():

    def __init__(self, device, model_path) -> None:
        self.device = device
        self.model_path = model_path
        self.preprocess = get_stage2_preprocess()
        self.model = get_stage2_model(device, model_path)

    def forward(self, images):
        batch = batchimg(images, self.preprocess)
        batch = batch.to(self.device)

        with torch.no_grad():
            out = self.model(batch)
            out = out.sigmoid().detach().cpu()
        out = out.numpy()
        return out


class ImageDataset:

    def __init__(self, images_paths) -> None:
        self.images_paths = images_paths
        self.dataset = []
        for image_path in images_paths:
            real_images = glob.glob(os.path.join(image_path, '**', '0_real',
                                                 '*'),
                                    recursive=True)
            for i in real_images:
                self.dataset.append((i, 0))
            fake_images = glob.glob(os.path.join(image_path, '**', '1_fake',
                                                 '*'),
                                    recursive=True)
            for i in fake_images:
                self.dataset.append((i, 1))

    def __len__(self):
        return len(self.dataset)

    def __getitem__(self, idx):
        item = self.dataset[idx]
        try:
            im = Image.open(item[0]).convert('RGB')
        except Exception as ex:
            print('read', item[0], 'failed:', ex)
            print('fallback use opencv')
            im2 = cv.imread(item[0], cv.IMREAD_COLOR)
            im = Image.fromarray(im2[..., ::-1])

        ret = (im, item[1])
        return ret


def main():
    np.set_printoptions(suppress=True)

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

    model1 = StyleGANModel(
        device, 'karras2019stylegan-bedrooms-256x256_discriminator.pth')
    model2 = LGradModel(device, 'LGrad.pth')

    root_path = '/home/jeff/api/AIGCDetectBenchmark/datasets/'
    images_path = glob.glob(os.path.join(root_path, '*'))

    print('folder', 'acc', 'r_acc', 'f_acc')
    for im_path in images_path:
        image_dataset = ImageDataset([im_path])

        y_pred = []
        y_true = []
        for image, label in image_dataset:
            out1 = model1.forward([image])
            out2 = model2.forward(out1)
            y_true.append(label)
            y_pred.append(out2[0][0])

        y_pred = np.array(y_pred)
        y_true = np.array(y_true)

        correct = np.sum(y_true == (y_pred > 0.5))
        acc = correct / len(y_true)

        f_acc = np.sum(y_pred[y_true == 1] > 0.5) / len(y_true[y_true == 1])
        r_acc = np.sum(y_pred[y_true == 0] < 0.5) / len(y_true[y_true == 0])

        foldername = os.path.basename(im_path)
        print(foldername, f'{acc:.3f}', f'{r_acc:.3f}', f'{f_acc:.3f}')


if __name__ == '__main__':
    main()
