# 🔌 SEO Validator Browser Extension

Chrome/Firefox extension for validating URLs with smart parsing and easy export.

## ✨ Key Feature

**Smart URL Parsing** - Paste URLs in ANY format:
```
https://example.com/page1
https://example.com/page2, https://example.com/page3
- https://example.com/page4
• https://example.com/page5
"https://example.com/page6"
```

All formats work! The extension extracts and validates all URLs automatically.

---

## 📦 Installation

### Step 1: Start Server

```bash
cd spacecat-audit-worker
node test/dev/validator-server.mjs
```

Server starts at `http://localhost:3033` (keep it running)

### Step 2: Install Extension

**Chrome:**
1. Go to `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select this `browser-extension` folder

**Firefox:**
1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `manifest.json` from this folder

---

## 🚀 Usage

1. **Click** extension icon in toolbar
2. **Paste** URLs (any format - mixed is fine!)
3. **Click** "🚀 Validate URLs"
4. **View** results in tabs (All / Clean / Blocked)
5. **Export:**
   - 📥 Download JSON (full data)
   - 📊 Download CSV (spreadsheet)
   - 📋 Copy Clean URLs (clipboard)

---

## 🎯 Example

```
Input:
https://example.com/page1, https://example.com/page2
- https://example.com/page3

Result:
✅ 2 Clean URLs
❌ 1 Blocked (noindex)

Export → CSV for team
```

---

## ⚙️ Settings

**Server URL:** Default is `localhost:3033`

To use different server:
1. Uncheck "Use local server"
2. Enter custom URL
3. Validate

---

## 🐛 Troubleshooting

**"Connection failed"**  
→ Make sure server is running: `node test/dev/validator-server.mjs`

**"No valid URLs found"**  
→ URLs must start with `http://` or `https://`

**Extension won't load**  
→ Make sure `icon*.png` files exist in this folder

---

## 📚 More Info

See [SEO_VALIDATION_TOOLS.md](../SEO_VALIDATION_TOOLS.md) for:
- CLI tool usage
- Web UI details
- Integration with SpaceCat

---

**License:** Apache 2.0 | Part of SpaceCat Audit Worker
