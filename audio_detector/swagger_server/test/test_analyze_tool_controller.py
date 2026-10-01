# coding: utf-8

from __future__ import absolute_import

from flask import json
from six import BytesIO

from swagger_server.models.model200_response import Model200Response  # noqa: E501
from swagger_server.models.model400_error_response import Model400ErrorResponse  # noqa: E501
from swagger_server.models.model401_error_response import Model401ErrorResponse  # noqa: E501
from swagger_server.models.model403_error_response import Model403ErrorResponse  # noqa: E501
from swagger_server.models.model500_error_response import Model500ErrorResponse  # noqa: E501
from swagger_server.models.spoof_detector_body import SpoofDetectorBody  # noqa: E501
from swagger_server.test import BaseTestCase


class TestAnalyzeToolController(BaseTestCase):
    """AnalyzeToolController integration test stubs"""

    def test_spoof_detector(self):
        """Test case for spoof_detector

        detect events from audio data
        """
        body = SpoofDetectorBody()
        response = self.client.open(
            '/spoof_detector',
            method='POST',
            data=json.dumps(body),
            content_type='application/json')
        self.assert200(response,
                       'Response body is : ' + response.data.decode('utf-8'))


if __name__ == '__main__':
    import unittest
    unittest.main()
