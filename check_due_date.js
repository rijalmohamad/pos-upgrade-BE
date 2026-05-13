const db = require('./config/db');

async function run() {
    try {
        const [sales] = await db.execute('DESCRIBE sales');
        console.log('sales:', sales);
        const [purchases] = await db.execute('DESCRIBE purchases');
        console.log('purchases:', purchases);
        process.exit(0);
    } catch (error) {
        console.error('Tables do not exist');
        process.exit(1);
    }
}

run();
