const mysql = require('mysql2/promise');
require('dotenv').config();

async function test() {
    try {
        const conn = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: process.env.DB_NAME
        });
        
        const [schema] = await conn.query('DESCRIBE item_prices');
        console.log('item_prices schema:', schema);
        
        await conn.end();
    } catch (e) {
        console.error('Error:', e);
    }
}
test();
