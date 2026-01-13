# 🔍 SEO Validation Tools

Complete toolkit for validating URLs against technical SEO requirements. Supports the `seo-opportunities` audit workflow between SpaceCat and Mystique.

## 📋 What It Checks

All tools validate URLs against 5 technical SEO checks:

1. ✅ **HTTP Status** - Detects 4xx/5xx errors
2. ✅ **Redirect Chains** - Flags 2+ redirects  
3. ✅ **Canonical Issues** - Mismatched canonical URLs
4. ✅ **Noindex Directives** - Meta tags or headers blocking indexing
5. ✅ **Robots.txt Blocking** - Disallowed by robots.txt

---

## 🚀 Three Ways to Validate

### 1. 🌐 Web UI (Recommended)

**Best for:** Visual results, sharing with team, quick checks

```bash
# Start server
node test/dev/validator-server.mjs

# Open browser
http://localhost:3033
```

- Paste URLs → Validate → Export CSV/JSON
- Summary statistics
- Real-time results

---

### 2. 💻 CLI Tool

**Best for:** Automation, CI/CD, scripting

```bash
# Create input file
cat > urls.json << 'EOF'
[
  { "url": "https://example.com/page1" },
  { "url": "https://example.com/page2" }
]
EOF

# Run validation
node test/dev/validate-urls.mjs urls.json results.json
```

- Batch processing (100+ URLs)
- JSON input/output
- Perfect for automation

---

### 3. 🔌 Browser Extension

**Best for:** Smart URL parsing, any format

**Install:**
1. Chrome: `chrome://extensions/` → Developer mode → Load unpacked
2. Select `browser-extension/` folder
3. Click extension icon in toolbar

**Features:**
- **Smart parsing** - handles comma-separated, line-separated, bullets, quotes, mixed formats
- Export CSV/JSON with one click
- Copy clean URLs to clipboard
- Always accessible

📖 [Extension Details](browser-extension/README.md)

---

## 📊 Quick Examples

### Example 1: Check 10 URLs via Web UI

```bash
node test/dev/validator-server.mjs
# Open http://localhost:3033
# Paste URLs → Click "Check URLs"
# Download CSV
```

### Example 2: Batch Validation via CLI

```bash
node test/dev/validate-urls.mjs urls.json results.json

# Check summary
node -e "const d=require('./results.json'); console.log('Clean:', d.metadata.cleanUrls, 'Blocked:', d.metadata.blockedUrls)"
```

### Example 3: CI/CD Integration

```yaml
# .github/workflows/seo-check.yml
- run: node test/dev/validate-urls.mjs urls.json results.json
- run: |
    BLOCKED=$(node -e "console.log(require('./results.json').metadata.blockedUrls)")
    if [ "$BLOCKED" -gt "0" ]; then exit 1; fi
```

---

## 🎯 Use Cases

| Scenario | Tool | Workflow |
|----------|------|----------|
| Pre-publish check | Extension | Paste URLs → Validate → Fix issues |
| Site migration | CLI | Batch validate → Generate report |
| Daily monitoring | CLI + Cron | Automated checks → Email alerts |
| Quick audit | Web UI | Visual results → Export CSV |

---

## 🔧 Integration with SEO Opportunities Audit

These tools power the `seo-opportunities` audit validation step:

1. **Mystique** sends URLs to SpaceCat via SQS (`detect:seo-indexability`)
2. **SpaceCat** validates using `validators.js` (same logic as these tools)
3. **SpaceCat** returns `cleanUrls` and `blockedUrls` to Mystique
4. **Mystique** generates AI guidance only for clean URLs

📖 [Full Integration Details](src/seo-opportunities/README.md)

---

## 📁 File Structure

```
spacecat-audit-worker/
├── SEO_VALIDATION_TOOLS.md        # This file
│
├── src/
│   ├── seo-opportunities/         # Main audit
│   │   ├── handler.js             # Orchestration
│   │   └── README.md              # Integration docs
│   └── seo-indexability-check/    # Core validation
│       └── validators.js          # 5 checks logic
│
├── test/dev/                      # CLI & Web tools
│   ├── validate-urls.mjs          # CLI tool
│   ├── validator-server.mjs       # HTTP server
│   └── validator-ui.html          # Web interface
│
└── browser-extension/             # Chrome/Firefox extension
    ├── manifest.json              # Config
    ├── popup.html/js/css          # UI
    └── README.md                  # Install guide
```

---

## 🛠️ Troubleshooting

**"Port 3033 already in use"**  
Solution: `lsof -ti:3033 | xargs kill`

**"Module not found"**  
Solution: Run from `spacecat-audit-worker` directory

**"Extension won't load"**  
Solution: Icons must exist in `browser-extension/` folder

**"Network error"**  
Solution: Make sure server is running: `node test/dev/validator-server.mjs`

---

## 📊 Performance

- **CLI**: ~10 URLs/second (sequential)
- **Web/Extension**: 10 parallel requests (30-60s for 100 URLs)
- **Typical**: Real-time for <20 URLs, batch for 100+

---

## 🤝 Contributing

To add a new validation check:

1. Add function to `src/seo-indexability-check/validators.js`
2. Add to `validateUrl()` pipeline
3. Update documentation

---

## 📚 Related

- [SEO Opportunities Audit](src/seo-opportunities/README.md)
- [Validators Implementation](src/seo-indexability-check/validators.js)
- [Redirect Chains Audit](src/redirect-chains/handler.js)

---

**Built for SpaceCat SEO Opportunities Audit** | Apache License 2.0
