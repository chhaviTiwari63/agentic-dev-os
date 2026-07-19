const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { MongoDB, Qdrant, Redis, generateMockVector } = require('./database');

class AgentOrchestrator extends EventEmitter {
  constructor(projectPath) {
    super();
    this.projectPath = projectPath;
    this.activeProject = null;
    this.isRunning = false;
    this.logs = [];
    this.tokenUsage = { prompt: 0, completion: 0, cost: 0 };
    this.taskQueue = [];
    
    // Clear and create generated folder
    this.generatedCodePath = path.join(this.projectPath, 'generated-code');
    if (!fs.existsSync(this.generatedCodePath)) {
      fs.mkdirSync(this.generatedCodePath, { recursive: true });
    }
  }

  log(agent, message, type = 'info', metadata = {}) {
    const logEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      agent,
      message,
      type, // info, success, warning, error, code, chat
      metadata
    };
    this.logs.push(logEntry);
    this.emit('log', logEntry);
    
    // Update token usage and costs
    const isLLM = ['PM', 'Architect', 'Frontend', 'Backend', 'DB', 'DevOps', 'QA', 'Security', 'Reviewer'].includes(agent);
    if (isLLM) {
      const promptTokens = Math.floor(Math.random() * 800) + 400;
      const completionTokens = Math.floor(Math.random() * 1200) + 200;
      // standard pricing $0.015 / 1k input, $0.060 / 1k output
      const cost = (promptTokens * 0.000015) + (completionTokens * 0.00006);
      
      this.tokenUsage.prompt += promptTokens;
      this.tokenUsage.completion += completionTokens;
      this.tokenUsage.cost += cost;
      
      this.emit('metrics', {
        tokenUsage: this.tokenUsage,
        activeAgent: agent,
        progress: this.calculateProgress()
      });
    }
  }

  calculateProgress() {
    if (!this.activeProject) return 0;
    const tasks = MongoDB.find('tasks', { projectId: this.activeProject.id });
    if (tasks.length === 0) return 0;
    const completed = tasks.filter(t => t.status === 'completed').length;
    return Math.round((completed / tasks.length) * 100);
  }

  async startProject(requirements) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.tokenUsage = { prompt: 0, completion: 0, cost: 0 };
    this.logs = [];

    // Create a new project in mock MongoDB
    this.activeProject = MongoDB.insertOne('projects', {
      name: requirements.substring(0, 30) + '...',
      requirements,
      status: 'analyzing'
    });

    this.log('System', `Initiating project DevOS-${this.activeProject.id} with requirements: "${requirements}"`, 'info');

    // Run the multi-agent execution pipeline
    try {
      await this.runPipeline();
    } catch (e) {
      this.log('System', `Pipeline failed: ${e.message}`, 'error');
    } finally {
      this.isRunning = false;
      this.emit('finished', { projectId: this.activeProject.id });
    }
  }

  async runPipeline() {
    // 1. PM Agent analyzes requirements and builds roadmap
    await this.runPMAgent();

    // 2. Architect Agent creates system design and architecture
    await this.runArchitectAgent();

    // Wait for User Approval on architecture
    this.log('System', 'Awaiting User Approval for System Architecture & Technology Stack...', 'warning', {
      actionRequired: 'approve_architecture',
      choices: ['Approve Design', 'Request Revision']
    });
    
    // In our simulator, we wait for a pub/sub event from the WebSocket handler,
    // but we will also auto-proceed after 12 seconds if not manually clicked, for demo purposes.
    await this.waitForApproval('approve_architecture', 12000);

    // 3. Database Engineer designs database scheme
    await this.runDBEngineerAgent();

    // 4. Backend Engineer creates API endpoints and backend code
    await this.runBackendEngineerAgent();

    // 5. Frontend Engineer creates user interface and components
    await this.runFrontendEngineerAgent();

    // 6. Security Engineer scans code for vulnerabilities
    await this.runSecurityAgent();

    // 7. Code Reviewer reviews code and raises comments
    await this.runReviewerAgent();

    // Wait for User Approval on Code Merge
    this.log('System', 'Awaiting User Approval to merge Pull Request #1 into main branch...', 'warning', {
      actionRequired: 'merge_pr',
      choices: ['Merge Pull Request', 'Reject & Request Fixes']
    });
    
    await this.waitForApproval('merge_pr', 12000);

    // 8. QA Engineer runs test suite and builds verification
    await this.runQAAgent();

    // 9. DevOps Engineer builds docker files, configures CI/CD and deploys
    await this.runDevOpsAgent();

    MongoDB.updateOne('projects', { id: this.activeProject.id }, { status: 'completed' });
    this.log('System', `Project DevOS-${this.activeProject.id} has been fully completed and deployed successfully!`, 'success');
  }

  async waitForApproval(actionName, timeoutMs) {
    return new Promise((resolve) => {
      let resolved = false;
      
      const onApprove = (msg) => {
        const data = JSON.parse(msg);
        if (data.action === actionName) {
          resolved = true;
          cleanup();
          this.log('User', `Approved action: ${actionName}`, 'success');
          resolve(true);
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.off('user_approval', onApprove);
      };

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          this.log('System', `Auto-approving action: ${actionName} (Simulation Time Limit reached)`, 'info');
          resolve(true);
        }
      }, timeoutMs);

      this.on('user_approval', onApprove);
    });
  }

  async runPMAgent() {
    this.log('PM', 'Analyzing requirements and planning software roadmap...', 'chat');
    await sleep(2500);

    const epics = [
      { name: 'Core Infrastructure & API Backend', desc: 'Setup Express server, DB connectivity, and models.' },
      { name: 'User Experience & React Components', desc: 'Create frontend routing, layouts, and interactive components.' },
      { name: 'Integration & Deployment', desc: 'Docker configuration, CI/CD pipeline, and public cloud deployment.' }
    ];

    const tasks = [
      { epicIdx: 0, name: 'Setup database schema & connections', agent: 'DB', complexity: 'Medium' },
      { epicIdx: 0, name: 'Build authentication & token management APIs', agent: 'Backend', complexity: 'High' },
      { epicIdx: 0, name: 'Create main resource CRUD endpoints', agent: 'Backend', complexity: 'Low' },
      { epicIdx: 1, name: 'Design layout & global state (Zustand)', agent: 'Frontend', complexity: 'Medium' },
      { epicIdx: 1, name: 'Implement responsive dashboard & detail views', agent: 'Frontend', complexity: 'High' },
      { epicIdx: 2, name: 'Write automated unit & integration tests', agent: 'QA', complexity: 'Medium' },
      { epicIdx: 2, name: 'Configure Dockerfile & Kubernetes scripts', agent: 'DevOps', complexity: 'Medium' }
    ];

    // Store in MongoDB
    epics.forEach((epic, idx) => {
      const createdEpic = MongoDB.insertOne('epics', {
        projectId: this.activeProject.id,
        name: epic.name,
        description: epic.desc,
        status: 'in-progress'
      });
      
      // Store Tasks
      tasks.filter(t => t.epicIdx === idx).forEach(t => {
        MongoDB.insertOne('tasks', {
          projectId: this.activeProject.id,
          epicId: createdEpic.id,
          name: t.name,
          assignee: t.agent,
          status: 'pending',
          complexity: t.complexity
        });
      });
    });

    this.log('PM', 'Requirements broken down into 3 Epics and 7 Tasks. Created project timeline and gantt milestones.', 'success', {
      epics: MongoDB.find('epics', { projectId: this.activeProject.id }),
      tasks: MongoDB.find('tasks', { projectId: this.activeProject.id })
    });
    
    // Save roadmap details as a markdown file for RAG
    const roadmapMD = `# Project Roadmap: ${this.activeProject.name}\n\n## Epics\n` + 
      epics.map(e => `### ${e.name}\n${e.desc}`).join('\n\n');
    fs.writeFileSync(path.join(this.generatedCodePath, 'roadmap.md'), roadmapMD);
    
    // Index in Qdrant for RAG
    await Qdrant.upsert('docs', [{
      id: `roadmap_${this.activeProject.id}`,
      vector: generateMockVector(roadmapMD),
      payload: { text: roadmapMD, type: 'documentation', projectId: this.activeProject.id }
    }]);
  }

  async runArchitectAgent() {
    this.log('Architect', 'Collaborating with PM. Designing technical layout, tech stack, and modular system boundaries...', 'chat');
    await sleep(3000);

    const architectureDoc = `## System Architecture Spec
- **Backend Stack**: Node.js, Express, REST APIs, JSON validation
- **Frontend Stack**: React, Tailwind CSS, Component hierarchies
- **Storage Layer**: Relational/NoSQL schemas
- **Inter-service Protocol**: Event-driven Message Bus
`;
    fs.writeFileSync(path.join(this.generatedCodePath, 'architecture.md'), architectureDoc);

    this.log('Architect', 'System design spec created. Registered technical stack in Knowledge Graph. Prepared repository directory layouts.', 'success');
  }

  async runDBEngineerAgent() {
    this.log('DB', 'Creating database connection client and collection structures...', 'chat');
    await sleep(2500);

    // Update DB task in MongoDB
    const dbTask = MongoDB.find('tasks', { projectId: this.activeProject.id, assignee: 'DB' })[0];
    if (dbTask) MongoDB.updateOne('tasks', { id: dbTask.id }, { status: 'in-progress' });

    const dbCode = `// Database Connection Manager
const { MongoClient } = require('mongodb');

const dbUri = process.env.MONGO_URI || 'mongodb://localhost:27017/app';
let dbClient = null;

async function connectDB() {
  if (dbClient) return dbClient;
  try {
    dbClient = await MongoClient.connect(dbUri);
    console.log('Connected to MongoDB successfully.');
    return dbClient;
  } catch (error) {
    console.error('Database connection failed:', error.message);
    throw error;
  }
}

module.exports = { connectDB };
`;
    fs.writeFileSync(path.join(this.generatedCodePath, 'db.js'), dbCode);

    if (dbTask) MongoDB.updateOne('tasks', { id: dbTask.id }, { status: 'completed' });
    this.log('DB', 'Database driver module written to files: [db.js](file:///' + path.join(this.generatedCodePath, 'db.js').replace(/\\/g, '/') + '). Created tables structures.', 'success');
  }

  async runBackendEngineerAgent() {
    this.log('Backend', 'Reading architecture.md. Writing main Express REST API server, routing modules, and CRUD controllers...', 'chat');
    await sleep(3500);

    const beTasks = MongoDB.find('tasks', { projectId: this.activeProject.id, assignee: 'Backend' });
    beTasks.forEach(t => MongoDB.updateOne('tasks', { id: t.id }, { status: 'in-progress' }));

    const serverCode = `// Main Application Server
const express = require('express');
const { connectDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());

// Auth Middleware (Mock)
app.use((req, res, next) => {
  const token = req.headers['authorization'];
  if (!token && req.path !== '/login') {
    return res.status(401).json({ error: 'Unauthorized: Missing Auth Token' });
  }
  next();
});

// Resource routes
app.get('/api/data', async (req, res) => {
  res.json({ status: 'ok', data: ['item1', 'item2', 'item3'], timestamp: new Date() });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'secret') {
    res.json({ token: 'jwt-session-token-mock' });
  } else {
    res.status(400).json({ error: 'Invalid credentials' });
  }
});

// Start Server
app.listen(PORT, async () => {
  await connectDB().catch(e => console.log('DB Connection skipped.'));
  console.log(\`Server is running on port \${PORT}\`);
});

module.exports = app;
`;
    fs.writeFileSync(path.join(this.generatedCodePath, 'server.js'), serverCode);

    beTasks.forEach(t => MongoDB.updateOne('tasks', { id: t.id }, { status: 'completed' }));
    this.log('Backend', 'Express core routing and authentication middlewares written in [server.js](file:///' + path.join(this.generatedCodePath, 'server.js').replace(/\\/g, '/') + '). Ready for review.', 'success');
  }

  async runFrontendEngineerAgent() {
    this.log('Frontend', 'Designing component hierarchy. Constructing Zustand state stores and Tailwind layouts...', 'chat');
    await sleep(3500);

    const feTasks = MongoDB.find('tasks', { projectId: this.activeProject.id, assignee: 'Frontend' });
    feTasks.forEach(t => MongoDB.updateOne('tasks', { id: t.id }, { status: 'in-progress' }));

    const storeCode = `// State Store using Zustand
import create from 'zustand';

export const useStore = create((set) => ({
  user: null,
  items: [],
  loading: false,
  error: null,
  login: async (username, password) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok) {
        set({ user: data.token, loading: false });
      } else {
        set({ error: data.error, loading: false });
      }
    } catch (e) {
      set({ error: e.message, loading: false });
    }
  },
  fetchItems: async () => {
    set({ loading: true });
    try {
      const res = await fetch('/api/data', {
        headers: { 'Authorization': 'Bearer ' + useStore.getState().user }
      });
      const data = await res.json();
      set({ items: data.data, loading: false });
    } catch (e) {
      set({ error: e.message, loading: false });
    }
  }
}));
`;
    fs.writeFileSync(path.join(this.generatedCodePath, 'store.js'), storeCode);

    const componentCode = `// React Dashboard Component
import React, { useEffect } from 'react';
import { useStore } from './store';

export default function Dashboard() {
  const { user, items, fetchItems, login, error } = useStore();

  useEffect(() => {
    if (user) {
      fetchItems();
    }
  }, [user]);

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-900 text-white">
        <form className="w-80 rounded-xl bg-slate-800 p-6 shadow-lg border border-slate-700" onSubmit={(e) => {
          e.preventDefault();
          login('admin', 'secret');
        }}>
          <h2 className="mb-4 text-xl font-bold text-indigo-400">Admin Login</h2>
          <input className="mb-3 w-full rounded bg-slate-700 p-2 text-white border border-slate-600 focus:outline-none focus:border-indigo-500" placeholder="Username" type="text" />
          <input className="mb-4 w-full rounded bg-slate-700 p-2 text-white border border-slate-600 focus:outline-none focus:border-indigo-500" placeholder="Password" type="password" />
          {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
          <button className="w-full rounded bg-indigo-600 p-2 font-bold hover:bg-indigo-500 transition-colors">Sign In</button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 p-8 text-white">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-6 text-3xl font-extrabold text-indigo-400">DevOS Dynamic Dashboard</h1>
        <div className="rounded-2xl border border-slate-700 bg-slate-800/50 p-6 backdrop-blur-md">
          <h2 className="mb-4 text-xl font-semibold">Server Resources</h2>
          <ul className="space-y-2">
            {items.map((item, idx) => (
              <li key={idx} className="rounded-lg bg-slate-800 p-3 border border-slate-700/50 flex justify-between items-center">
                <span>{item}</span>
                <span className="text-xs text-indigo-300">Status: Active</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
`;
    fs.writeFileSync(path.join(this.generatedCodePath, 'dashboard.jsx'), componentCode);

    feTasks.forEach(t => MongoDB.updateOne('tasks', { id: t.id }, { status: 'completed' }));
    this.log('Frontend', 'Dashboard state store [store.js](file:///' + path.join(this.generatedCodePath, 'store.js').replace(/\\/g, '/') + ') and components [dashboard.jsx](file:///' + path.join(this.generatedCodePath, 'dashboard.jsx').replace(/\\/g, '/') + ') committed.', 'success');
  }

  async runSecurityAgent() {
    this.log('Security', 'Scanning codebase for static security concerns, leaked keys, and vulnerable imports...', 'chat');
    await sleep(2500);

    const issues = [];
    const dbFile = fs.readFileSync(path.join(this.generatedCodePath, 'db.js'), 'utf8');
    if (dbFile.includes('localhost:27017')) {
      issues.push('Hardcoded local MongoDB database URI fallback detected in db.js.');
    }

    this.log('Security', 'Security audit finished. Found 1 minor issue: ' + issues.join(' ') + ' (Passed check with warning).', 'warning');
  }

  async runReviewerAgent() {
    this.log('Reviewer', 'Analyzing git diff and structure of commits in Pull Request #1...', 'chat');
    await sleep(3000);

    const comments = [
      { file: 'server.js', line: 12, text: 'Consider hashing local tokens or using encrypted browser cookies.' },
      { file: 'db.js', line: 6, text: 'Environment injection is handled correctly but ensure variables are documented.' }
    ];

    this.log('Reviewer', 'Reviewed files: [server.js](file:///' + path.join(this.generatedCodePath, 'server.js').replace(/\\/g, '/') + '), [db.js](file:///' + path.join(this.generatedCodePath, 'db.js').replace(/\\/g, '/') + '). Created 2 review comments.', 'info', { comments });
  }

  async runQAAgent() {
    this.log('QA', 'Writing automated testing suites and code verification assertions...', 'chat');
    await sleep(2500);

    const qaTask = MongoDB.find('tasks', { projectId: this.activeProject.id, assignee: 'QA' })[0];
    if (qaTask) MongoDB.updateOne('tasks', { id: qaTask.id }, { status: 'in-progress' });

    const testCode = `// Unit tests
const assert = require('assert');

// Mock Testing Endpoint API
console.log('Running test: Auth token middleware protection...');
const mockReq = { headers: {}, path: '/api/data' };
const mockRes = {
  status: function(code) {
    assert.strictEqual(code, 401);
    return {
      json: function(obj) {
        assert.strictEqual(obj.error, 'Unauthorized: Missing Auth Token');
        console.log('✔ Auth Protection Passed!');
      }
    };
  }
};

const next = () => {
  throw new Error('Should not hit next without a token.');
};

// Execute test run
try {
  console.log('Testing authentication...');
  console.log('✔ All tests passed successfully.');
} catch (e) {
  console.error('Test suite failed:', e.message);
  process.exit(1);
}
`;
    fs.writeFileSync(path.join(this.generatedCodePath, 'test.js'), testCode);

    if (qaTask) MongoDB.updateOne('tasks', { id: qaTask.id }, { status: 'completed' });
    this.log('QA', 'Testing scripts written to [test.js](file:///' + path.join(this.generatedCodePath, 'test.js').replace(/\\/g, '/') + '). Output indicates 100% of test suites resolved successfully.', 'success');
  }

  async runDevOpsAgent() {
    this.log('DevOps', 'Creating Dockerfile, docker-compose script, and configuration maps...', 'chat');
    await sleep(2500);

    const doTask = MongoDB.find('tasks', { projectId: this.activeProject.id, assignee: 'DevOps' })[0];
    if (doTask) MongoDB.updateOne('tasks', { id: doTask.id }, { status: 'in-progress' });

    const dockerfile = `FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 4000
CMD ["node", "server.js"]
`;
    fs.writeFileSync(path.join(this.generatedCodePath, 'Dockerfile'), dockerfile);

    const compose = `version: '3.8'
services:
  app:
    build: .
    ports:
      - "4000:4000"
    environment:
      - MONGO_URI=mongodb://db:27017/app
    depends_on:
      - db
  db:
    image: mongo:6.0
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db
volumes:
  mongo_data:
`;
    fs.writeFileSync(path.join(this.generatedCodePath, 'docker-compose.yml'), compose);

    if (doTask) MongoDB.updateOne('tasks', { id: doTask.id }, { status: 'completed' });
    this.log('DevOps', 'Dockerfile and Compose configs saved to files. Automated builds completed.', 'success');
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = AgentOrchestrator;
