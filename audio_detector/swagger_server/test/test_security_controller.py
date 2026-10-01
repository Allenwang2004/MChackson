# coding: utf-8

from __future__ import absolute_import

from flask import json
from six import BytesIO

from swagger_server.test import BaseTestCase


class TestSecurityController(BaseTestCase):
    """SecurityController integration test stubs"""

    def test_main_generate_token(self):
        """Test case for main_generate_token

        Return JWT token
        """
        response = self.client.open(
            '/auth/{user_id}'.format(user_id=56),
            method='GET')
        self.assert200(response,
                       'Response body is : ' + response.data.decode('utf-8'))


if __name__ == '__main__':
    import unittest
    unittest.main()
