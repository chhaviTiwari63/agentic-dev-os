const fs = require('fs');
const token = process.argv[2];

if (!token) {
  console.error("Error: Please provide the token as an argument.");
  process.exit(1);
}

const envPath = 'C:\\Users\\chavi\\.env';
let content = '';
if (fs.existsSync(envPath)) {
  content = fs.readFileSync(envPath, 'utf8');
}

const lines = content.split(/\r?\n/).filter(line => !line.startsWith('GITHUB_TOKEN=') && line.trim() !== '');
lines.push(`GITHUB_TOKEN=${token.trim()}`);
fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf8');
console.log("Token saved successfully!");
