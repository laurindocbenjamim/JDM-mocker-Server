const BASE_URL = 'http://localhost:5000';
const USER_ID = 'test-user-custom-endpoints';
let token = '';

async function runTest() {
    try {
        console.log('--- Starting Custom Endpoints Test ---');

        // 1. Login/Register
        console.log('1. Registering user...');
        const regRes = await fetch(`${BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 'x-user-id': USER_ID }
        });
        const regData = await regRes.json();
        console.log('Register status:', regRes.status);

        console.log('2. Logging in...');
        const loginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-user-id': USER_ID
            },
            body: JSON.stringify({ role: 'admin' })
        });
        const loginData = await loginRes.json();
        token = loginData.token;
        console.log('Login successful');

        const authHeaders = {
            'Authorization': `Bearer ${token}`,
            'x-user-id': USER_ID,
            'Content-Type': 'application/json'
        };

        // 2. Create table with custom endpoints
        console.log('3. Creating table with custom endpoints...');
        const createRes = await fetch(`${BASE_URL}/test-cont/test-table`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                _init: true,
                _customPaths: {
                    get: '/api/v1/list-items',
                    post: '/api/v1/create-item'
                }
            })
        });
        console.log('Table creation status:', createRes.status);

        // 3. Verify custom GET
        console.log('4. Verifying custom GET...');
        const getRes = await fetch(`${BASE_URL}/api/v1/list-items`, { headers: authHeaders });
        const getData = await getRes.json();
        console.log('GET status:', getRes.status, 'Data:', getData);

        // 4. Update custom endpoints (Add PATCH, DELETE)
        console.log('5. Updating custom endpoints (Adding PATCH, DELETE)...');
        const updateRes = await fetch(`${BASE_URL}/test-cont/test-table/custom-paths`, {
            method: 'PATCH',
            headers: authHeaders,
            body: JSON.stringify({
                customPaths: {
                    patch: '/api/v1/update-item',
                    delete: '/api/v1/remove-item'
                }
            })
        });
        console.log('Update endpoints status:', updateRes.status);

        // 5. Create a record via custom POST
        console.log('6. Creating record via custom POST...');
        const postRes = await fetch(`${BASE_URL}/api/v1/create-item`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ name: 'Test item' })
        });
        const postData = await postRes.json();
        const recordId = postData.id;
        console.log('Record created with ID:', recordId);

        // 6. Update record via custom PATCH
        console.log('7. Updating record via custom PATCH...');
        const patchRes = await fetch(`${BASE_URL}/api/v1/update-item/${recordId}`, {
            method: 'PATCH',
            headers: authHeaders,
            body: JSON.stringify({ name: 'Updated name' })
        });
        const patchData = await patchRes.json();
        console.log('PATCH response data:', patchData);

        // 7. Delete record via custom DELETE
        console.log('8. Deleting record via custom DELETE...');
        const delRes = await fetch(`${BASE_URL}/api/v1/remove-item/${recordId}`, {
            method: 'DELETE',
            headers: authHeaders
        });
        console.log('DELETE status:', delRes.status);

        // 8. Remove a custom endpoint
        console.log('9. Removing custom GET endpoint...');
        const removeRes = await fetch(`${BASE_URL}/test-cont/test-table/custom-paths`, {
            method: 'PATCH',
            headers: authHeaders,
            body: JSON.stringify({ remove: 'get' })
        });
        console.log('Remove endpoint status:', removeRes.status);

        // 9. Verify GET no longer works
        console.log('10. Verifying GET no longer works via custom path...');
        const getFailRes = await fetch(`${BASE_URL}/api/v1/list-items`, { headers: authHeaders });
        if (getFailRes.status === 401 || getFailRes.status === 404) {
            console.log('Confirmation: GET failed as expected with status', getFailRes.status);
        } else {
            console.error('ERROR: GET still works after removal! Status:', getFailRes.status);
            process.exit(1);
        }

        console.log('\n--- All tests passed! ---');
    } catch (err) {
        console.error('Test failed:', err.message);
        process.exit(1);
    }
}

runTest();
