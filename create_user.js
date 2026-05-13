const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function run() {
    try {
        const conn = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: process.env.DB_NAME
        });
        
        const username = 'admin'; // Use just 'admin'
        const password = 'password123';
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Check if user exists
        const [rows] = await conn.query('SELECT * FROM users WHERE email = ?', [username]);
        if (rows.length > 0) {
            console.log('User already exists');
            await conn.end();
            return;
        }
        
        // Get a valid role_id
        const [roles] = await conn.query('SELECT id FROM roles LIMIT 1');
        const roleId = roles[0]?.id || 1;
        
        await conn.query(
            'INSERT INTO users (email, password, name, role_id) VALUES (?, ?, ?, ?)',
            [username, hashedPassword, 'Administrator', roleId]
        );
        
        console.log(`User created successfully! Username (stored in email field): ${username}, Password: ${password}`);
        
        await conn.end();
    } catch (e) {
        console.error('Error:', e);
    }
}
run();
