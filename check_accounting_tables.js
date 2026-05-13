const db = require('./config/db');

async function run() {
    try {
        const [journals] = await db.execute('DESCRIBE journals');
        console.log('journals:', journals);
        const [journal_items] = await db.execute('DESCRIBE journal_items');
        console.log('journal_items:', journal_items);
        process.exit(0);
    } catch (error) {
        console.error('Accounting tables do not exist');
        process.exit(1);
    }
}

run();
