const db = require('./config/db');

async function run() {
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS purchase_returns (
                id INT AUTO_INCREMENT PRIMARY KEY,
                return_no VARCHAR(50) NOT NULL UNIQUE,
                purchase_id INT NOT NULL,
                date DATE NOT NULL,
                total DECIMAL(15,2) NOT NULL,
                note TEXT,
                user_id INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE
            )
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS purchase_return_details (
                id INT AUTO_INCREMENT PRIMARY KEY,
                purchase_return_id INT NOT NULL,
                purchase_detail_id INT NOT NULL,
                item_id INT NOT NULL,
                item_unit_id INT NOT NULL,
                qty DECIMAL(15,2) NOT NULL,
                price DECIMAL(15,2) NOT NULL,
                subtotal DECIMAL(15,2) NOT NULL,
                FOREIGN KEY (purchase_return_id) REFERENCES purchase_returns(id) ON DELETE CASCADE
            )
        `);

        console.log('Purchase return tables created successfully');
        process.exit(0);
    } catch (error) {
        console.error('Error creating purchase return tables:', error);
        process.exit(1);
    }
}

run();
