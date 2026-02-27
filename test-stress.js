const autocannon = require('autocannon');
const assert = require('assert');

async function runStressTest() {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    console.log(`🚀 Starting Autocannon Stress Test on ${baseUrl} ...\n`);

    // 1. Provision a test user and token to use during the stress test
    console.log('Provisioning stress test user...');

    let userId, token;
    try {
        const regRes = await fetch(`${baseUrl}/auth/register`, { method: 'POST' });
        const regData = await regRes.json();
        userId = regData['x-user-id'];

        const logRes = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'x-user-id': userId, 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'admin', expiresIn: 3600000 })
        });
        const logData = await logRes.json();
        token = logData.token;

        console.log(`✅ Provisioned User: ${userId}`);
    } catch (e) {
        console.error('❌ Failed to provision test user. Make sure the server is running.', e.message);
        process.exit(1);
    }

    // 2. Configure Autocannon
    const instance = autocannon({
        url: baseUrl,
        connections: 100, // Number of concurrent connections
        pipelining: 1,
        duration: 10, // Run for 10 seconds
        requests: [
            {
                method: 'GET',
                path: '/introspect',
                headers: {
                    'x-user-id': userId,
                    'Authorization': `Bearer ${token}`
                }
            },
            {
                method: 'POST',
                path: '/stress-db/records',
                headers: {
                    'x-user-id': userId,
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ item: 'stress-test-item', timestamp: Date.now() })
            },
            {
                method: 'GET',
                path: '/stress-db/records',
                headers: {
                    'x-user-id': userId,
                    'Authorization': `Bearer ${token}`
                }
            }
        ]
    });

    autocannon.track(instance, { renderProgressBar: true });

    instance.on('done', async (result) => {
        console.log(`\n🎉 Autocannon stress test completed!`);
        console.log(`Total Requests: ${result.requests.total}`);
        console.log(`Requests/Sec: ${result.requests.average}`);
        console.log(`Latency (p99): ${result.latency.p99} ms`);
        console.log(`Errors: ${result.errors}`);

        // Cleanup
        try {
            console.log('\nCleaning up stress test user...');
            await fetch(`${baseUrl}/auth/account`, {
                method: 'DELETE',
                headers: {
                    'x-user-id': userId,
                    'Authorization': `Bearer ${token}`
                }
            });
            console.log('✅ Cleanup successful.');
            process.exit(0);
        } catch (e) {
            console.error('❌ Cleanup failed.');
            process.exit(1);
        }
    });
}

runStressTest();
