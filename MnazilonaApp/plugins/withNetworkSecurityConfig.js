const { withAndroidManifest } = require("expo/config-plugins");
const { mkdirSync, writeFileSync } = require("fs");
const { resolve } = require("path");

// NOTE: To enable certificate pinning, replace YOUR_CERT_SHA256_HASH below
// with the actual SHA-256 hash of your server's TLS certificate public key.
// Generate it with: openssl s_client -connect api.mnazilona.com:443 | openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl enc -base64
// Once you have a domain name, also update the <domain> tag below.
const NETWORK_SECURITY_CONFIG_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
  <!-- Certificate pinning for API server (activate when using a domain name) -->
  <!--
  <domain-config>
    <domain includeSubdomains="true">api.mnazilona.com</domain>
    <pin-set expiration="2027-01-01">
      <pin digest="SHA-256">YOUR_CERT_SHA256_HASH</pin>
    </pin-set>
  </domain-config>
  -->
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">192.168.4.1</domain>
  </domain-config>
</network-security-config>`;

module.exports = function withNetworkSecurityConfig(config) {
  return withAndroidManifest(config, async (modConfig) => {
    const manifest = modConfig.modResults;

    // Write network_security_config.xml
    const resXmlDir = resolve(
      modConfig.modRequest.platformProjectRoot,
      "app/src/main/res/xml"
    );
    mkdirSync(resXmlDir, { recursive: true });
    writeFileSync(
      resolve(resXmlDir, "network_security_config.xml"),
      NETWORK_SECURITY_CONFIG_XML
    );

    // Add networkSecurityConfig to <application>
    const app = manifest.manifest.application?.[0];
    if (app) {
      app.$["android:networkSecurityConfig"] =
        "@xml/network_security_config";
      // Remove usesCleartextTraffic since networkSecurityConfig takes precedence
      delete app.$["android:usesCleartextTraffic"];
    }

    return modConfig;
  });
};
