const db = require('./config/db');

async function run() {
    try {
        const [accounts] = await db.execute('DESCRIBE accounts');
        console.log('accounts:', accounts);
        process.exit(0);
    } catch (error) {
        console.error('Accounts table does not exist');
        process.exit(1);
    }
}

run();
