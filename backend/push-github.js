const fs = require('fs');
const path = require('path');

const ENV_FILE = 'C:\\Users\\chavi\\.env';
const PROJECT_DIR = path.join(__dirname, '..');

// 1. Simple dotenv parser
function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) {
    console.error(`Error: Environment file not found at ${ENV_FILE}`);
    process.exit(1);
  }
  const lines = fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/);
  const env = {};
  lines.forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      env[key] = value.trim();
    }
  });
  return env;
}

const env = loadEnv();
const TOKEN = env.GITHUB_TOKEN;

if (!TOKEN) {
  console.error('Error: GITHUB_TOKEN not found in env file.');
  process.exit(1);
}

// Headers builder
const headers = {
  'Authorization': `token ${TOKEN}`,
  'Accept': 'application/vnd.github.v3+json',
  'User-Agent': 'DevOS-Push-Script'
};

// Recursive file scanner
function getFiles(dir, relativeTo = dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    // Exclude folders we don't want to push
    if (file === 'node_modules' || file === 'node-portable' || file === '.git' || file === 'data' || file === 'node.zip') {
      return;
    }

    if (stat.isDirectory()) {
      results = results.concat(getFiles(filePath, relativeTo));
    } else {
      const relPath = path.relative(relativeTo, filePath).replace(/\\/g, '/');
      results.push({
        absolute: filePath,
        relative: relPath
      });
    }
  });
  return results;
}

async function run() {
  console.log('Fetching GitHub user profile details...');
  
  // 1. Get authenticated user
  const userRes = await fetch('https://api.github.com/user', { headers });
  if (!userRes.ok) {
    console.error('Failed to authenticate with GitHub. Check your GITHUB_TOKEN permissions.');
    process.exit(1);
  }
  const userData = await userRes.json();
  const username = userData.login;
  console.log(`Authenticated as GitHub user: ${username}`);
  console.log(`Token scopes: ${userRes.headers.get('x-oauth-scopes') || 'none'}`);

  const repoName = 'agentic-dev-os';
  console.log(`Checking if repository ${username}/${repoName} exists...`);

  // 2. Check if repo exists
  let repoExists = false;
  const repoCheckRes = await fetch(`https://api.github.com/repos/${username}/${repoName}`, { headers });
  if (repoCheckRes.ok) {
    repoExists = true;
    console.log(`Repository already exists at https://github.com/${username}/${repoName}`);
  } else {
    console.log(`Repository does not exist. Creating repository ${username}/${repoName}...`);
    const createRes = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: repoName,
        description: 'Production-grade multi-agent collaborative software engineering platform',
        private: false,
        auto_init: true
      })
    });

    if (!createRes.ok) {
      console.error('Failed to create repository:', await createRes.text());
      process.exit(1);
    }
    console.log('Repository created successfully.');
    // Sleep 2 seconds for GitHub initialization
    await new Promise(r => setTimeout(r, 2000));
  }

  // 3. Get latest commit SHA on main branch
  console.log('Retrieving default branch heads reference...');
  const refRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/git/ref/heads/main`, { headers });
  if (!refRes.ok) {
    console.error('Failed to retrieve branch reference. Make sure the repository contains at least one commit.');
    process.exit(1);
  }
  const refData = await refRes.json();
  const parentCommitSha = refData.object.sha;
  console.log(`Parent commit SHA: ${parentCommitSha}`);

  // 4. Get parent tree SHA
  const commitRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/git/commits/${parentCommitSha}`, { headers });
  const commitData = await commitRes.json();
  const baseTreeSha = commitData.tree.sha;
  console.log(`Base tree SHA: ${baseTreeSha}`);

  // 5. Scan local files
  console.log('Scanning project files...');
  const localFiles = getFiles(PROJECT_DIR);
  console.log(`Found ${localFiles.length} files to push.`);

  // 6. Create Git blobs
  const treeNodes = [];
  for (const file of localFiles) {
    console.log(`Uploading blob: ${file.relative}...`);
    const content = fs.readFileSync(file.absolute, 'utf8');
    
    const blobRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/git/blobs`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        encoding: 'utf-8'
      })
    });
    
    if (!blobRes.ok) {
      console.error(`Failed to create blob for ${file.relative}:`, await blobRes.text());
      process.exit(1);
    }
    
    const blobData = await blobRes.json();
    treeNodes.push({
      path: file.relative,
      mode: '100644',
      type: 'blob',
      sha: blobData.sha
    });
  }

  // 7. Create new Tree
  console.log('Generating tree on GitHub...');
  const treeRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/git/trees`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeNodes
    })
  });
  
  if (!treeRes.ok) {
    console.error('Failed to create tree:', await treeRes.text());
    process.exit(1);
  }
  const treeData = await treeRes.json();
  const newTreeSha = treeData.sha;
  console.log(`New tree SHA: ${newTreeSha}`);

  // 8. Create Commit
  console.log('Creating commit on GitHub...');
  const commitCreateRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/git/commits`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Initial commit of DevOS Collaborative Multi-Agent Platform',
      tree: newTreeSha,
      parents: [parentCommitSha]
    })
  });
  
  if (!commitCreateRes.ok) {
    console.error('Failed to create commit:', await commitCreateRes.text());
    process.exit(1);
  }
  const newCommitData = await commitCreateRes.json();
  const newCommitSha = newCommitData.sha;
  console.log(`New commit SHA: ${newCommitSha}`);

  // 9. Update branch reference
  console.log('Updating main branch reference...');
  const updateRefRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/git/refs/heads/main`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sha: newCommitSha,
      force: true
    })
  });

  if (!updateRefRes.ok) {
    console.error('Failed to update ref:', await updateRefRes.text());
    process.exit(1);
  }
  
  console.log('==================================================');
  console.log('🎉 Push successful! Project uploaded completely.');
  console.log(`🔗 Repo URL: https://github.com/${username}/${repoName}`);
  console.log('==================================================');
}

run().catch(err => {
  console.error('Push task error:', err.message);
  process.exit(1);
});
