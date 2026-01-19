### Enforce Content Security Policy: strict-dynamic + (cached) nonce

The following changes are suggested to enhance the Content Security Policy (CSP) of your web pages. Implementing these changes will help improve the security posture of your application by enforcing stricter CSP rules.

#### Suggested Changes:
- **Page:** head.html
  - Add nonces to all inline `<script>` tags to enhance script security.
  - Add a CSP meta tag to enforce a strict Content Security Policy.

- **Page:** 404.html
  - Add nonces to all inline `<script>` tags to enhance script security.
  - Add a CSP meta tag to enforce a strict Content Security Policy.