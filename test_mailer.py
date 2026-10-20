"""Offline checks for privacy and retry behavior of transactional mail."""

import json
import os
import unittest
from unittest.mock import patch

from mailer import send_update_email


class _Response:
    def __init__(self, status, body=b'{}', retry_after=None):
        self.status = status
        self.body = body
        self.retry_after = retry_after

    def getheader(self, name):
        return self.retry_after if name == "Retry-After" else None

    def read(self, count):
        return self.body[:count]


class _Connection:
    responses = []
    requests = []

    def __init__(self, host, timeout, context):
        self.host = host
        self.timeout = timeout

    def request(self, method, path, body, headers):
        self.requests.append((method, path, body, headers))

    def getresponse(self):
        return self.responses.pop(0)

    def close(self):
        pass


class MailerTests(unittest.TestCase):
    def setUp(self):
        _Connection.responses = []
        _Connection.requests = []
        self.settings = patch.dict(
            os.environ,
            {"RESEND_API_KEY": "re_test_validtoken", "PH_EMAIL_FROM": "updates@example.com"},
        )
        self.transport = patch("mailer.http.client.HTTPSConnection", _Connection)
        self.settings.start()
        self.transport.start()
        self.addCleanup(self.settings.stop)
        self.addCleanup(self.transport.stop)

    def test_accepted_mail_contains_only_generic_update_and_stable_key(self):
        _Connection.responses = [_Response(200, b'{"id":"email_1"}'), _Response(200, b'{"id":"email_1"}')]
        first = send_update_email("student@gmail.com", event_id="invoice-123")
        second = send_update_email("student@gmail.com", event_id="invoice-123")
        self.assertTrue(first.sent)
        self.assertEqual(first.provider_id, "email_1")
        self.assertTrue(second.sent)
        self.assertEqual(len(_Connection.requests), 2)
        keys = [request[3]["Idempotency-Key"] for request in _Connection.requests]
        self.assertEqual(keys[0], keys[1])
        self.assertNotIn("invoice-123", keys[0])
        payload = json.loads(_Connection.requests[0][2])
        self.assertEqual(payload["to"], ["student@gmail.com"])
        self.assertNotIn("123", payload["text"])
        self.assertNotIn("student@gmail.com", payload["text"])

    def test_rate_limit_is_retryable_without_exposing_provider_response(self):
        _Connection.responses = [_Response(429, b'{"error":"private detail"}', "30")]
        result = send_update_email("teacher@gmail.com", event_id="event-1")
        self.assertFalse(result.sent)
        self.assertTrue(result.retryable)
        self.assertEqual(result.retry_after_seconds, 30)
        self.assertNotIn("private detail", str(result))

    def test_invalid_address_or_unconfigured_mail_sends_nothing(self):
        self.assertEqual(send_update_email("bad\n@example.com", event_id="x").code, "invalid_recipient")
        with patch.dict(os.environ, {"RESEND_API_KEY": ""}):
            self.assertEqual(send_update_email("student@gmail.com", event_id="x").code, "not_configured")
        self.assertEqual(_Connection.requests, [])


if __name__ == "__main__":
    unittest.main()
