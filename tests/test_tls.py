import ssl
import unittest
from unittest.mock import patch

from backend import tls


class VerifyingContextTests(unittest.TestCase):
    def test_default_context_is_used_when_it_trusts_something(self):
        # The normal path on a machine whose OpenSSL finds its own CAs.
        with patch.object(tls.ssl, "create_default_context") as create:
            create.return_value.get_ca_certs.return_value = [{"x": "cert"}]
            context = tls.verifying_ssl_context()
        self.assertIs(context, create.return_value)
        create.return_value.load_verify_locations.assert_not_called()

    def test_falls_back_to_a_ca_bundle_when_the_default_trusts_nothing(self):
        # Decky Loader's bundled OpenSSL points at a Debian cert dir that does not
        # exist on SteamOS, so the default context trusts nobody.
        with patch.object(tls.ssl, "create_default_context") as create, patch.object(tls, "CA_BUNDLE_PATHS", ("/nope/missing.pem", "/etc/ssl/cert.pem")):
            create.return_value.get_ca_certs.side_effect = [[], [{"x": "cert"}]]
            create.return_value.load_verify_locations.side_effect = [FileNotFoundError(), None]
            context = tls.verifying_ssl_context()
        create.return_value.load_verify_locations.assert_called_with(cafile="/etc/ssl/cert.pem")
        self.assertIs(context, create.return_value)

    def test_skips_missing_bundles_and_tolerates_a_load_error(self):
        with patch.object(tls.ssl, "create_default_context") as create, patch.object(tls, "CA_BUNDLE_PATHS", ("/a.pem", "/b.pem", "/c.pem")):
            create.return_value.get_ca_certs.side_effect = [[], [], [], [{"x": "cert"}]]
            create.return_value.load_verify_locations.side_effect = [FileNotFoundError(), ssl.SSLError("bad"), None]
            tls.verifying_ssl_context()
        self.assertEqual(create.return_value.load_verify_locations.call_count, 3)

    def test_returns_the_bare_context_when_no_bundle_helps(self):
        # Still the plain verifying context, just with no roots: better to fail loudly
        # on every fetch than to quietly accept any certificate.
        with patch.object(tls.ssl, "create_default_context") as create, patch.object(tls, "CA_BUNDLE_PATHS", ("/a.pem", "/b.pem")):
            create.return_value.get_ca_certs.return_value = []
            create.return_value.load_verify_locations.side_effect = [FileNotFoundError(), OSError("denied")]
            context = tls.verifying_ssl_context()
        self.assertIs(context, create.return_value)
        self.assertEqual(create.return_value.load_verify_locations.call_count, 2)

    def test_real_context_still_verifies(self):
        # Belt and braces on the actual machine: the returned context must reject a
        # certificate for the wrong hostname rather than trusting anything.
        context = tls.verifying_ssl_context()
        self.assertIs(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)


if __name__ == "__main__":
    unittest.main()
