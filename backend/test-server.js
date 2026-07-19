console.log('Starting integration tests on DevOS backend...');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runTests() {
  // Start server programmatically
  const server = require('./server');
  await sleep(1000); // Wait for server boot

  try {
    // Test 1: Fetch project status
    console.log('Running test 1: GET /api/project/status...');
    const statusRes = await fetch('http://localhost:3000/api/project/status');
    const statusJson = await statusRes.json();
    
    if (statusJson.hasOwnProperty('isRunning') && statusJson.hasOwnProperty('progress')) {
      console.log('✔ Test 1 passed: /api/project/status returned valid properties.');
    } else {
      throw new Error('Test 1 failed: missing properties in response.');
    }

    // Test 2: Fetch files
    console.log('Running test 2: GET /api/files...');
    const filesRes = await fetch('http://localhost:3000/api/files');
    const filesJson = await filesRes.json();
    
    if (Array.isArray(filesJson)) {
      console.log('✔ Test 2 passed: /api/files returned file list.');
    } else {
      throw new Error('Test 2 failed: response is not an array.');
    }

    console.log('==================================================');
    console.log('✔ All Integration Tests Completed Successfully!');
    console.log('==================================================');
    process.exit(0);
  } catch (err) {
    console.error('✖ Integration test failed:', err.message);
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test framework error:', err.message);
  process.exit(1);
});
