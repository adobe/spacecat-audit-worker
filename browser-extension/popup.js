let validationResults = null;
let currentTab = 'all';

// Parse URLs from any format
function parseUrls(text) {
  // Remove common prefixes and formatting
  text = text
    .replace(/^[-•*]\s*/gm, '') // Remove bullet points
    .replace(/["']/g, '') // Remove quotes
    .replace(/,/g, '\n') // Convert commas to newlines
    .replace(/\s+/g, '\n'); // Normalize whitespace to newlines
  
  // Extract URLs using regex
  const urlRegex = /https?:\/\/[^\s\n]+/g;
  const urls = text.match(urlRegex) || [];
  
  // Deduplicate and clean
  return [...new Set(urls)].map(url => url.trim()).filter(url => url.length > 0);
}

// Show status message
function showStatus(message, type = 'info') {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

// Hide status
function hideStatus() {
  document.getElementById('status').classList.add('hidden');
}

// Validate URLs
async function validateUrls() {
  const textarea = document.getElementById('urls');
  const text = textarea.value;
  
  if (!text.trim()) {
    showStatus('⚠️ Please enter at least one URL', 'error');
    return;
  }
  
  const urls = parseUrls(text);
  
  if (urls.length === 0) {
    showStatus('⚠️ No valid URLs found', 'error');
    return;
  }
  
  // Disable button
  const validateBtn = document.getElementById('validateBtn');
  validateBtn.disabled = true;
  validateBtn.textContent = `⏳ Validating ${urls.length} URLs...`;
  
  showStatus(`🔍 Validating ${urls.length} URLs...`, 'info');
  
  try {
    const serverUrl = document.getElementById('serverUrl').value;
    const response = await fetch(`${serverUrl}/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ urls }),
    });
    
    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }
    
    validationResults = await response.json();
    displayResults(validationResults);
    showStatus(`✅ Validation complete! ${validationResults.metadata.cleanUrls} clean, ${validationResults.metadata.blockedUrls} blocked`, 'success');
    
  } catch (error) {
    console.error('Validation error:', error);
    showStatus(`❌ Error: ${error.message}. Make sure the validator server is running.`, 'error');
  } finally {
    validateBtn.disabled = false;
    validateBtn.textContent = '🚀 Validate URLs';
  }
}

// Display results
function displayResults(data) {
  const resultsEl = document.getElementById('results');
  resultsEl.classList.remove('hidden');
  
  // Update summary
  const total = data.metadata.totalUrls;
  const clean = data.metadata.cleanUrls;
  const blocked = data.metadata.blockedUrls;
  const percentage = total > 0 ? Math.round((clean / total) * 100) : 0;
  
  document.getElementById('summary').innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${total}</div>
      <div class="stat-label">Total</div>
    </div>
    <div class="stat-card success">
      <div class="stat-value">${clean}</div>
      <div class="stat-label">Clean (${percentage}%)</div>
    </div>
    <div class="stat-card error">
      <div class="stat-value">${blocked}</div>
      <div class="stat-label">Blocked (${100-percentage}%)</div>
    </div>
  `;
  
  // Update tab counts
  document.querySelector('[data-tab="all"]').textContent = `All (${total})`;
  document.querySelector('[data-tab="clean"]').textContent = `Clean (${clean})`;
  document.querySelector('[data-tab="blocked"]').textContent = `Blocked (${blocked})`;
  
  // Display URL list
  displayUrlList(currentTab);
}

// Display URL list based on current tab
function displayUrlList(tab) {
  if (!validationResults) return;
  
  const urlListEl = document.getElementById('urlList');
  let urls = [];
  
  if (tab === 'all') {
    urls = [...validationResults.cleanUrls, ...validationResults.blockedUrls];
  } else if (tab === 'clean') {
    urls = validationResults.cleanUrls;
  } else if (tab === 'blocked') {
    urls = validationResults.blockedUrls;
  }
  
  if (urls.length === 0) {
    urlListEl.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No URLs to display</p>';
    return;
  }
  
  urlListEl.innerHTML = urls.map(url => {
    const isClean = url.indexable;
    const icon = isClean ? '✅' : '❌';
    
    return `
      <div class="url-item ${isClean ? 'clean' : 'blocked'}">
        <div class="url-header">
          <span class="status-icon">${icon}</span>
          <span class="url-text">${url.url}</span>
        </div>
        <div class="url-checks">
          ${renderCheck('HTTP', url.checks.httpStatus)}
          ${renderCheck('Redirects', url.checks.redirects)}
          ${renderCheck('Canonical', url.checks.canonical)}
          ${renderCheck('Noindex', url.checks.noindex)}
          ${renderCheck('Robots', url.checks.robotsTxt)}
        </div>
        ${url.blockers.length > 0 ? `
          <div style="margin-top: 6px; padding: 4px 6px; background: #fff5f5; border-radius: 3px; font-size: 10px; color: #c62828;">
            ⚠️ ${url.blockers.join(', ')}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

// Render check badge
function renderCheck(label, check) {
  const passed = check.passed;
  return `<span class="check-badge ${passed ? '' : 'fail'}">${passed ? '✓' : '✗'} ${label}</span>`;
}

// Export as JSON
function exportJson() {
  if (!validationResults) return;
  
  const dataStr = JSON.stringify(validationResults, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `seo-validation-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  
  showStatus('✅ JSON file downloaded!', 'success');
  setTimeout(hideStatus, 2000);
}

// Export as CSV
function exportCsv() {
  if (!validationResults) return;
  
  const allUrls = [...validationResults.cleanUrls, ...validationResults.blockedUrls];
  const csv = [
    ['URL', 'Indexable', 'HTTP Status', 'Redirects', 'Canonical', 'Noindex', 'Robots.txt', 'Blockers'],
    ...allUrls.map(url => [
      url.url,
      url.indexable ? 'Yes' : 'No',
      url.checks.httpStatus.passed ? 'Pass' : 'Fail',
      url.checks.redirects.passed ? 'Pass' : 'Fail',
      url.checks.canonical.passed ? 'Pass' : 'Fail',
      url.checks.noindex.passed ? 'Pass' : 'Fail',
      url.checks.robotsTxt.passed ? 'Pass' : 'Fail',
      url.blockers.join('; '),
    ]),
  ].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
  
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `seo-validation-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  
  showStatus('✅ CSV file downloaded!', 'success');
  setTimeout(hideStatus, 2000);
}

// Copy clean URLs
function copyCleanUrls() {
  if (!validationResults) return;
  
  const cleanUrls = validationResults.cleanUrls.map(item => item.url).join('\n');
  
  navigator.clipboard.writeText(cleanUrls).then(() => {
    showStatus(`✅ ${validationResults.cleanUrls.length} clean URLs copied to clipboard!`, 'success');
    setTimeout(hideStatus, 2000);
  }).catch(err => {
    showStatus('❌ Failed to copy to clipboard', 'error');
    console.error('Copy error:', err);
  });
}

// Clear form
function clearForm() {
  document.getElementById('urls').value = '';
  document.getElementById('results').classList.add('hidden');
  hideStatus();
  validationResults = null;
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('validateBtn').addEventListener('click', validateUrls);
  document.getElementById('clearBtn').addEventListener('click', clearForm);
  document.getElementById('exportJson').addEventListener('click', exportJson);
  document.getElementById('exportCsv').addEventListener('click', exportCsv);
  document.getElementById('copyUrls').addEventListener('click', copyCleanUrls);
  
  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      displayUrlList(currentTab);
    });
  });
  
  // Toggle server URL input
  document.getElementById('useLocalhost').addEventListener('change', (e) => {
    const serverUrlInput = document.getElementById('serverUrl');
    if (e.target.checked) {
      serverUrlInput.value = 'http://localhost:3033';
    }
  });
  
  // Allow Enter key in textarea to validate
  document.getElementById('urls').addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      validateUrls();
    }
  });
});

