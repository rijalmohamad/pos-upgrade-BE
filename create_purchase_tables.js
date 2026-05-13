const db = require('./config/db');

async function run() {
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS purchases (
                id INT AUTO_INCREMENT PRIMARY KEY,
                purchase_no VARCHAR(50) NOT NULL UNIQUE,
                supplier_id INT NOT NULL,
                warehouse_id INT NOT NULL,
                date DATE NOT NULL,
                total DECIMAL(15,2) NOT NULL,
                discount DECIMAL(15,2) DEFAULT 0,
                payment_status ENUM('paid', 'unpaid', 'partial') DEFAULT 'unpaid',
                payment_method VARCHAR(50),
                due_date DATE,
                user_id INT,
                note TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS purchase_details (
                id INT AUTO_INCREMENT PRIMARY KEY,
                purchase_id INT NOT NULL,
                item_id INT NOT NULL,
                item_unit_id INT NOT NULL,
                qty DECIMAL(15,2) NOT NULL,
                price DECIMAL(15,2) NOT NULL,
                subtotal DECIMAL(15,2) NOT NULL,
                FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE
            )
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS item_purchase_prices (
                id INT AUTO_INCREMENT PRIMARY KEY,
                item_id INT NOT NULL,
                item_unit_id INT NOT NULL,
                supplier_id INT NOT NULL,
                price DECIMAL(15,2) NOT NULL,
                date DATE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Check if last_purchase_price exists in item_units
        const [columns] = await db.execute(`SHOW COLUMNS FROM item_units LIKE 'last_purchase_price'`);
        if (columns.length === 0) {
            await db.execute(`ALTER TABLE item_units ADD COLUMN last_purchase_price DECIMAL(15,2) DEFAULT 0`);
            console.log('Added last_purchase_price column to item_units');
        }

        console.log('Purchase tables created successfully');
        process.exit(0);
    } catch (error) {
        console.error('Error creating purchase tables:', error);
        process.exit(1);
    }
}

run();
