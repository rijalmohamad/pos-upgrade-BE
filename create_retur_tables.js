const db = require('./config/db');

async function run() {
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS sales_returns (
                id INT AUTO_INCREMENT PRIMARY KEY,
                sale_id INT NOT NULL,
                return_no VARCHAR(50) NOT NULL UNIQUE,
                date DATE NOT NULL,
                status ENUM('pending', 'approved', 'cancelled') DEFAULT 'pending',
                total_amount DECIMAL(15,2) NOT NULL,
                reason TEXT,
                user_id INT,
                approved_by INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS sales_return_details (
                id INT AUTO_INCREMENT PRIMARY KEY,
                sales_return_id INT NOT NULL,
                item_id INT NOT NULL,
                item_unit_id INT NOT NULL,
                qty INT NOT NULL,
                price DECIMAL(15,2) NOT NULL,
                subtotal DECIMAL(15,2) NOT NULL,
                FOREIGN KEY (sales_return_id) REFERENCES sales_returns(id) ON DELETE CASCADE
            )
        `);

        console.log('Tables created successfully');
        process.exit(0);
    } catch (error) {
        console.error('Error creating tables:', error);
        process.exit(1);
    }
}

run();
