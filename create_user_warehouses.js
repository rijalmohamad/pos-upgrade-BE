const db = require('./config/db');

async function run() {
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS user_warehouses (
                user_id BIGINT UNSIGNED NOT NULL,
                warehouse_id BIGINT UNSIGNED NOT NULL,
                PRIMARY KEY (user_id, warehouse_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        console.log('Table user_warehouses created successfully');
        process.exit(0);
    } catch (error) {
        console.error('Error creating user_warehouses table:', error);
        process.exit(1);
    }
}

run();
