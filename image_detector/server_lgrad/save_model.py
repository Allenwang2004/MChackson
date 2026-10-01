import shutil

import bentoml


def main():
    with bentoml.models.create('lgrad_model:20240905') as model_ref:
        local_preprocess_path = model_ref.path_of('preprocess.pth')
        local_lgrad_path = model_ref.path_of('lgrad.pth')
        shutil.copyfile('./karras2019stylegan-bedrooms-256x256_discriminator.pth', local_preprocess_path)
        shutil.copyfile('./LGrad.pth', local_lgrad_path)


if __name__ == '__main__':
    main()

