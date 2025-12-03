const express = require('express');
const axios = require('axios');
const app = express();
const cookieParser = require('cookie-parser');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;

const PORT = process.env.PORT || 10000;

// Configure multer for file uploads through proxy
const upload = multer({ storage: multer.memoryStorage() });

// Session configuration
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'voidchat-render-proxy-secret-2024',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Home backend IP storage (per session)
function getHomeBackendIP(req) {
  return req.session.homeBackendIP;
}

function setHomeBackendIP(req, ip) {
  req.session.homeBackendIP = ip;
  req.session.save();
}

// Helper to make requests to home backend
async function makeRequestToHomeBackend(req, endpoint, options = {}) {
  const homeBackendIP = getHomeBackendIP(req);
  
  if (!homeBackendIP) {
    throw new Error('Home backend not configured');
  }

  let targetUrl = homeBackendIP.trim();
  if (!targetUrl.startsWith('http')) {
    targetUrl = `http://${targetUrl}`;
  }
  
  targetUrl = targetUrl.replace(/\/$/, '');
  const fullUrl = `${targetUrl}${endpoint}`;
  
  console.log(`Proxying to: ${fullUrl}`);
  
  const config = {
    method: req.method,
    url: fullUrl,
    headers: {
      ...req.headers,
      'host': new URL(targetUrl).host,
      'origin': targetUrl,
      'referer': targetUrl,
      'authorization': req.headers.authorization || req.query.session || ''
    },
    timeout: 15000,
    validateStatus: () => true
  };

  // Handle request body
  if (req.body && Object.keys(req.body).length > 0) {
    config.data = req.body;
    if (!config.headers['content-type']) {
      config.headers['content-type'] = 'application/json';
    }
  }

  // Handle query parameters
  if (req.query && Object.keys(req.query).length > 0) {
    config.params = req.query;
  }

  // Handle file uploads
  if (req.file) {
    const FormData = require('form-data');
    const formData = new FormData();
    
    // Add file
    formData.append('image', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });
    
    // Add other fields
    Object.keys(req.body).forEach(key => {
      formData.append(key, req.body[key]);
    });
    
    config.data = formData;
    config.headers = {
      ...config.headers,
      ...formData.getHeaders()
    };
  }

  try {
    const response = await axios(config);
    return response;
  } catch (error) {
    console.error('Request to home backend failed:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Connection refused to home backend');
    }
    
    if (error.code === 'ENOTFOUND') {
      throw new Error('Home backend host not found');
    }
    
    if (error.code === 'ETIMEDOUT') {
      throw new Error('Connection to home backend timed out');
    }
    
    throw error;
  }
}

// Configuration page
app.get('/config', (req, res) => {
  const currentIP = getHomeBackendIP(req);
  
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VoidChat - Configure Home Backend</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%);
            color: white;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .config-container {
            background: rgba(45, 45, 45, 0.8);
            border-radius: 16px;
            padding: 40px;
            width: 100%;
            max-width: 500px;
            border: 1px solid #333;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            backdrop-filter: blur(10px);
        }
        h1 {
            text-align: center;
            margin-bottom: 10px;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            font-size: 2rem;
        }
        .subtitle {
            text-align: center;
            color: #a0a0a0;
            margin-bottom: 30px;
            font-size: 0.9rem;
        }
        .form-group { margin-bottom: 20px; }
        label {
            display: block;
            margin-bottom: 8px;
            color: #a0a0a0;
            font-weight: 500;
        }
        input {
            width: 100%;
            padding: 14px;
            background: rgba(255, 255, 255, 0.1);
            border: 2px solid #333;
            border-radius: 10px;
            color: white;
            font-size: 16px;
            transition: all 0.3s;
        }
        input:focus {
            outline: none;
            border-color: #6366f1;
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }
        .examples {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
            border-left: 4px solid #6366f1;
        }
        .examples h3 {
            color: #6366f1;
            margin-bottom: 10px;
            font-size: 1rem;
        }
        .examples ul {
            list-style: none;
            color: #a0a0a0;
        }
        .examples li {
            margin: 5px 0;
            padding-left: 20px;
            position: relative;
        }
        .examples li:before {
            content: "•";
            color: #6366f1;
            position: absolute;
            left: 0;
        }
        .instructions {
            background: rgba(255, 193, 7, 0.1);
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
            border-left: 4px solid #ffc107;
        }
        .instructions h3 {
            color: #ffc107;
            margin-bottom: 10px;
            font-size: 1rem;
        }
        .instructions p {
            color: #ffc107;
            font-size: 0.9rem;
            line-height: 1.5;
        }
        .btn {
            width: 100%;
            padding: 14px;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
        }
        .btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 6px 16px rgba(99, 102, 241, 0.4);
        }
        .current-ip {
            margin-top: 20px;
            padding: 10px;
            background: rgba(16, 185, 129, 0.1);
            border-radius: 8px;
            border-left: 4px solid #10b981;
            color: #10b981;
            text-align: center;
        }
        .status {
            text-align: center;
            padding: 10px;
            border-radius: 8px;
            margin-bottom: 20px;
            display: none;
        }
        .status.success {
            background: rgba(16, 185, 129, 0.1);
            border: 1px solid #10b981;
            color: #10b981;
        }
        .status.error {
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid #ef4444;
            color: #ef4444;
        }
        .link {
            text-align: center;
            margin-top: 20px;
            color: #a0a0a0;
        }
        .link a {
            color: #6366f1;
            text-decoration: none;
        }
        .link a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="config-container">
        <h1>VoidChat</h1>
        <div class="subtitle">Connect to your Home Backend</div>
        
        <div id="statusMessage" class="status"></div>
        
        <form id="configForm">
            <div class="form-group">
                <label for="homeBackendIP">Your Home Backend Address</label>
                <input 
                    type="text" 
                    id="homeBackendIP" 
                    placeholder="e.g., 192.168.1.100:8080 or yourdomain.com"
                    value="${currentIP || ''}"
                    required>
            </div>
            
            <div class="examples">
                <h3>Examples:</h3>
                <ul>
                    <li>Local IP: 192.168.1.100:8080</li>
                    <li>Public IP: 123.456.78.90:8080</li>
                    <li>ngrok: https://abc123.ngrok.io</li>
                    <li>Domain: yourdomain.com:8080</li>
                </ul>
            </div>
            
            <div class="instructions">
                <h3>How to get this:</h3>
                <p>1. Run your home backend on your local machine<br>
                   2. Use port forwarding on your router OR<br>
                   3. Use ngrok: <code>ngrok http 8080</code><br>
                   4. Enter the address shown above</p>
            </div>
            
            <button type="submit" class="btn">Connect to Home Backend</button>
        </form>
        
        ${currentIP ? `
        <div class="current-ip">
            Currently connected to: <strong>${currentIP}</strong>
        </div>
        ` : ''}
        
        <div class="link">
            Already configured? <a href="/">Go to VoidChat</a>
        </div>
    </div>

    <script>
        const form = document.getElementById('configForm');
        const statusMessage = document.getElementById('statusMessage');
        
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const ip = document.getElementById('homeBackendIP').value.trim();
            if (!ip) {
                showError('Please enter your home backend address');
                return;
            }
            
            try {
                showStatus('Testing connection...', 'info');
                
                const response = await fetch('/api/set-backend', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ip })
                });
                
                if (response.ok) {
                    showSuccess('Configuration saved! Redirecting...');
                    setTimeout(() => {
                        window.location.href = '/';
                    }, 1500);
                } else {
                    const data = await response.json();
                    showError(data.error || 'Failed to save configuration');
                }
                
            } catch (error) {
                console.error('Error:', error);
                showError('Network error. Please try again.');
            }
        });
        
        function showStatus(message, type) {
            statusMessage.textContent = message;
            statusMessage.className = 'status';
            statusMessage.style.display = 'block';
            
            if (type === 'error') {
                statusMessage.classList.add('error');
            } else if (type === 'success') {
                statusMessage.classList.add('success');
            }
        }
        
        function showSuccess(message) {
            showStatus(message, 'success');
        }
        
        function showError(message) {
            showStatus(message, 'error');
        }
    </script>
</body>
</html>
  `);
});

// API to set home backend IP
app.post('/api/set-backend', async (req, res) => {
  const { ip } = req.body;
  
  if (!ip) {
    return res.status(400).json({ error: 'IP is required' });
  }
  
  // Test the connection first
  try {
    let testUrl = ip.trim();
    if (!testUrl.startsWith('http')) {
      testUrl = `http://${testUrl}`;
    }
    
    const testResponse = await axios.get(`${testUrl}/api/health`, {
      timeout: 10000
    });
    
    if (testResponse.data.status === 'ok') {
      setHomeBackendIP(req, ip);
      return res.json({ 
        success: true, 
        message: 'Backend connected successfully',
        backendInfo: testResponse.data
      });
    } else {
      return res.status(400).json({ 
        error: 'Invalid backend response',
        message: 'The backend responded but with an unexpected format'
      });
    }
  } catch (error) {
    console.error('Backend test failed:', error.message);
    
    // Still allow saving even if test fails (user might be offline)
    setHomeBackendIP(req, ip);
    
    return res.json({ 
      success: true, 
      message: 'Backend saved but could not verify connection. You can still try.',
      warning: 'Could not verify backend connection: ' + error.message
    });
  }
});

// Main VoidChat application
app.get('/', async (req, res) => {
  const homeBackendIP = getHomeBackendIP(req);
  
  if (!homeBackendIP) {
    return res.redirect('/config');
  }
  
  // Send the complete VoidChat HTML with integrated frontend
  res.send(getVoidChatHTML(homeBackendIP));
});

// Function to generate the complete VoidChat HTML
function getVoidChatHTML(homeBackendIP) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VoidChat</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg-primary: #0f0f0f; --bg-secondary: #1a1a1a; --bg-tertiary: #2d2d2d;
      --text-primary: #ffffff; --text-secondary: #a0a0a0; --accent: #6366f1;
      --accent-hover: #5b5cf0; --danger: #ef4444; --success: #10b981;
      --warning: #f59e0b; --border: #333333; --shadow: 0 8px 32px rgba(0,0,0,0.3);
    }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      background: var(--bg-primary); 
      color: var(--text-primary); 
      height: 100vh; 
      overflow: hidden; 
    }
    
    /* Configuration banner */
    .config-banner {
      background: var(--bg-tertiary);
      padding: 10px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 14px;
      height: 50px;
    }
    
    .config-info {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .config-ip {
      color: var(--success);
      font-family: monospace;
      background: rgba(16, 185, 129, 0.1);
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
    }
    
    .config-btn {
      background: var(--accent);
      color: white;
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    
    .config-btn:hover {
      background: var(--accent-hover);
    }
    
    /* Auth Container */
    .auth-container { 
      min-height: calc(100vh - 50px); 
      background: linear-gradient(135deg, #000000 0%, #1a1a1a 100%); 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      padding: 20px; 
    }
    .auth-box { 
      background: var(--bg-secondary); 
      border-radius: 16px; 
      box-shadow: var(--shadow); 
      padding: 40px; 
      width: 100%; 
      max-width: 420px; 
      border: 1px solid var(--border); 
    }
    .auth-box h1 { 
      text-align: center; 
      margin-bottom: 30px; 
      color: var(--text-primary); 
      font-size: 2rem; 
      background: linear-gradient(135deg, var(--accent), #8b5cf6); 
      -webkit-background-clip: text; 
      -webkit-text-fill-color: transparent; 
    }
    .auth-tabs { 
      display: flex; 
      gap: 8px; 
      margin-bottom: 30px; 
      background: var(--bg-tertiary); 
      padding: 4px; 
      border-radius: 12px; 
    }
    .auth-tabs button { 
      flex: 1; 
      padding: 12px; 
      border: none; 
      background: transparent; 
      color: var(--text-secondary); 
      font-weight: 600; 
      border-radius: 8px; 
      cursor: pointer; 
      transition: all 0.3s ease; 
    }
    .auth-tabs button.active { 
      background: var(--accent); 
      color: white; 
      box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3); 
    }
    .input-group { 
      margin-bottom: 20px; 
    }
    .input-group label { 
      display: block; 
      margin-bottom: 8px; 
      color: var(--text-secondary); 
      font-weight: 500; 
      font-size: 14px; 
    }
    .input-group input, .input-group textarea { 
      width: 100%; 
      padding: 14px; 
      background: var(--bg-tertiary); 
      border: 2px solid var(--border); 
      border-radius: 10px; 
      font-size: 16px; 
      color: var(--text-primary); 
      transition: all 0.3s ease; 
      resize: vertical; 
    }
    .input-group input:focus, .input-group textarea:focus { 
      outline: none; 
      border-color: var(--accent); 
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1); 
    }
    .error-msg { 
      color: var(--danger); 
      text-align: center; 
      margin-bottom: 15px; 
      font-size: 14px; 
      padding: 10px; 
      background: rgba(239, 68, 68, 0.1); 
      border-radius: 8px; 
    }
    .success-msg { 
      color: var(--success); 
      text-align: center; 
      margin-bottom: 15px; 
      font-size: 14px; 
      padding: 10px; 
      background: rgba(16, 185, 129, 0.1); 
      border-radius: 8px; 
    }
    .auth-btn { 
      width: 100%; 
      padding: 14px; 
      background: var(--accent); 
      color: white; 
      border: none; 
      border-radius: 10px; 
      font-size: 16px; 
      font-weight: 600; 
      cursor: pointer; 
      transition: all 0.3s ease; 
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3); 
    }
    .auth-btn:hover { 
      background: var(--accent-hover); 
      transform: translateY(-1px); 
      box-shadow: 0 6px 16px rgba(99, 102, 241, 0.4); 
    }
    .auth-btn:disabled { 
      opacity: 0.6; 
      cursor: not-allowed; 
      transform: none; 
    }
    .tip { 
      text-align: center; 
      margin-top: 20px; 
      font-size: 12px; 
      color: var(--text-secondary); 
    }
    .verification-section { 
      display: none; 
    }
    
    /* App Container */
    .app-container { 
      display: none; 
      height: calc(100vh - 50px); 
    }
    .app-container.active { 
      display: flex; 
    }
    
    /* Sidebar */
    .sidebar { 
      width: 300px; 
      background: var(--bg-secondary); 
      border-right: 1px solid var(--border); 
      display: flex; 
      flex-direction: column; 
    }
    .sidebar-header { 
      padding: 20px; 
      border-bottom: 1px solid var(--border); 
      display: flex; 
      align-items: center; 
      gap: 12px; 
    }
    .user-profile { 
      display: flex; 
      align-items: center; 
      gap: 12px; 
      flex: 1; 
    }
    .profile-pic { 
      width: 40px; 
      height: 40px; 
      border-radius: 50%; 
      object-fit: cover; 
      border: 2px solid var(--accent); 
      background: var(--bg-tertiary); 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      font-size: 20px; 
      cursor: pointer; 
    }
    .user-info { 
      flex: 1; 
    }
    .username { 
      font-weight: 600; 
      font-size: 14px; 
      display: flex; 
      align-items: center; 
      gap: 4px; 
    }
    .status { 
      font-size: 12px; 
      color: var(--text-secondary); 
    }
    .settings-btn { 
      background: none; 
      border: none; 
      color: var(--text-secondary); 
      cursor: pointer; 
      padding: 8px; 
      border-radius: 6px; 
      transition: all 0.3s ease; 
      font-size: 16px; 
    }
    .settings-btn:hover { 
      background: var(--bg-tertiary); 
      color: var(--text-primary); 
    }
    .sidebar-tabs { 
      display: flex; 
      padding: 20px 20px 0; 
      gap: 8px; 
    }
    .sidebar-tab { 
      flex: 1; 
      padding: 10px; 
      background: var(--bg-tertiary); 
      border: none; 
      color: var(--text-secondary); 
      border-radius: 8px; 
      cursor: pointer; 
      font-size: 12px; 
      font-weight: 600; 
      transition: all 0.3s ease; 
    }
    .sidebar-tab.active { 
      background: var(--accent); 
      color: white; 
    }
    .sidebar-tab.has-notification::after { 
      content: '•'; 
      color: var(--danger); 
      margin-left: 4px; 
    }
    .search-box { 
      padding: 20px; 
    }
    .search-input { 
      width: 100%; 
      padding: 12px; 
      background: var(--bg-tertiary); 
      border: 1px solid var(--border); 
      border-radius: 8px; 
      color: var(--text-primary); 
      font-size: 14px; 
    }
    .search-input:focus { 
      outline: none; 
      border-color: var(--accent); 
    }
    .friends-list, .requests-list, .users-list { 
      flex: 1; 
      overflow-y: auto; 
      padding: 0 20px 20px; 
    }
    
    /* Chat Items */
    .chat-item, .friend-item, .user-item, .request-item { 
      display: flex; 
      align-items: center; 
      gap: 12px; 
      padding: 12px; 
      border-radius: 8px; 
      cursor: pointer; 
      transition: background 0.3s ease; 
      margin-bottom: 8px; 
      position: relative; 
    }
    .chat-item:hover, .friend-item:hover, .user-item:hover, .request-item:hover { 
      background: var(--bg-tertiary); 
    }
    .chat-item.active, .friend-item.active { 
      background: var(--accent); 
    }
    .friend-pic { 
      width: 36px; 
      height: 36px; 
      border-radius: 50%; 
      object-fit: cover; 
      background: var(--bg-tertiary); 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      font-size: 16px; 
      cursor: pointer; 
    }
    .friend-info { 
      flex: 1; 
    }
    .friend-name { 
      font-weight: 600; 
      font-size: 14px; 
    }
    .friend-status { 
      font-size: 12px; 
      color: var(--text-secondary); 
    }
    .friend-actions, .request-actions { 
      display: flex; 
      gap: 8px; 
    }
    .action-btn { 
      padding: 6px 12px; 
      border: none; 
      border-radius: 6px; 
      font-size: 12px; 
      cursor: pointer; 
      transition: all 0.3s ease; 
    }
    .add-friend { 
      background: var(--success); 
      color: white; 
    }
    .remove-friend, .deny-request { 
      background: var(--danger); 
      color: white; 
    }
    .accept-request { 
      background: var(--success); 
      color: white; 
    }
    .clear-requests { 
      background: var(--warning); 
      color: white; 
    }
    
    /* Chat Area */
    .chat-area { 
      flex: 1; 
      display: flex; 
      flex-direction: column; 
      background: var(--bg-primary); 
    }
    .chat-header { 
      background: var(--bg-secondary); 
      padding: 20px; 
      border-bottom: 1px solid var(--border); 
      display: flex; 
      align-items: center; 
      justify-content: space-between; 
    }
    .chat-partner { 
      display: flex; 
      align-items: center; 
      gap: 12px; 
    }
    .partner-pic { 
      width: 44px; 
      height: 44px; 
      border-radius: 50%; 
      object-fit: cover; 
      cursor: pointer; 
      background: var(--bg-tertiary); 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      font-size: 20px; 
    }
    .partner-info h2 { 
      font-size: 18px; 
      margin-bottom: 2px; 
      display: flex; 
      align-items: center; 
      gap: 4px; 
    }
    .partner-info .status { 
      font-size: 12px; 
      color: var(--success); 
    }
    
    /* Messages */
    .messages-container { 
      flex: 1; 
      overflow-y: auto; 
      padding: 20px; 
      background: var(--bg-primary); 
    }
    .message { 
      margin-bottom: 16px; 
      display: flex; 
      align-items: flex-start; 
      gap: 8px; 
      animation: messageSlide 0.3s ease; 
    }
    @keyframes messageSlide { 
      from { opacity: 0; transform: translateY(10px); } 
      to { opacity: 1; transform: translateY(0); } 
    }
    .message.own { 
      flex-direction: row-reverse; 
    }
    .message-pfp { 
      width: 32px; 
      height: 32px; 
      border-radius: 50%; 
      object-fit: cover; 
      background: var(--bg-tertiary); 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      font-size: 14px; 
      cursor: pointer; 
      flex-shrink: 0; 
    }
    .message-bubble { 
      max-width: 60%; 
      padding: 12px 16px; 
      border-radius: 16px; 
      word-wrap: break-word; 
      position: relative; 
    }
    .message.own .message-bubble { 
      background: var(--accent); 
      color: white; 
      border-bottom-right-radius: 4px; 
    }
    .message:not(.own) .message-bubble { 
      background: var(--bg-tertiary); 
      color: var(--text-primary); 
      border-bottom-left-radius: 4px; 
    }
    .message-header { 
      font-size: 12px; 
      font-weight: 600; 
      margin-bottom: 4px; 
      display: flex; 
      align-items: center; 
      gap: 4px; 
    }
    .message.own .message-header { 
      color: rgba(255,255,255,0.9); 
    }
    .message:not(.own) .message-header { 
      color: var(--text-secondary); 
    }
    .message-time { 
      font-size: 11px; 
      opacity: 0.7; 
      margin-left: auto; 
    }
    .message-text { 
      margin-bottom: 8px; 
      line-height: 1.4; 
    }
    .message-image { 
      max-width: 100%; 
      border-radius: 8px; 
      margin-top: 8px; 
      max-height: 300px; 
      object-fit: cover; 
    }
    .message-actions { 
      position: absolute; 
      top: -8px; 
      right: -8px; 
      opacity: 0; 
      transition: opacity 0.3s ease; 
    }
    .message:hover .message-actions { 
      opacity: 1; 
    }
    .delete-btn { 
      background: var(--danger); 
      color: white; 
      border: none; 
      border-radius: 50%; 
      width: 24px; 
      height: 24px; 
      cursor: pointer; 
      font-size: 12px; 
      display: flex; 
      align-items: center; 
      justify-content: center; 
    }
    
    /* Input Container */
    .input-container { 
      background: var(--bg-secondary); 
      border-top: 1px solid var(--border); 
      padding: 20px; 
    }
    .input-wrapper { 
      display: flex; 
      gap: 12px; 
      align-items: flex-end; 
    }
    .input-box { 
      flex: 1; 
      display: flex; 
      flex-direction: column; 
      gap: 10px; 
    }
    .text-input { 
      width: 100%; 
      padding: 14px; 
      background: var(--bg-tertiary); 
      border: 2px solid var(--border); 
      border-radius: 12px; 
      font-size: 16px; 
      color: var(--text-primary); 
      font-family: inherit; 
      resize: none; 
      transition: border 0.3s ease; 
    }
    .text-input:focus { 
      outline: none; 
      border-color: var(--accent); 
    }
    .file-input-wrapper { 
      position: relative; 
    }
    .file-input { 
      display: none; 
    }
    .file-label { 
      display: inline-block; 
      padding: 10px 16px; 
      background: var(--bg-tertiary); 
      border-radius: 8px; 
      cursor: pointer; 
      font-size: 14px; 
      transition: background 0.3s ease; 
      color: var(--text-secondary); 
    }
    .file-label:hover { 
      background: var(--border); 
    }
    .file-preview { 
      font-size: 12px; 
      color: var(--text-secondary); 
      margin-top: 4px; 
    }
    .send-btn { 
      padding: 14px 24px; 
      background: var(--accent); 
      color: white; 
      border: none; 
      border-radius: 12px; 
      cursor: pointer; 
      font-weight: 600; 
      transition: all 0.3s ease; 
      white-space: nowrap; 
    }
    .send-btn:hover { 
      background: var(--accent-hover); 
      transform: translateY(-1px); 
    }
    .no-messages { 
      text-align: center; 
      color: var(--text-secondary); 
      margin-top: 40px; 
      font-size: 14px; 
    }
    .logout-btn { 
      padding: 10px 20px; 
      background: var(--danger); 
      color: white; 
      border: none; 
      border-radius: 8px; 
      cursor: pointer; 
      font-weight: 600; 
      transition: background 0.3s; 
    }
    .logout-btn:hover { 
      background: #dc2626; 
    }
    
    /* Modals */
    .modal { 
      display: none; 
      position: fixed; 
      top: 0; 
      left: 0; 
      width: 100%; 
      height: 100%; 
      background: rgba(0,0,0,0.8); 
      z-index: 1000; 
      align-items: center; 
      justify-content: center; 
    }
    .modal.active { 
      display: flex; 
    }
    .modal-content { 
      background: var(--bg-secondary); 
      border-radius: 16px; 
      padding: 30px; 
      max-width: 500px; 
      width: 90%; 
      max-height: 90vh; 
      overflow-y: auto; 
      border: 1px solid var(--border); 
      box-shadow: var(--shadow); 
    }
    .modal-header { 
      display: flex; 
      justify-content: space-between; 
      align-items: center; 
      margin-bottom: 20px; 
    }
    .modal-title { 
      font-size: 1.5rem; 
      font-weight: 600; 
    }
    .close-modal { 
      background: none; 
      border: none; 
      color: var(--text-secondary); 
      font-size: 24px; 
      cursor: pointer; 
      padding: 4px; 
    }
    .close-modal:hover { 
      color: var(--text-primary); 
    }
    .form-group { 
      margin-bottom: 20px; 
    }
    .form-group label { 
      display: block; 
      margin-bottom: 8px; 
      color: var(--text-secondary); 
      font-weight: 500; 
    }
    .profile-preview { 
      width: 100px; 
      height: 100px; 
      border-radius: 50%; 
      object-fit: cover; 
      margin: 0 auto 20px; 
      display: block; 
      border: 3px solid var(--accent); 
      background: var(--bg-tertiary); 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      font-size: 40px; 
    }
    
    /* User Profile Modal */
    .user-profile-modal .profile-header { 
      text-align: center; 
      margin-bottom: 20px; 
    }
    .user-profile-modal .profile-pic-large { 
      width: 120px; 
      height: 120px; 
      border-radius: 50%; 
      object-fit: cover; 
      margin: 0 auto 16px; 
      border: 4px solid var(--accent); 
      background: var(--bg-tertiary); 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      font-size: 50px; 
    }
    .user-profile-modal .username { 
      font-size: 1.5rem; 
      margin-bottom: 8px; 
    }
    .user-profile-modal .bio { 
      color: var(--text-secondary); 
      margin-bottom: 20px; 
      line-height: 1.5; 
      text-align: center; 
    }
    .user-stats { 
      display: grid; 
      grid-template-columns: 1fr 1fr; 
      gap: 16px; 
      margin-bottom: 20px; 
    }
    .stat-item { 
      text-align: center; 
      padding: 16px; 
      background: var(--bg-tertiary); 
      border-radius: 8px; 
    }
    .stat-number { 
      font-size: 1.5rem; 
      font-weight: 600; 
      color: var(--accent); 
    }
    .stat-label { 
      font-size: 12px; 
      color: var(--text-secondary); 
      margin-top: 4px; 
    }
    
    /* Connection Status */
    .connection-status {
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 10px 15px;
      border-radius: 8px;
      font-size: 12px;
      z-index: 1000;
      display: none;
      max-width: 300px;
    }
    
    .connection-status.connected {
      background: rgba(16, 185, 129, 0.2);
      border: 1px solid var(--success);
      color: var(--success);
    }
    
    .connection-status.disconnected {
      background: rgba(239, 68, 68, 0.2);
      border: 1px solid var(--danger);
      color: var(--danger);
    }
    
    /* Connection Test */
    .connection-test {
      position: fixed;
      top: 60px;
      right: 20px;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 11px;
      background: rgba(99, 102, 241, 0.1);
      border: 1px solid var(--accent);
      color: var(--accent);
      display: none;
    }
    
    /* Loading Spinner */
    .spinner {
      border: 3px solid rgba(255, 255, 255, 0.1);
      border-radius: 50%;
      border-top: 3px solid var(--accent);
      width: 20px;
      height: 20px;
      animation: spin 1s linear infinite;
      display: none;
    }
    
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="config-banner" id="configBanner">
    <div class="config-info">
      <span>Connected to:</span>
      <span class="config-ip" id="currentBackendIP">${homeBackendIP}</span>
    </div>
    <button class="config-btn" onclick="window.location.href='/config'">Change Backend</button>
  </div>

  <div class="auth-container" id="authContainer">
    <div class="auth-box">
      <h1>VoidChat</h1>
      <div class="auth-tabs">
        <button class="active" onclick="switchTab('login')">Login</button>
        <button onclick="switchTab('signup')">Sign Up</button>
      </div>
      
      <div id="loginSection">
        <div class="input-group">
          <label>Username</label>
          <input type="text" id="username" placeholder="Enter your username">
        </div>
        <div class="input-group">
          <label>Password</label>
          <input type="password" id="password" placeholder="Enter your password">
        </div>
      </div>
      
      <div id="signupSection" style="display: none;">
        <div class="input-group">
          <label>Username</label>
          <input type="text" id="signupUsername" placeholder="Choose a username (no ✓ allowed)">
        </div>
        <div class="input-group">
          <label>Password</label>
          <input type="password" id="signupPassword" placeholder="Choose a password">
        </div>
        <div class="input-group">
          <label>Email</label>
          <input type="email" id="signupEmail" placeholder="Enter your email for verification">
        </div>
      </div>
      
      <div class="verification-section" id="verificationSection">
        <div class="input-group">
          <label>Verification Code</label>
          <input type="text" id="verificationCode" placeholder="Enter code from email">
        </div>
        <div class="tip">Check your email for the verification code</div>
      </div>
      
      <div class="error-msg" id="errorMsg"></div>
      <div class="success-msg" id="successMsg"></div>
      
      <button class="auth-btn" id="authButton" onclick="handleAuth()">Login</button>
      <button class="auth-btn" id="verifyButton" style="display: none;" onclick="verifyEmail()">Verify Email</button>
      
      <div class="tip">Username "vortex" gets special features</div>
    </div>
  </div>

  <div class="app-container" id="appContainer">
    <div class="sidebar">
      <div class="sidebar-header">
        <div class="user-profile">
          <div class="profile-pic" id="userProfilePic" onclick="openUserProfile(currentUser.username)">👤</div>
          <div class="user-info">
            <div class="username" id="sidebarUsername"></div>
            <div class="status">Online</div>
          </div>
        </div>
        <button class="settings-btn" onclick="openSettings()">⚙️</button>
      </div>

      <div class="sidebar-tabs">
        <button class="sidebar-tab active" onclick="switchSidebarTab('chats')">Chats</button>
        <button class="sidebar-tab" id="requestsTab" onclick="switchSidebarTab('requests')">Requests</button>
        <button class="sidebar-tab" onclick="switchSidebarTab('discover')">Discover</button>
      </div>

      <div class="search-box">
        <input type="text" class="search-input" id="searchInput" placeholder="Search users..." oninput="searchUsers()">
      </div>

      <div class="friends-list" id="chatsList"></div>
      <div class="requests-list" id="requestsList" style="display: none;"></div>
      <div class="users-list" id="usersList" style="display: none;"></div>
    </div>

    <div class="chat-area">
      <div class="chat-header">
        <div class="chat-partner">
          <div class="partner-pic" id="chatPartnerPic" onclick="openCurrentChatProfile()">👤</div>
          <div class="partner-info">
            <h2 id="chatPartnerName">Select a chat</h2>
            <div class="status" id="chatPartnerStatus">Click on a chat to start messaging</div>
          </div>
        </div>
        <button class="logout-btn" onclick="logout()">Logout</button>
      </div>

      <div class="messages-container" id="messagesContainer">
        <div class="no-messages">Select a chat to start messaging</div>
      </div>

      <div class="input-container">
        <div class="input-wrapper">
          <div class="input-box">
            <textarea class="text-input" id="messageInput" placeholder="Type a message..." rows="1"></textarea>
            <div class="file-input-wrapper">
              <input type="file" class="file-input" id="fileInput" accept="image/*" onchange="handleFileSelect()">
              <label for="fileInput" class="file-label">📎 Attach Image</label>
              <div class="file-preview" id="filePreview"></div>
            </div>
          </div>
          <button class="send-btn" onclick="sendMessage()">Send</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Modals -->
  <div class="modal" id="settingsModal">
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">Settings</h2>
        <button class="close-modal" onclick="closeModal('settingsModal')">×</button>
      </div>
      <div class="form-group">
        <label>Profile Picture</label>
        <div class="profile-preview" id="settingsProfilePic">👤</div>
        <input type="file" id="profilePicInput" accept="image/*" onchange="previewProfilePic()">
      </div>
      <div class="form-group">
        <label>Bio</label>
        <textarea id="bioInput" placeholder="Tell us about yourself..." rows="4"></textarea>
      </div>
      <button class="auth-btn" onclick="saveSettings()">Save Changes</button>
    </div>
  </div>

  <div class="modal user-profile-modal" id="userProfileModal">
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">Profile</h2>
        <button class="close-modal" onclick="closeModal('userProfileModal')">×</button>
      </div>
      <div class="profile-header">
        <div class="profile-pic-large" id="profileModalPic">👤</div>
        <div class="username" id="profileModalUsername"></div>
        <div class="bio" id="profileModalBio"></div>
      </div>
      <div class="user-stats">
        <div class="stat-item">
          <div class="stat-number" id="profileFriendsCount">0</div>
          <div class="stat-label">Friends</div>
        </div>
        <div class="stat-item">
          <div class="stat-number" id="profileMutualCount">0</div>
          <div class="stat-label">Mutual Friends</div>
        </div>
      </div>
      <div class="friend-actions" id="profileActions"></div>
    </div>
  </div>

  <!-- Connection Status Indicator -->
  <div class="connection-status" id="connectionStatus"></div>
  
  <!-- Loading Spinner -->
  <div class="spinner" id="globalSpinner"></div>

  <script>
    // Global variables
    let currentUser = null;
    let currentSession = null;
    let authMode = 'login';
    let selectedFile = null;
    let messagePolling = null;
    let currentChatPartner = null;
    let currentChatType = null;
    let sidebarMode = 'chats';
    let pendingVerification = null;
    let backendConnected = false;
    
    // API call function - routes through Render proxy
    async function apiCall(url, options = {}) {
      const spinner = document.getElementById('globalSpinner');
      spinner.style.display = 'block';
      
      try {
        // Always prepend /proxy to route through our backend
        const proxyUrl = '/proxy' + url;
        
        // Add session header if available
        if (currentSession) {
          options.headers = {
            ...options.headers,
            'Authorization': currentSession
          };
        }
        
        // Ensure Content-Type for JSON
        if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
          options.headers = {
            ...options.headers,
            'Content-Type': 'application/json'
          };
          options.body = JSON.stringify(options.body);
        }
        
        const response = await fetch(proxyUrl, options);
        
        // Handle backend configuration errors
        if (response.status === 400) {
          const data = await response.json().catch(() => ({}));
          if (data.error === 'Home backend not configured') {
            window.location.href = '/config';
            return null;
          }
        }
        
        // Handle connection errors
        if (response.status >= 500) {
          showConnectionStatus(false, 'Home backend connection error');
          backendConnected = false;
        } else {
          backendConnected = true;
          showConnectionStatus(true, 'Connected to home backend');
        }
        
        return response;
      } catch (error) {
        console.error('API call failed:', error);
        showConnectionStatus(false, 'Network error: ' + error.message);
        backendConnected = false;
        return null;
      } finally {
        spinner.style.display = 'none';
      }
    }
    
    // Connection status display
    function showConnectionStatus(connected, message = '') {
      const statusEl = document.getElementById('connectionStatus');
      if (!statusEl) return;
      
      statusEl.textContent = message || (connected ? 'Connected to home backend' : 'Disconnected from home backend');
      statusEl.className = 'connection-status ' + (connected ? 'connected' : 'disconnected');
      statusEl.style.display = 'block';
      
      if (connected) {
        setTimeout(() => {
          statusEl.style.display = 'none';
        }, 3000);
      }
    }
    
    // Test backend connection
    async function testBackendConnection() {
      try {
        const response = await fetch('/api/health');
        if (response.ok) {
          const data = await response.json();
          backendConnected = data.homeBackendConfigured;
          
          if (backendConnected) {
            showConnectionStatus(true, 'Connected to home backend');
          } else {
            showConnectionStatus(false, 'No home backend configured');
          }
          return backendConnected;
        }
      } catch (error) {
        console.error('Connection test failed:', error);
        showConnectionStatus(false, 'Cannot reach Render backend');
        return false;
      }
    }
    
    // Authentication functions
    function switchTab(mode) {
      authMode = mode;
      document.querySelectorAll('.auth-tabs button').forEach(btn => btn.classList.remove('active'));
      event.target.classList.add('active');
      
      if (mode === 'login') {
        document.getElementById('loginSection').style.display = 'block';
        document.getElementById('signupSection').style.display = 'none';
        document.getElementById('verificationSection').style.display = 'none';
        document.getElementById('authButton').style.display = 'block';
        document.getElementById('verifyButton').style.display = 'none';
        document.getElementById('authButton').textContent = 'Login';
      } else {
        document.getElementById('loginSection').style.display = 'none';
        document.getElementById('signupSection').style.display = 'block';
        document.getElementById('verificationSection').style.display = 'none';
        document.getElementById('authButton').style.display = 'block';
        document.getElementById('verifyButton').style.display = 'none';
        document.getElementById('authButton').textContent = 'Sign Up';
      }
      
      document.getElementById('errorMsg').textContent = '';
      document.getElementById('successMsg').textContent = '';
    }
    
    async function handleAuth() {
      const errorMsg = document.getElementById('errorMsg');
      const successMsg = document.getElementById('successMsg');
      errorMsg.textContent = '';
      successMsg.textContent = '';
      
      if (!await testBackendConnection()) {
        errorMsg.textContent = 'Cannot connect to home backend. Please check configuration.';
        return;
      }
      
      if (authMode === 'login') {
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value.trim();
        
        if (!username || !password) {
          errorMsg.textContent = 'Username and password are required';
          return;
        }
        
        const response = await apiCall('/api/login', {
          method: 'POST',
          body: { username, password }
        });
        
        if (!response) {
          errorMsg.textContent = 'Network error. Please try again.';
          return;
        }
        
        const data = await response.json();
        if (data.error) {
          errorMsg.textContent = data.error;
          return;
        }
        
        currentUser = { 
          username, 
          isVortex: data.isVortex,
          profilePic: data.profilePic,
          bio: data.bio || ''
        };
        currentSession = data.session;
        showApp();
      } else {
        const username = document.getElementById('signupUsername').value.trim();
        const password = document.getElementById('signupPassword').value.trim();
        const email = document.getElementById('signupEmail').value.trim();
        
        if (!username || !password || !email) {
          errorMsg.textContent = 'All fields are required';
          return;
        }
        
        if (username.includes('✓')) {
          errorMsg.textContent = 'Username cannot contain the ✓ symbol';
          return;
        }
        
        const response = await apiCall('/api/signup', {
          method: 'POST',
          body: { username, password, email }
        });
        
        if (!response) {
          errorMsg.textContent = 'Network error. Please try again.';
          return;
        }
        
        const data = await response.json();
        if (data.error) {
          errorMsg.textContent = data.error;
          return;
        }
        
        pendingVerification = { username, password };
        document.getElementById('verificationSection').style.display = 'block';
        document.getElementById('authButton').style.display = 'none';
        document.getElementById('verifyButton').style.display = 'block';
        successMsg.textContent = 'Verification code sent to your email';
      }
    }
    
    async function verifyEmail() {
      const code = document.getElementById('verificationCode').value.trim();
      const errorMsg = document.getElementById('errorMsg');
      const successMsg = document.getElementById('successMsg');
      
      if (!code) {
        errorMsg.textContent = 'Verification code is required';
        return;
      }
      
      const response = await apiCall('/api/verify-email', {
        method: 'POST',
        body: { 
          username: pendingVerification.username,
          password: pendingVerification.password,
          code 
        }
      });
      
      if (!response) {
        errorMsg.textContent = 'Network error. Please try again.';
        return;
      }
      
      const data = await response.json();
      if (data.error) {
        errorMsg.textContent = data.error;
        return;
      }
      
      currentUser = { 
        username: pendingVerification.username, 
        isVortex: data.isVortex,
        profilePic: data.profilePic,
        bio: data.bio || ''
      };
      currentSession = data.session;
      pendingVerification = null;
      showApp();
    }
    
    function showApp() {
      document.getElementById('authContainer').style.display = 'none';
      document.getElementById('appContainer').classList.add('active');
      document.getElementById('sidebarUsername').textContent = currentUser.username + (currentUser.isVortex ? ' (Vortex)' : '');
      updateProfilePic(currentUser.profilePic, 'userProfilePic');
      loadChats();
      loadFriendRequests();
      startPolling();
      
      // Start periodic connection checks
      setInterval(testBackendConnection, 30000);
    }
    
    // Profile picture update
    function updateProfilePic(profilePic, elementId) {
      const element = document.getElementById(elementId);
      if (!element) return;
      
      if (profilePic && profilePic !== 'null') {
        element.innerHTML = '';
        element.style.background = 'none';
        const img = document.createElement('img');
        
        // Fix URL for proxy
        let imgSrc = profilePic;
        if (imgSrc && !imgSrc.startsWith('http') && !imgSrc.startsWith('data:')) {
          if (imgSrc.startsWith('/uploads/')) {
            imgSrc = '/proxy' + imgSrc;
          } else if (imgSrc.startsWith('uploads/')) {
            imgSrc = '/proxy/' + imgSrc;
          }
        }
        
        img.src = imgSrc;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.borderRadius = '50%';
        img.style.objectFit = 'cover';
        element.appendChild(img);
      } else {
        element.innerHTML = '👤';
        element.style.background = 'var(--bg-tertiary)';
      }
    }
    
    // Sidebar functions
    function switchSidebarTab(tab) {
      sidebarMode = tab;
      document.querySelectorAll('.sidebar-tab').forEach(btn => btn.classList.remove('active'));
      event.target.classList.add('active');
      
      document.getElementById('chatsList').style.display = 'none';
      document.getElementById('requestsList').style.display = 'none';
      document.getElementById('usersList').style.display = 'none';
      
      if (tab === 'chats') {
        document.getElementById('chatsList').style.display = 'block';
        loadChats();
      } else if (tab === 'requests') {
        document.getElementById('requestsList').style.display = 'block';
        loadFriendRequests();
      } else if (tab === 'discover') {
        document.getElementById('usersList').style.display = 'block';
        searchUsers();
      }
    }
    
    // Chat functions
    async function loadChats() {
      try {
        const response = await apiCall('/api/chats');
        if (!response) return;
        const chats = await response.json();
        displayChats(chats);
      } catch (err) {
        console.error('Failed to load chats:', err);
      }
    }
    
    function displayChats(chats) {
      const container = document.getElementById('chatsList');
      if (!container) return;
      container.innerHTML = '';
      
      const generalChatEl = createChatElement({
        id: 'general',
        name: 'General Chat',
        type: 'general',
        icon: null,
        lastMessage: 'Public chat room for everyone',
        unread: false
      }, true);
      container.appendChild(generalChatEl);
      
      chats.forEach(chat => {
        const chatEl = createChatElement(chat);
        container.appendChild(chatEl);
      });
    }
    
    function createChatElement(chat, isGeneral = false) {
      const div = document.createElement('div');
      div.className = 'chat-item' + 
        (currentChatPartner === chat.id && currentChatType === chat.type ? ' active' : '') + 
        (chat.unread ? ' unread' : '');
      
      div.onclick = () => selectChat(chat, isGeneral);
      
      const displayName = isGeneral ? '💬 General Chat' : chat.name;
      const lastMessage = chat.lastMessage || (isGeneral ? 'Public chat room for everyone' : 'No messages yet');
      
      div.innerHTML = '<div class="friend-pic">' + 
        (chat.icon ? '<img src="' + (chat.icon.startsWith('http') ? chat.icon : '/proxy' + (chat.icon.startsWith('/') ? '' : '/') + chat.icon) + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">' : (isGeneral ? '💬' : '👤')) + 
        '</div><div class="friend-info"><div class="friend-name">' + displayName + '</div><div class="friend-status">' + lastMessage + '</div></div>' +
        (!isGeneral ? '<div class="friend-actions"><button class="action-btn remove-friend" onclick="event.stopPropagation(); removeFriend(\'' + chat.id + '\')">Remove</button></div>' : '');
      
      return div;
    }
    
    async function selectChat(chat, isGeneral = false) {
      currentChatPartner = chat.id;
      currentChatType = isGeneral ? 'general' : 'friend';
      
      if (isGeneral) {
        document.getElementById('chatPartnerName').textContent = '💬 General Chat';
        document.getElementById('chatPartnerPic').innerHTML = '💬';
        document.getElementById('chatPartnerStatus').textContent = 'Public chat room';
      } else {
        document.getElementById('chatPartnerName').textContent = chat.name + (chat.isVortex ? ' (Vortex)' : '');
        
        // Fix profile pic URL for proxy
        let profilePic = chat.icon;
        if (profilePic && !profilePic.startsWith('http') && !profilePic.startsWith('data:')) {
          if (profilePic.startsWith('/uploads/')) {
            profilePic = '/proxy' + profilePic;
          } else if (profilePic.startsWith('uploads/')) {
            profilePic = '/proxy/' + profilePic;
          }
        }
        
        if (profilePic && profilePic !== 'null') {
          document.getElementById('chatPartnerPic').innerHTML = '<img src="' + profilePic + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">';
        } else {
          document.getElementById('chatPartnerPic').innerHTML = '👤';
        }
        document.getElementById('chatPartnerStatus').textContent = 'Online';
      }
      
      document.querySelectorAll('.chat-item').forEach(item => item.classList.remove('active'));
      event.currentTarget.classList.add('active');
      
      loadMessages();
    }
    
    // Message functions
    async function loadMessages() {
      if (!currentChatPartner) return;
      
      try {
        let url = '/api/messages?';
        if (currentChatType === 'general') {
          url += 'type=general';
        } else {
          url += 'friend=' + encodeURIComponent(currentChatPartner) + '&type=friend';
        }
        
        const response = await apiCall(url);
        if (!response) return;
        const messages = await response.json();
        displayMessages(messages);
      } catch (err) {
        console.error('Failed to load messages:', err);
      }
    }
    
    function displayMessages(messages) {
      const container = document.getElementById('messagesContainer');
      if (!container) return;
      
      if (messages.length === 0) {
        container.innerHTML = '<div class="no-messages">No messages yet. Start the conversation!</div>';
        return;
      }
      
      container.innerHTML = '';
      messages.forEach(msg => {
        const messageEl = createMessageElement(msg);
        container.appendChild(messageEl);
      });
      container.scrollTop = container.scrollHeight;
    }
    
    function createMessageElement(msg, isPending = false) {
      const div = document.createElement('div');
      div.className = 'message' + (msg.sender === currentUser.username ? ' own' : '') + (isPending ? ' pending' : '');
      div.dataset.id = msg.id || 'temp';
      
      const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
      
      // Fix image URLs for proxy
      let senderPfp = msg.senderProfilePic;
      let imageUrl = msg.imageUrl;
      
      if (senderPfp && !senderPfp.startsWith('http') && !senderPfp.startsWith('data:')) {
        if (senderPfp.startsWith('/uploads/')) {
          senderPfp = '/proxy' + senderPfp;
        } else if (senderPfp.startsWith('uploads/')) {
          senderPfp = '/proxy/' + senderPfp;
        }
      }
      
      if (imageUrl && !imageUrl.startsWith('http') && !imageUrl.startsWith('data:')) {
        if (imageUrl.startsWith('/uploads/')) {
          imageUrl = '/proxy' + imageUrl;
        } else if (imageUrl.startsWith('uploads/')) {
          imageUrl = '/proxy/' + imageUrl;
        }
      }
      
      let messageContent = '';
      if (msg.text) {
        messageContent += '<div class="message-text">' + escapeHtml(msg.text) + '</div>';
      }
      if (imageUrl) {
        messageContent += '<img src="' + imageUrl + '" class="message-image" alt="attachment">';
      }
      
      let deleteButton = '';
      if (msg.sender === currentUser.username && msg.id) {
        deleteButton = '<div class="message-actions"><button class="delete-btn" onclick="deleteMessage(\'' + msg.id + '\')">×</button></div>';
      }
      
      div.innerHTML = '<div class="message-pfp" onclick="openUserProfile(\'' + msg.sender + '\')">' +
        (senderPfp ? '<img src="' + senderPfp + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">' : '👤') +
        '</div><div class="message-bubble"><div class="message-header"><span>' + msg.sender + (msg.isVortex ? ' (Vortex)' : '') + 
        '</span><span class="message-time">' + time + '</span></div>' + messageContent + deleteButton + '</div>';
      
      return div;
    }
    
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    // Send message with file upload support
    async function sendMessage() {
      if (!currentChatPartner) {
        alert('Please select a chat first');
        return;
      }
      
      const input = document.getElementById('messageInput');
      const text = input.value.trim();
      
      if (!text && !selectedFile) return;
      
      const formData = new FormData();
      formData.append('sender', currentUser.username);
      formData.append('text', text || '');
      formData.append('isVortex', currentUser.isVortex);
      formData.append('type', currentChatType);
      
      if (currentChatType === 'friend') {
        formData.append('receiver', currentChatPartner);
      }
      
      if (selectedFile) {
        formData.append('image', selectedFile);
      }
      
      // Create temporary message
      const tempId = 'temp-' + Date.now();
      const tempMessage = {
        id: tempId,
        sender: currentUser.username,
        text: text || '',
        imageUrl: selectedFile ? URL.createObjectURL(selectedFile) : null,
        timestamp: new Date().toISOString(),
        isVortex: currentUser.isVortex,
        senderProfilePic: currentUser.profilePic
      };
      
      // Add to UI
      const container = document.getElementById('messagesContainer');
      if (container.querySelector('.no-messages')) {
        container.innerHTML = '';
      }
      const messageEl = createMessageElement(tempMessage, true);
      container.appendChild(messageEl);
      container.scrollTop = container.scrollHeight;
      
      // Clear inputs
      input.value = '';
      selectedFile = null;
      document.getElementById('filePreview').textContent = '';
      document.getElementById('fileInput').value = '';
      
      // Send to backend
      try {
        const response = await apiCall('/api/messages', {
          method: 'POST',
          body: formData
        });
        
        if (!response) {
          // Remove failed message
          const pendingEl = container.querySelector('[data-id="' + tempId + '"]');
          if (pendingEl) pendingEl.remove();
          return;
        }
        
        const data = await response.json();
        if (data.success && data.message) {
          // Replace temp message with real one
          const pendingEl = container.querySelector('[data-id="' + tempId + '"]');
          if (pendingEl) {
            const realEl = createMessageElement(data.message);
            pendingEl.replaceWith(realEl);
          }
        }
      } catch (err) {
        console.error('Failed to send message:', err);
        // Remove failed message
        const pendingEl = container.querySelector('[data-id="' + tempId + '"]');
        if (pendingEl) pendingEl.remove();
      }
    }
    
    // File handling
    function handleFileSelect() {
      const input = document.getElementById('fileInput');
      const preview = document.getElementById('filePreview');
      
      if (input.files.length > 0) {
        selectedFile = input.files[0];
        preview.textContent = 'Selected: ' + selectedFile.name;
      } else {
        selectedFile = null;
        preview.textContent = '';
      }
    }
    
    // Friend request functions
    async function loadFriendRequests() {
      try {
        const response = await apiCall('/api/friend-requests');
        if (!response) return;
        const requests = await response.json();
        displayFriendRequests(requests);
        updateRequestsNotification(requests.length);
      } catch (err) {
        console.error('Failed to load friend requests:', err);
      }
    }
    
    function displayFriendRequests(requests) {
      const container = document.getElementById('requestsList');
      if (!container) return;
      container.innerHTML = '';
      
      if (requests.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">No pending requests</div>';
        return;
      }
      
      requests.forEach(request => {
        const requestEl = createRequestElement(request);
        container.appendChild(requestEl);
      });
    }
    
    function createRequestElement(request) {
      const div = document.createElement('div');
      div.className = 'request-item';
      
      // Fix profile pic URL
      let profilePic = request.profilePic;
      if (profilePic && !profilePic.startsWith('http') && !profilePic.startsWith('data:')) {
        if (profilePic.startsWith('/uploads/')) {
          profilePic = '/proxy' + profilePic;
        } else if (profilePic.startsWith('uploads/')) {
          profilePic = '/proxy/' + profilePic;
        }
      }
      
      div.innerHTML = '<div class="friend-pic" onclick="openUserProfile(\'' + request.username + '\')">' + 
        (profilePic ? '<img src="' + profilePic + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">' : '👤') + 
        '</div><div class="friend-info"><div class="friend-name">' + request.username + (request.isVortex ? ' (Vortex)' : '') + 
        '</div><div class="friend-status">Wants to be friends</div></div><div class="request-actions">' +
        '<button class="action-btn accept-request" onclick="event.stopPropagation(); acceptRequest(\'' + request.username + '\')">Accept</button>' +
        '<button class="action-btn deny-request" onclick="event.stopPropagation(); denyRequest(\'' + request.username + '\')">Deny</button></div>';
      
      return div;
    }
    
    function updateRequestsNotification(count) {
      const requestsTab = document.getElementById('requestsTab');
      if (count > 0) {
        requestsTab.classList.add('has-notification');
        requestsTab.textContent = 'Requests (' + count + ')';
      } else {
        requestsTab.classList.remove('has-notification');
        requestsTab.textContent = 'Requests';
      }
    }
    
    // User search
    async function searchUsers() {
      const query = document.getElementById('searchInput').value.trim();
      const container = document.getElementById('usersList');
      
      if (!query) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">Enter a username to search</div>';
        return;
      }
      
      try {
        const response = await apiCall('/api/search-users?q=' + encodeURIComponent(query));
        if (!response) return;
        const users = await response.json();
        displaySearchResults(users);
      } catch (err) {
        console.error('Search failed:', err);
      }
    }
    
    function displaySearchResults(users) {
      const container = document.getElementById('usersList');
      if (!container) return;
      container.innerHTML = '';
      
      if (users.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">No users found</div>';
        return;
      }
      
      users.forEach(user => {
        if (user.username === currentUser.username) return;
        const userEl = createUserElement(user);
        container.appendChild(userEl);
      });
    }
    
    function createUserElement(user) {
      const div = document.createElement('div');
      div.className = 'user-item';
      div.onclick = () => openUserProfile(user.username);
      
      // Fix profile pic URL
      let profilePic = user.profilePic;
      if (profilePic && !profilePic.startsWith('http') && !profilePic.startsWith('data:')) {
        if (profilePic.startsWith('/uploads/')) {
          profilePic = '/proxy' + profilePic;
        } else if (profilePic.startsWith('uploads/')) {
          profilePic = '/proxy/' + profilePic;
        }
      }
      
      let actionButtons = '';
      if (user.isFriend) {
        actionButtons = '<button class="action-btn remove-friend" onclick="event.stopPropagation(); removeFriend(\'' + user.username + '\')">Remove</button>';
      } else if (user.requestSent) {
        actionButtons = '<button class="action-btn" disabled>Request Sent</button>';
      } else if (user.requestReceived) {
        actionButtons = '<button class="action-btn accept-request" onclick="event.stopPropagation(); acceptRequest(\'' + user.username + '\')">Accept</button>' +
          '<button class="action-btn deny-request" onclick="event.stopPropagation(); denyRequest(\'' + user.username + '\')">Deny</button>';
      } else {
        actionButtons = '<button class="action-btn add-friend" onclick="event.stopPropagation(); sendFriendRequest(\'' + user.username + '\')">Add</button>';
      }
      
      div.innerHTML = '<div class="friend-pic" onclick="event.stopPropagation(); openUserProfile(\'' + user.username + '\')">' + 
        (profilePic ? '<img src="' + profilePic + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">' : '👤') + 
        '</div><div class="friend-info"><div class="friend-name">' + user.username + (user.isVortex ? ' (Vortex)' : '') + 
        '</div><div class="friend-status">' + (user.isFriend ? 'Friend' : 'Click to view profile') + '</div></div><div class="friend-actions">' + 
        actionButtons + '</div>';
      
      return div;
    }
    
    // Profile functions
    async function openUserProfile(username) {
      if (!username) return;
      
      try {
        const response = await apiCall('/api/users/' + username);
        if (!response) return;
        const user = await response.json();
        
        // Fix profile pic URL
        let profilePic = user.profilePic;
        if (profilePic && !profilePic.startsWith('http') && !profilePic.startsWith('data:')) {
          if (profilePic.startsWith('/uploads/')) {
            profilePic = '/proxy' + profilePic;
          } else if (profilePic.startsWith('uploads/')) {
            profilePic = '/proxy/' + profilePic;
          }
        }
        
        document.getElementById('profileModalPic').innerHTML = profilePic ? 
          '<img src="' + profilePic + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">' : '👤';
        document.getElementById('profileModalUsername').textContent = user.username + (user.isVortex ? ' (Vortex)' : '');
        document.getElementById('profileModalBio').textContent = user.bio || 'No bio yet';
        document.getElementById('profileFriendsCount').textContent = user.friendsCount || 0;
        document.getElementById('profileMutualCount').textContent = user.mutualFriends || 0;
        
        const actions = document.getElementById('profileActions');
        actions.innerHTML = '';
        
        if (user.isFriend) {
          actions.innerHTML = '<button class="action-btn remove-friend" onclick="removeFriend(\'' + username + '\')">Remove Friend</button>';
        } else if (user.requestSent) {
          actions.innerHTML = '<button class="action-btn" disabled>Request Sent</button>';
        } else if (user.requestReceived) {
          actions.innerHTML = '<button class="action-btn accept-request" onclick="acceptRequest(\'' + username + '\')">Accept</button>' +
                            '<button class="action-btn deny-request" onclick="denyRequest(\'' + username + '\')">Deny</button>';
        } else if (username !== currentUser.username) {
          actions.innerHTML = '<button class="action-btn add-friend" onclick="sendFriendRequest(\'' + username + '\')">Add Friend</button>';
        }
        
        document.getElementById('userProfileModal').classList.add('active');
      } catch (err) {
        console.error('Failed to load user profile:', err);
      }
    }
    
    function openCurrentChatProfile() {
      if (currentChatType === 'general') return;
      openUserProfile(currentChatPartner);
    }
    
    // Friend request actions
    async function sendFriendRequest(username) {
      try {
        const response = await apiCall('/api/friend-requests', {
          method: 'POST',
          body: { toUsername: username }
        });
        
        if (response && response.ok) {
          closeModal('userProfileModal');
          alert('Friend request sent!');
          searchUsers();
        }
      } catch (err) {
        console.error('Failed to send friend request:', err);
      }
    }
    
    async function acceptRequest(username) {
      try {
        const response = await apiCall('/api/friend-requests/accept', {
          method: 'POST',
          body: { fromUsername: username }
        });
        
        if (response && response.ok) {
          loadFriendRequests();
          loadChats();
          searchUsers();
          closeModal('userProfileModal');
        }
      } catch (err) {
        console.error('Failed to accept request:', err);
      }
    }
    
    async function denyRequest(username) {
      try {
        const response = await apiCall('/api/friend-requests/deny', {
          method: 'POST',
          body: { fromUsername: username }
        });
        
        if (response && response.ok) {
          loadFriendRequests();
          searchUsers();
          closeModal('userProfileModal');
        }
      } catch (err) {
        console.error('Failed to deny request:', err);
      }
    }
    
    async function removeFriend(username) {
      try {
        const response = await apiCall('/api/friends', {
          method: 'DELETE',
          body: { friendUsername: username }
        });
        
        if (response && response.ok) {
          loadChats();
          searchUsers();
          if (currentChatPartner === username && currentChatType === 'friend') {
            currentChatPartner = null;
            currentChatType = null;
            clearChat();
          }
          closeModal('userProfileModal');
        }
      } catch (err) {
        console.error('Failed to remove friend:', err);
      }
    }
    
    function clearChat() {
      document.getElementById('chatPartnerName').textContent = 'Select a chat';
      document.getElementById('chatPartnerPic').innerHTML = '👤';
      document.getElementById('chatPartnerStatus').textContent = 'Click on a chat to start messaging';
      document.getElementById('messagesContainer').innerHTML = '<div class="no-messages">Select a chat to start messaging</div>';
    }
    
    // Message deletion
    async function deleteMessage(messageId) {
      try {
        const response = await apiCall('/api/messages/' + messageId, {
          method: 'DELETE'
        });
        
        if (response && response.ok) {
          const messageEl = document.querySelector('[data-id="' + messageId + '"]');
          if (messageEl) {
            messageEl.remove();
          }
        }
      } catch (err) {
        console.error('Failed to delete message:', err);
      }
    }
    
    // Settings functions
    function openSettings() {
      let profilePic = currentUser.profilePic;
      if (profilePic && !profilePic.startsWith('http') && !profilePic.startsWith('data:')) {
        if (profilePic.startsWith('/uploads/')) {
          profilePic = '/proxy' + profilePic;
        } else if (profilePic.startsWith('uploads/')) {
          profilePic = '/proxy/' + profilePic;
        }
      }
      
      document.getElementById('settingsProfilePic').innerHTML = profilePic ? 
        '<img src="' + profilePic + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">' : '👤';
      document.getElementById('bioInput').value = currentUser.bio || '';
      document.getElementById('settingsModal').classList.add('active');
    }
    
    function previewProfilePic() {
      const file = document.getElementById('profilePicInput').files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
          document.getElementById('settingsProfilePic').innerHTML = '<img src="' + e.target.result + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">';
        };
        reader.readAsDataURL(file);
      }
    }
    
    async function saveSettings() {
      const bio = document.getElementById('bioInput').value.trim();
      const file = document.getElementById('profilePicInput').files[0];
      
      const formData = new FormData();
      formData.append('bio', bio);
      if (file) {
        formData.append('profilePic', file);
      }
      
      try {
        const response = await apiCall('/api/settings', {
          method: 'POST',
          body: formData
        });
        
        if (response && response.ok) {
          const data = await response.json();
          currentUser.profilePic = data.profilePic || currentUser.profilePic;
          currentUser.bio = bio;
          updateProfilePic(currentUser.profilePic, 'userProfilePic');
          closeModal('settingsModal');
          alert('Settings saved!');
        }
      } catch (err) {
        console.error('Failed to save settings:', err);
        alert('Failed to save settings. Please try again.');
      }
    }
    
    // Modal functions
    function closeModal(modalId) {
      document.getElementById(modalId).classList.remove('active');
    }
    
    // Polling for updates
    function startPolling() {
      messagePolling = setInterval(() => {
        if (currentChatPartner) {
          loadMessages();
        }
        loadChats();
        loadFriendRequests();
        testBackendConnection();
      }, 5000);
    }
    
    // Logout
    async function logout() {
      if (currentSession) {
        await apiCall('/api/logout', { method: 'POST' });
      }
      clearInterval(messagePolling);
      currentUser = null;
      currentSession = null;
      currentChatPartner = null;
      currentChatType = null;
      document.getElementById('appContainer').classList.remove('active');
      document.getElementById('authContainer').style.display = 'flex';
      document.getElementById('username').value = '';
      document.getElementById('password').value = '';
      document.getElementById('signupUsername').value = '';
      document.getElementById('signupPassword').value = '';
      document.getElementById('signupEmail').value = '';
      document.getElementById('verificationCode').value = '';
      document.getElementById('errorMsg').textContent = '';
      document.getElementById('successMsg').textContent = '';
      switchTab('login');
    }
    
    // Initialize
    document.addEventListener('DOMContentLoaded', async () => {
      // Test connection on load
      await testBackendConnection();
      
      // Event listeners for enter key
      document.getElementById('password')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleAuth();
      });
      
      document.getElementById('signupPassword')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleAuth();
      });
      
      document.getElementById('verificationCode')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') verifyEmail();
      });
      
      document.getElementById('messageInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
      
      // Auto-resize textarea
      const messageInput = document.getElementById('messageInput');
      if (messageInput) {
        messageInput.addEventListener('input', function() {
          this.style.height = 'auto';
          this.style.height = (this.scrollHeight) + 'px';
        });
      }
    });
  </script>
</body>
</html>
  `;
}

// API endpoints for the proxy
app.post('/api/set-backend', async (req, res) => {
  const { ip } = req.body;
  
  if (!ip) {
    return res.status(400).json({ error: 'IP is required' });
  }
  
  // Test connection first
  try {
    let testUrl = ip.trim();
    if (!testUrl.startsWith('http')) {
      testUrl = `http://${testUrl}`;
    }
    
    const testResponse = await axios.get(`${testUrl}/api/health`, {
      timeout: 10000
    });
    
    if (testResponse.data && testResponse.data.status === 'ok') {
      setHomeBackendIP(req, ip);
      return res.json({ 
        success: true, 
        message: 'Backend connected successfully',
        backendInfo: testResponse.data
      });
    }
  } catch (error) {
    console.log('Backend test failed, saving anyway:', error.message);
  }
  
  // Save even if test fails (user might fix it later)
  setHomeBackendIP(req, ip);
  return res.json({ 
    success: true, 
    message: 'Backend configuration saved',
    warning: 'Could not verify connection. Make sure your backend is running.'
  });
});

app.get('/api/get-backend', (req, res) => {
  const ip = getHomeBackendIP(req);
  res.json({ homeBackendIP: ip || null });
});

app.get('/api/health', (req, res) => {
  const homeBackendIP = getHomeBackendIP(req);
  res.json({
    status: 'ok',
    service: 'voidchat-render-proxy',
    homeBackendConfigured: !!homeBackendIP,
    homeBackendIP: homeBackendIP,
    timestamp: new Date().toISOString()
  });
});

// Proxy all API requests to home backend
const proxyApiRequest = async (req, res) => {
  try {
    const endpoint = req.originalUrl.replace('/proxy', '');
    const response = await makeRequestToHomeBackend(req, endpoint);
    
    // Forward the response
    res.status(response.status);
    
    // Copy headers
    Object.keys(response.headers).forEach(key => {
      res.setHeader(key, response.headers[key]);
    });
    
    // Send response data
    res.send(response.data);
    
  } catch (error) {
    console.error('Proxy error:', error.message);
    
    if (error.message === 'Home backend not configured') {
      return res.status(400).json({ 
        error: 'Home backend not configured',
        message: 'Please configure your home backend first'
      });
    }
    
    if (error.message.includes('Connection refused') || 
        error.message.includes('host not found') ||
        error.message.includes('timed out')) {
      return res.status(503).json({ 
        error: 'Cannot connect to home backend',
        message: error.message,
        solution: 'Check if your home backend is running and accessible'
      });
    }
    
    res.status(500).json({ 
      error: 'Proxy error',
      message: error.message 
    });
  }
};

// Register proxy routes for all API endpoints
app.all('/proxy/api/*', proxyApiRequest);

// Proxy uploads directory
app.get('/proxy/uploads/:filename', async (req, res) => {
  try {
    const endpoint = req.originalUrl.replace('/proxy', '');
    const response = await makeRequestToHomeBackend(req, endpoint);
    
    // Forward file
    res.status(response.status);
    Object.keys(response.headers).forEach(key => {
      res.setHeader(key, response.headers[key]);
    });
    res.send(response.data);
    
  } catch (error) {
    console.error('File proxy error:', error.message);
    res.status(500).send('File not available');
  }
});

// Handle file uploads through proxy
app.post('/proxy/api/messages', upload.single('image'), async (req, res) => {
  try {
    const endpoint = '/api/messages';
    const response = await makeRequestToHomeBackend(req, endpoint);
    
    res.status(response.status);
    Object.keys(response.headers).forEach(key => {
      res.setHeader(key, response.headers[key]);
    });
    res.send(response.data);
    
  } catch (error) {
    console.error('Upload proxy error:', error.message);
    res.status(500).json({ error: 'Upload failed', message: error.message });
  }
});

// Handle settings file upload
app.post('/proxy/api/settings', upload.single('profilePic'), async (req, res) => {
  try {
    const endpoint = '/api/settings';
    const response = await makeRequestToHomeBackend(req, endpoint);
    
    res.status(response.status);
    Object.keys(response.headers).forEach(key => {
      res.setHeader(key, response.headers[key]);
    });
    res.send(response.data);
    
  } catch (error) {
    console.error('Settings upload error:', error.message);
    res.status(500).json({ error: 'Settings update failed', message: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                     VOIDCHAT RENDER PROXY                           ║
║                     ======================                          ║
║                                                                     ║
║  🚀 Server running on port: ${PORT}                                   ║
║  🌐 Access: http://localhost:${PORT}                                  ║
║  🔗 Deploy to Render and access via your Render URL                ║
║                                                                     ║
║  📋 FEATURES:                                                       ║
║  • Complete frontend HTML integrated                                ║
║  • Proxies all API calls to your home backend                      ║
║  • Users configure home backend IP at /config                       ║
║  • File upload support through proxy                               ║
║  • Connection status monitoring                                    ║
║  • Session-based backend configuration                             ║
║                                                                     ║
║  🔧 SETUP:                                                          ║
║  1. Run home backend: node home-backend.js (port 8080)             ║
║  2. Port forward or use ngrok: ngrok http 8080                     ║
║  3. Deploy this to Render                                          ║
║  4. Visit Render URL → /config → enter home backend address        ║
║  5. All traffic routes through Render proxy                        ║
║                                                                     ║
║  ⚠️  IMPORTANT FOR RENDER:                                          ║
║  • Add SESSION_SECRET environment variable                         ║
║  • Set to random string in production                              ║
║                                                                     ║
╚══════════════════════════════════════════════════════════════════════╝
  `);
});

// Package.json for Render deployment
console.log('\n📦 package.json needed for Render:');
console.log(`
{
  "name": "voidchat-render-proxy",
  "version": "1.0.0",
  "description": "VoidChat Render Proxy Server",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "axios": "^1.6.0",
    "cookie-parser": "^1.4.6",
    "express-session": "^1.17.3",
    "multer": "^1.4.5-lts.1",
    "form-data": "^4.0.0"
  },
  "engines": {
    "node": ">=16.0.0"
  }
}
`);
