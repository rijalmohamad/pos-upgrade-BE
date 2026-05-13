const db = require('./config/db');

async function run() {
    try {
        const [payments] = await db.execute('DESCRIBE payments');
        console.log('payments:', payments);
        process.exit(0);
    } catch (error) {
        console.error('payments table does not exist');
        process.exit(1);
    }
}

run();
