#!/usr/bin/env python3

import connexion
from swagger_server import encoder

def main():
    app = connexion.App(__name__, specification_dir='./swagger/')
    app.json_encoder = encoder.CustomJSONEncoder
    app.add_api('swagger.yaml', arguments={'title': 'Spoof Detect System Specifications Description'}, pythonic_params=True)

    return(app)


#if __name__ == '__main__':
#    main()
