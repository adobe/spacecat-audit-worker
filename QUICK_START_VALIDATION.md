# 🚀 Quick Start: SEO Validation Tools

## 📥 Step 1: Get the Code

```bash
# Clone repo (if you don't have it)
git clone git@github.com:adobe/spacecat-audit-worker.git
cd spacecat-audit-worker

# Checkout the feature branch
git checkout feature/seo-validation-tools

# Install dependencies
npm install
```

---

## 🎯 Step 2: Choose Your Tool

### Option A: 🌐 Web UI (Easiest - Visual Interface)

```bash
# Start the server
node test/dev/validator-server.mjs
```

Then:
1. Open browser: **http://localhost:3033**
2. Paste URLs (one per line or comma-separated)
3. Click **"🚀 Check URLs"**
4. Download results as **CSV** or **JSON**

**Keep server running!** Press `Ctrl+C` to stop.

---

### Option B: 💻 CLI (Best for Automation)

```bash
# Create input file
cat > urls.json << 'EOF'
[
  { "url": "https://www.example.com/page1" },
  { "url": "https://www.example.com/page2" }
]
EOF

# Run validation
node test/dev/validate-urls.mjs urls.json results.json

# View results
cat results.json
```

**Output**: `results.json` with `cleanUrls` and `blockedUrls`

---

### Option C: 🔌 Browser Extension (Smart URL Parsing)

#### Step 1: Start the Server

```bash
node test/dev/validator-server.mjs
```

**Keep it running!** (The extension needs this)

#### Step 2: Install Extension

**Chrome:**
1. Open Chrome
2. Go to: `chrome://extensions/`
3. Toggle **"Developer mode"** ON (top right)
4. Click **"Load unpacked"**
5. Navigate to: `spacecat-audit-worker/browser-extension`
6. Click **"Select"** or **"Open"**

**Firefox:**
1. Open Firefox
2. Go to: `about:debugging#/runtime/this-firefox`
3. Click **"Load Temporary Add-on..."**
4. Navigate to: `spacecat-audit-worker/browser-extension`
5. Select **`manifest.json`**
6. Click **"Open"**

#### Step 3: Use Extension

1. Click the **extension icon** in your toolbar
2. Paste URLs in **any format**:
   ```
   https://example.com/page1
   https://example.com/page2, https://example.com/page3
   - https://example.com/page4
   ```
3. Click **"🚀 Validate URLs"**
4. View results and export:
   - 📥 **Download JSON**
   - 📊 **Download CSV**
   - 📋 **Copy Clean URLs**

---

## ✅ What Each Tool Checks

All tools validate 5 technical SEO checks:

1. ✅ **HTTP Status** - 4xx/5xx errors
2. ✅ **Redirect Chains** - 2+ redirects
3. ✅ **Canonical Issues** - Mismatched canonical URLs
4. ✅ **Noindex Directives** - Blocking meta tags/headers
5. ✅ **Robots.txt** - Crawl blocking

---

## 🎯 Quick Test

Test with these URLs:

```
https://www.cox.com/residential/internet.html
https://www.cox.com/residential/tv.html
https://www.cox.com/business/internet.html
```

**Expected Result**: All 3 should be ✅ clean!

---

## 🐛 Troubleshooting

**"Port 3033 already in use"**
```bash
lsof -ti:3033 | xargs kill
```

**"Extension won't load"**
- Make sure `icon*.png` files exist in `browser-extension/` folder

**"Connection failed" in Extension**
- Make sure server is running: `node test/dev/validator-server.mjs`

**"Module not found"**
- Run from `spacecat-audit-worker` directory
- Run `npm install`

---

## 📚 More Info

See **[SEO_VALIDATION_TOOLS.md](SEO_VALIDATION_TOOLS.md)** for:
- Use cases
- Integration details
- CI/CD examples
- Contributing guide

---

**That's it!** Pick your tool and start validating! 🎉

