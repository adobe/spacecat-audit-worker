### Enforce Content Security Policy: strict-dynamic + (cached) nonce

The following changes are suggested to enhance the Content Security Policy (CSP) of your web pages. Implementing these changes will help improve the security posture of your application by enforcing stricter CSP rules.

For more information on Content Security Policy and best practices, please refer to the [AEM documentation](https://www.aem.live/docs/csp-strict-dynamic-cached-nonce).

#### Suggested Changes:
- **Page:** 404.html
  - Add nonces to all inline `<script>` tags to enhance script security.
  - Add a CSP meta tag to enforce a strict Content Security Policy.