import ssl

# Where the major Linux distributions keep their CA bundle. SteamOS is Arch-based
# and uses the first one; the rest are here so the same plugin works elsewhere.
CA_BUNDLE_PATHS = (
    "/etc/ssl/cert.pem",
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/ca-bundle.pem",
)


def verifying_ssl_context() -> ssl.SSLContext:
    """A verifying SSL context, with the trust store pointed at a real CA bundle.

    Decky Loader runs plugins under a PyInstaller-bundled Python whose OpenSSL was
    compiled on a Debian-style system and looks for certificates under
    /usr/lib/ssl. SteamOS is Arch-based, so that directory does not exist, the
    default context ends up trusting nobody, and every fetch fails with
    "CERTIFICATE_VERIFY_FAILED: unable to get local issuer certificate".

    So: build the normal verifying context, and only when it came up with no
    certificates at all, load a CA bundle from a known location. Verification
    stays on - this fixes where the trusted roots are read from, not whether
    they are checked. An expired, self-signed or hostname-mismatched certificate
    still fails, exactly as before.
    """
    context = ssl.create_default_context()
    if context.get_ca_certs():
        return context
    for path in CA_BUNDLE_PATHS:
        try:
            context.load_verify_locations(cafile=path)
        except (OSError, ssl.SSLError):
            continue
        if context.get_ca_certs():
            return context
    return context
