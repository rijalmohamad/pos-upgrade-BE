const db = require('./config/db');

async function run() {
    try {
        const [rows] = await db.execute('DESCRIBE stock_histories');
        console.log(rows);
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

run();
