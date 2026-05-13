const db = require('./config/db');

async function run() {
    try {
        const [users] = await db.execute('DESCRIBE users');
        console.log('users:', users);
        const [warehouses] = await db.execute('DESCRIBE warehouses');
        console.log('warehouses:', warehouses);
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

run();
