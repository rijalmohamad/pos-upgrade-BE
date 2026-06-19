const db = require('./config/db');

async function updateTable() {
    try {
        console.log("Checking purchases table for pay_amount and change_amount...");
        
        // Add pay_amount
        let [cols1] = await db.execute(`SHOW COLUMNS FROM purchases LIKE 'pay_amount'`);
        if (cols1.length === 0) {
            await db.execute(`ALTER TABLE purchases ADD COLUMN pay_amount DECIMAL(15,2) DEFAULT 0`);
            console.log('Added pay_amount column');
        }

        // Add change_amount
        let [cols2] = await db.execute(`SHOW COLUMNS FROM purchases LIKE 'change_amount'`);
        if (cols2.length === 0) {
            await db.execute(`ALTER TABLE purchases ADD COLUMN change_amount DECIMAL(15,2) DEFAULT 0`);
            console.log('Added change_amount column');
        }

        console.log("Update completed successfully.");
        process.exit(0);
    } catch (err) {
        console.error("Error updating table:", err);
        process.exit(1);
    }
}

updateTable();
