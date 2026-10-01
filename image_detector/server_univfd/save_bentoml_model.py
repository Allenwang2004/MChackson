import bentoml
import onnx


def main():
    model = onnx.load_model("../univfd/univfd_model_20240814.onnx")

    bentoml.onnx.save_model(
        "univfd_model:20240814",
        model,
        signatures={"run": {"batchable": True}},
    )

    pass


if __name__ == "__main__":
    main()
