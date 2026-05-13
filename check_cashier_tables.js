const db = require('./config/db');

async function run() {
    try {
        const [sessions] = await db.execute('DESCRIBE cashier_sessions');
        console.log('cashier_sessions:', sessions);
        const [transactions] = await db.execute('DESCRIBE cash_transactions');
        console.log('cash_transactions:', transactions);
        process.exit(0);
    } catch (error) {
        console.error('Cashier tables do not exist');
        process.exit(1);
    }
}

run();
