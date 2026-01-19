### Enforce Content Security Policy: strict-dynamic + (cached) nonce

The following changes are suggested to enhance the Content Security Policy (CSP) of your web pages. Implementing these changes will help improve the security posture of your application by enforcing stricter CSP rules.

#### Suggested Changes:
- **Page:** head.html
  - Update the CSP meta tag to include `move-to-http-header="true"` attribute for better security management.