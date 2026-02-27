const assert = require('assert');

class JdmMockerTester {
    constructor(baseUrl = 'http://localhost:3000') {
        this.baseUrl = baseUrl;
        this.userId = null;
        this.token = null;
    }

    async request(path, options = {}) {
        const url = `${this.baseUrl}${path}`;
        const headers = { ...options.headers };

        if (!headers['Content-Type'] && (options.method === 'POST' || options.method === 'PUT' || options.method === 'PATCH')) {
            headers['Content-Type'] = 'application/json';
        }

        if (this.userId) headers['x-user-id'] = this.userId;

        // Use CSRF-Token to verify the new feature we just added
        if (this.token) headers['CSRF-Token'] = this.token;

        const res = await fetch(url, { ...options, headers });
        let data;
        const text = await res.text();
        try {
            data = JSON.parse(text);
        } catch {
            data = text;
        }

        return { status: res.status, data };
    }

    async runTests() {
        console.log(`🚀 Starting JDM-mocker Unit Tests on ${this.baseUrl} ...\n`);
        let recordId;

        try {
            // 1. Provision User (Register)
            process.stdout.write('1. Testing User Registration...');
            let res = await this.request('/auth/register', { method: 'POST' });
            assert.strictEqual(res.status, 201, `Failed to register: ${JSON.stringify(res.data)}`);
            this.userId = res.data['x-user-id'];
            assert.ok(this.userId, 'Missing x-user-id');
            console.log(` ✅ OK (Status: ${res.status})`);

            // 2. Authentication (Login)
            process.stdout.write('2. Testing Authentication (Login)...');
            res = await this.request('/auth/login', {
                method: 'POST',
                body: JSON.stringify({ role: 'admin', expiresIn: 30000 })
            });
            assert.strictEqual(res.status, 200, 'Login failed');
            this.token = res.data.token;
            assert.ok(this.token, 'Missing token');
            console.log(` ✅ OK (Status: ${res.status})`);

            // 3. Create Record (POST)
            process.stdout.write('3. Testing Create Record (POST)...');
            res = await this.request('/test-db/users', {
                method: 'POST',
                body: JSON.stringify({ name: 'Alice', role: 'engineer' })
            });
            assert.strictEqual(res.status, 201, 'Create record failed');
            recordId = res.data.id;
            assert.ok(recordId, 'Record ID missing');
            console.log(` ✅ OK (Status: ${res.status})`);

            // 4. List Records (GET)
            process.stdout.write('4. Testing List Records (GET)...');
            res = await this.request('/test-db/users', { method: 'GET' });
            assert.strictEqual(res.status, 200, 'List records failed');
            assert.strictEqual(res.data.length, 1, 'Should have 1 record');
            assert.strictEqual(res.data[0].id, recordId, 'Record ID mismatch');
            console.log(` ✅ OK (Status: ${res.status})`);

            // 5. Update Record (PUT)
            process.stdout.write('5. Testing Update Record (PUT)...');
            res = await this.request(`/test-db/users/${recordId}`, {
                method: 'PUT',
                body: JSON.stringify({ name: 'Alice Smith', role: 'manager' })
            });
            assert.strictEqual(res.status, 200, 'Update record failed');
            assert.strictEqual(res.data.name, 'Alice Smith', 'Name not updated');
            console.log(` ✅ OK (Status: ${res.status})`);

            // 6. Bulk Schema Update (PATCH)
            process.stdout.write('6. Testing Bulk Schema Update...');
            res = await this.request('/test-db/users/schema', {
                method: 'PATCH',
                body: JSON.stringify({
                    set: { status: 'active' },
                    rename: { role: 'job_title' }
                })
            });
            assert.strictEqual(res.status, 200, 'Schema update failed');

            // Verify schema
            res = await this.request(`/test-db/users/${recordId}`, { method: 'GET' });
            assert.strictEqual(res.data.status, 'active', 'Schema set failed');
            assert.strictEqual(res.data.job_title, 'manager', 'Schema rename failed');
            assert.strictEqual(res.data.role, undefined, 'Old field still exists');
            console.log(` ✅ OK (Status: ${res.status})`);

            // 7. Introspection (GET)
            process.stdout.write('7. Testing Introspection (GET)...');
            res = await this.request('/introspect', { method: 'GET' });
            assert.strictEqual(res.status, 200, 'Introspection failed');
            assert.ok(res.data.storage['test-db'], 'test-db missing in introspection');
            console.log(` ✅ OK (Status: ${res.status})`);

            // 8. Delete Record (DELETE)
            process.stdout.write('8. Testing Delete Record (DELETE)...');
            res = await this.request(`/test-db/users/${recordId}`, { method: 'DELETE' });
            assert.strictEqual(res.status, 204, 'Delete record failed');

            // Verify deletion
            res = await this.request(`/test-db/users/${recordId}`, { method: 'GET' });
            assert.strictEqual(res.status, 404, 'Record should be gone');
            console.log(` ✅ OK (Status: ${res.status})`);

            // 9. Rename Table
            process.stdout.write('9. Testing Rename Table...');
            res = await this.request('/test-db/users/rename', {
                method: 'PATCH',
                body: JSON.stringify({ newName: 'employees' })
            });
            assert.strictEqual(res.status, 200, 'Rename table failed');
            console.log(` ✅ OK (Status: ${res.status})`);

            // 10. Delete Table
            process.stdout.write('10. Testing Delete Table...');
            res = await this.request('/test-db/employees', { method: 'DELETE' });
            assert.strictEqual(res.status, 204, 'Delete table failed');
            console.log(` ✅ OK (Status: ${res.status})`);

            // 11. Delete Container
            // Re-create something so the container exists
            await this.request('/temp-db/foo', { method: 'POST', body: JSON.stringify({ a: 1 }) });
            process.stdout.write('11. Testing Delete Container...');
            res = await this.request('/containers/temp-db', { method: 'DELETE' });
            assert.strictEqual(res.status, 204, 'Delete container failed');
            console.log(` ✅ OK (Status: ${res.status})`);

            // 12. UUID Rotation
            process.stdout.write('12. Testing UUID Rotation (PATCH)...');
            const oldUserId = this.userId;
            res = await this.request('/auth/update-uuid', { method: 'PATCH' });
            assert.strictEqual(res.status, 200, 'UUID rotate failed');
            this.userId = res.data['x-user-id'];
            assert.notStrictEqual(this.userId, oldUserId, 'UUID should change');
            console.log(` ✅ OK (Status: ${res.status})`);

            // 13. Delete Account
            process.stdout.write('13. Testing Delete Account...');
            res = await this.request('/auth/account', { method: 'DELETE' });
            assert.strictEqual(res.status, 204, 'Delete account failed');
            console.log(` ✅ OK (Status: ${res.status})`);

            console.log(`\n🎉 All tests passed successfully!`);

        } catch (error) {
            console.error(`\n❌ Test failed: ${error.message}`);
            process.exit(1);
        }
    }
}

// Execution block
if (require.main === module) {
    // If a port is passed as an argument, use it; otherwise default to 3000
    const port = process.env.PORT || 3000;
    const tester = new JdmMockerTester(`http://localhost:${port}`);
    tester.runTests();
}

module.exports = JdmMockerTester;
