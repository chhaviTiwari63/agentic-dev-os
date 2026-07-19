const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { MongoDB, Redis, Qdrant } = require('./database');
const AgentOrchestrator = require('./orchestrator');

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'frontend');
const orchestrator = new AgentOrchestrator(path.join(__dirname, '..'));

// Create HTTP Server
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // API Endpoints
  if (pathname === '/api/project' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { requirements } = JSON.parse(body);
        if (!requirements) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Missing requirements' }));
        }
        
        // Start orchestrator async
        orchestrator.startProject(requirements);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'started', message: 'Agent pipeline triggered.' }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
    return;
  }

  if (pathname === '/api/project/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      activeProject: orchestrator.activeProject,
      isRunning: orchestrator.isRunning,
      progress: orchestrator.calculateProgress(),
      tokenUsage: orchestrator.tokenUsage,
      epics: orchestrator.activeProject ? MongoDB.find('epics', { projectId: orchestrator.activeProject.id }) : [],
      tasks: orchestrator.activeProject ? MongoDB.find('tasks', { projectId: orchestrator.activeProject.id }) : [],
      logs: orchestrator.logs
    }));
  }

  // Fetch the structure of generated files
  if (pathname === '/api/files' && req.method === 'GET') {
    const filesDir = orchestrator.generatedCodePath;
    if (!fs.existsSync(filesDir)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify([]));
    }

    const listFilesRecursive = (dir) => {
      let results = [];
      const list = fs.readdirSync(dir);
      list.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          results.push({
            name: file,
            type: 'directory',
            children: listFilesRecursive(filePath)
          });
        } else {
          results.push({
            name: file,
            type: 'file',
            path: filePath.substring(orchestrator.projectPath.length + 1).replace(/\\/g, '/')
          });
        }
      });
      return results;
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(listFilesRecursive(filesDir)));
  }

  // Get file content
  if (pathname === '/api/file/content' && req.method === 'GET') {
    const relativePath = url.searchParams.get('path');
    if (!relativePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing path parameter' }));
    }

    const fullPath = path.join(orchestrator.projectPath, relativePath);
    // Security check: ensure file is inside project
    if (!fullPath.startsWith(orchestrator.projectPath)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Forbidden' }));
    }

    if (!fs.existsSync(fullPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'File not found' }));
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end(content);
  }

  // Approve manual actions (e.g. merge PR, approve architecture)
  if (pathname === '/api/action/approve' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { action } = JSON.parse(body);
        if (!action) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Missing action parameter' }));
        }

        // Publish to user_approval event in the orchestrator
        orchestrator.emit('user_approval', JSON.stringify({ action }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', message: `Approved ${action}` }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
    return;
  }

  // Serve static files from frontend/
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  // Fallback check in case directories are nested differently
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('File not found');
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };

  const contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code == 'ENOENT') {
        res.writeHead(404);
        res.end('File not found');
      } else {
        res.writeHead(500);
        res.end('Sorry, check with the site admin for error: ' + error.code + ' ..\n');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

// Setup WebSocket Server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('Client connected to WebSocket.');
  
  // Send current project state immediately on connect
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      activeProject: orchestrator.activeProject,
      isRunning: orchestrator.isRunning,
      progress: orchestrator.calculateProgress(),
      tokenUsage: orchestrator.tokenUsage,
      epics: orchestrator.activeProject ? MongoDB.find('epics', { projectId: orchestrator.activeProject.id }) : [],
      tasks: orchestrator.activeProject ? MongoDB.find('tasks', { projectId: orchestrator.activeProject.id }) : [],
      logs: orchestrator.logs
    }
  }));

  // Setup callbacks for orchestrator events
  const onLog = (logEntry) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'log', data: logEntry }));
    }
  };

  const onMetrics = (metrics) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'metrics', data: metrics }));
    }
  };

  const onFinished = (info) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'finished', data: info }));
    }
  };

  orchestrator.on('log', onLog);
  orchestrator.on('metrics', onMetrics);
  orchestrator.on('finished', onFinished);

  ws.on('close', () => {
    orchestrator.off('log', onLog);
    orchestrator.off('metrics', onMetrics);
    orchestrator.off('finished', onFinished);
    console.log('Client disconnected from WebSocket.');
  });
});

// Start Server
server.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`🚀 DevOS Server running at: http://localhost:${PORT}`);
  console.log(`==================================================`);
});
