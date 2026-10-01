import connexion
import six
from swagger_server import util
import time
import jwt
from werkzeug.exceptions import Unauthorized

JWT_ISSUER = 'com.zalando.connexion'
JWT_SECRET = '64832168'
JWT_LIFETIME_SECONDS = 600
JWT_ALGORITHM = 'HS256'

#def decode_token(token):
#    try:
#        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
#    except JWTError as e:
#        six.raise_from(Unauthorized, e)
        
def _current_timestamp() -> int:
    return int(time.time())        

def main_generate_token(user_id):  # noqa: E501
    """Return JWT token

     # noqa: E501

    :param user_id: User unique identifier
    :type user_id: int

    :rtype: str
    """
    timestamp = _current_timestamp()
    payload = {
        "iss": JWT_ISSUER,
        "iat": int(timestamp),
        "exp": int(timestamp + JWT_LIFETIME_SECONDS),
        "sub": str(user_id),
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return token


def main_get_secret():  # noqa: E501
    """Return secret string

     # noqa: E501


    :rtype: str
    """
    return '''
    You are user_id {user} and the secret is 'wbevuec'.
    Decoded token claims: {token_info}.
    '''.format(user=user, token_info=token_info)