// index.js - Vercel Backend with integrated frontend
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PASSWORD = '123456789';
const TERMUX_BACKEND = process.env.TERMUX_BACKEND_URL || 'http://localhost:8080';

let termuxSocket;
const authenticatedClients = new Set();

// Serve frontend HTML
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Remote Terminal</title>
    <script src="/socket.io/socket.io.js"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css" />
    <script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Courier New', monospace;
            background: #1e1e1e;
            color: #fff;
            height: 100vh;
            overflow: hidden;
        }
        .login-screen {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }
        .login-screen.hidden { display: none; }
        .login-box {
            background: rgba(255,255,255,0.1);
            padding: 40px;
            border-radius: 20px;
            backdrop-filter: blur(10px);
            text-align: center;
            max-width: 400px;
        }
        .login-box h1 {
            font-size: 2.5em;
            margin-bottom: 30px;
        }
        .login-box input {
            width: 100%;
            padding: 15px;
            background: rgba(0,0,0,0.3);
            border: 2px solid rgba(255,255,255,0.3);
            border-radius: 10px;
            color: white;
            font-size: 16px;
            margin-bottom: 20px;
        }
        .login-box input::placeholder { color: rgba(255,255,255,0.5); }
        .login-box button {
            width: 100%;
            padding: 15px;
            background: white;
            border: none;
            border-radius: 10px;
            color: #667eea;
            font-size: 18px;
            font-weight: bold;
            cursor: pointer;
        }
        .login-box button:hover { transform: scale(1.05); }
        .error {
            color: #ff6b6b;
            margin-top: 10px;
            font-size: 14px;
        }
        .app {
            display: flex;
            flex-direction: column;
            height: 100vh;
        }
        .app.hidden { display: none; }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 12px 20px;
            display: flex;
            align-items: center;
            gap: 15px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        }
        .header h1 { font-size: 20px; flex: 1; }
        .status {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 5px 12px;
            background: rgba(0,0,0,0.2);
            border-radius: 15px;
            font-size: 13px;
        }
        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #f44336;
        }
        .status-dot.connected {
            background: #4CAF50;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        .tabs {
            display: flex;
            gap: 5px;
            padding: 8px 20px;
            background: #252525;
            overflow-x: auto;
            border-bottom: 1px solid #3d3d3d;
        }
        .tab {
            padding: 10px 15px;
            background: #3d3d3d;
            border: none;
            color: #fff;
            cursor: pointer;
            border-radius: 8px 8px 0 0;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.2s;
        }
        .tab.active { background: #1e1e1e; }
        .tab:hover { background: #4d4d4d; }
        .tab-close {
            color: #888;
            cursor: pointer;
        }
        .tab-close:hover { color: #fff; }
        .new-tab {
            background: #667eea;
            padding: 10px 15px;
            border: none;
            color: #fff;
            cursor: pointer;
            border-radius: 8px;
            font-size: 16px;
        }
        .new-tab:hover { background: #5569d8; }
        .terminals {
            flex: 1;
            position: relative;
            overflow: hidden;
        }
        .terminal-container {
            display: none;
            width: 100%;
            height: 100%;
            padding: 10px;
        }
        .terminal-container.active { display: block; }
    </style>
</head>
<body>
    <div class="login-screen" id="login-screen">
        <div class="login-box">
            <h1>🔐 Terminal Access</h1>
            <input type="password" id="password" placeholder="Enter password" onkeypress="if(event.key==='Enter')login()" />
            <button onclick="login()">Login</button>
            <div class="error" id="error"></div>
        </div>
    </div>

    <div class="app hidden" id="app">
        <div class="header">
            <h1>🖥️ Remote Terminal</h1>
            <div class="status">
                <div class="status-dot" id="status-dot"></div>
                <span id="status-text">Connecting...</span>
            </div>
        </div>
        
        <div class="tabs" id="tabs">
            <button class="new-tab" onclick="createTerminal()">+</button>
        </div>
        
        <div class="terminals" id="terminals"></div>
    </div>

    <script>
        let socket = null;
        const terminals = {};
        let activeTerminal = null;
        let authenticated = false;
        
        function login() {
            const password = document.getElementById('password').value;
            const errorEl = document.getElementById('error');
            
            // Connect to Vercel backend (same origin)
            socket = io({
                path: '/socket.io'
            });
            
            socket.on('connect', () => {
                // Authenticate
                socket.emit('authenticate', { password: password });
            });
            
            socket.on('auth_success', () => {
                authenticated = true;
                document.getElementById('login-screen').classList.add('hidden');
                document.getElementById('app').classList.remove('hidden');
                
                // Update status
                document.getElementById('status-text').textContent = 'Connected';
                document.getElementById('status-dot').classList.add('connected');
                
                // Create first terminal
                createTerminal();
            });
            
            socket.on('auth_failed', (data) => {
                errorEl.textContent = data.message || 'Authentication failed';
                socket.disconnect();
            });
            
            socket.on('backend_status', (data) => {
                if (data.connected) {
                    document.getElementById('status-text').textContent = 'Connected';
                    document.getElementById('status-dot').classList.add('connected');
                } else {
                    document.getElementById('status-text').textContent = 'Backend Offline';
                    document.getElementById('status-dot').classList.remove('connected');
                }
            });
            
            socket.on('output', (data) => {
                const term = terminals[data.session_id];
                if (term) {
                    term.xterm.write(data.data);
                }
            });
            
            socket.on('disconnect', () => {
                document.getElementById('status-text').textContent = 'Disconnected';
                document.getElementById('status-dot').classList.remove('connected');
            });
        }
        
        function createTerminal() {
            if (!socket || !socket.connected || !authenticated) {
                alert('Not connected!');
                return;
            }
            
            const sessionId = generateId();
            
            const container = document.createElement('div');
            container.className = 'terminal-container';
            container.id = 'term-' + sessionId;
            document.getElementById('terminals').appendChild(container);
            
            const xterm = new Terminal({
                cursorBlink: true,
                fontSize: 14,
                fontFamily: 'Courier New, monospace',
                theme: {
                    background: '#1e1e1e',
                    foreground: '#ffffff'
                }
            });
            
            const fitAddon = new FitAddon.FitAddon();
            xterm.loadAddon(fitAddon);
            xterm.open(container);
            fitAddon.fit();
            
            xterm.onData((data) => {
                if (data === '\\x03') {
                    socket.emit('signal', { session_id: sessionId, signal: 2 });
                } else {
                    socket.emit('input', { session_id: sessionId, data: data });
                }
            });
            
            window.addEventListener('resize', () => fitAddon.fit());
            xterm.onResize((size) => {
                socket.emit('resize', {
                    session_id: sessionId,
                    rows: size.rows,
                    cols: size.cols
                });
            });
            
            terminals[sessionId] = { xterm, fitAddon, container };
            createTab(sessionId);
            socket.emit('new_session', { session_id: sessionId });
            switchTerminal(sessionId);
        }
        
        function createTab(sessionId) {
            const tab = document.createElement('button');
            tab.className = 'tab';
            tab.id = 'tab-' + sessionId;
            tab.innerHTML = \`
                Terminal \${Object.keys(terminals).length}
                <span class="tab-close" onclick="closeTerminal('\${sessionId}', event)">✕</span>
            \`;
            tab.onclick = () => switchTerminal(sessionId);
            
            const tabsContainer = document.getElementById('tabs');
            tabsContainer.insertBefore(tab, tabsContainer.lastChild);
        }
        
        function switchTerminal(sessionId) {
            Object.values(terminals).forEach(t => t.container.classList.remove('active'));
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            
            terminals[sessionId].container.classList.add('active');
            document.getElementById('tab-' + sessionId).classList.add('active');
            activeTerminal = sessionId;
            
            terminals[sessionId].fitAddon.fit();
            terminals[sessionId].xterm.focus();
        }
        
        function closeTerminal(sessionId, event) {
            event.stopPropagation();
            
            if (Object.keys(terminals).length === 1) {
                alert('Cannot close the last terminal');
                return;
            }
            
            socket.emit('close_session', { session_id: sessionId });
            
            terminals[sessionId].xterm.dispose();
            terminals[sessionId].container.remove();
            document.getElementById('tab-' + sessionId).remove();
            delete terminals[sessionId];
            
            const remainingIds = Object.keys(terminals);
            if (remainingIds.length > 0) {
                switchTerminal(remainingIds[0]);
            }
        }
        
        function generateId() {
            return Math.random().toString(36).substr(2, 9);
        }
    </script>
</body>
</html>
  `);
});

// Connect to Termux backend
function connectToTermux() {
  console.log('Connecting to Termux backend:', TERMUX_BACKEND);
  
  termuxSocket = ioClient(TERMUX_BACKEND + '/terminal', {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000
  });
  
  termuxSocket.on('connect', () => {
    console.log('✅ Connected to Termux backend');
    io.emit('backend_status', { connected: true });
  });
  
  termuxSocket.on('disconnect', () => {
    console.log('❌ Disconnected from Termux backend');
    io.emit('backend_status', { connected: false });
  });
  
  termuxSocket.on('output', (data) => {
    io.emit('output', data);
  });
}

// Handle browser connections
io.on('connection', (socket) => {
  console.log('Browser client connected:', socket.id);
  
  socket.on('authenticate', (data) => {
    if (data.password === PASSWORD) {
      authenticatedClients.add(socket.id);
      socket.emit('auth_success');
      console.log('✅ Client authenticated:', socket.id);
    } else {
      socket.emit('auth_failed', { message: 'Invalid password' });
      socket.disconnect();
    }
  });
  
  socket.on('new_session', (data) => {
    if (!authenticatedClients.has(socket.id)) return;
    if (termuxSocket && termuxSocket.connected) {
      termuxSocket.emit('new_session', data);
    }
  });
  
  socket.on('input', (data) => {
    if (!authenticatedClients.has(socket.id)) return;
    if (termuxSocket && termuxSocket.connected) {
      termuxSocket.emit('input', data);
    }
  });
  
  socket.on('resize', (data) => {
    if (!authenticatedClients.has(socket.id)) return;
    if (termuxSocket && termuxSocket.connected) {
      termuxSocket.emit('resize', data);
    }
  });
  
  socket.on('signal', (data) => {
    if (!authenticatedClients.has(socket.id)) return;
    if (termuxSocket && termuxSocket.connected) {
      termuxSocket.emit('signal', data);
    }
  });
  
  socket.on('close_session', (data) => {
    if (!authenticatedClients.has(socket.id)) return;
    if (termuxSocket && termuxSocket.connected) {
      termuxSocket.emit('close_session', data);
    }
  });
  
  socket.on('disconnect', () => {
    authenticatedClients.delete(socket.id);
    console.log('Browser client disconnected:', socket.id);
  });
});

// Start connecting to Termux
connectToTermux();

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(\`🚀 Vercel relay server on port \${PORT}\`);
  console.log(\`🔑 Password: \${PASSWORD}\`);
});

module.exports = app;
