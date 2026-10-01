import torch
import torch.nn as nn

# Define your model architecture (example)
class MyModel(nn.Module):
    def __init__(self):
        super(MyModel, self).__init__()
        # Define your layers here

    def forward(self, x):
        # Define forward pass here
        return x

# Instantiate the model
model = MyModel()

# Load the state dictionary
model.load_state_dict(torch.load("/Users/coconut/Downloads/LA_model.pth", map_location=torch.device('cpu')))

# Now you can export to ONNX
dummy_input = torch.randn(1, 3, 224, 224)  # Adjust this based on your input dimensions
torch.onnx.export(model, dummy_input, "model.onnx")