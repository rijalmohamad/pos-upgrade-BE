const db = require('../config/db');
const logger = require('../config/logger');

class DashboardController {
    index = async (req, res) => {
        try {
            const today = new Date().toISOString().slice(0, 10);
            const startOfMonth = new Date().toISOString().slice(0, 8) + '01';

            // 1. Summary Cards
            const [salesTodayRows] = await db.execute(
                `SELECT SUM(total) as total FROM sales WHERE date = ? AND status = 'success'`,
                [today]
            );
            const salesToday = salesTodayRows[0].total || 0;

            const [salesMonthRows] = await db.execute(
                `SELECT SUM(total) as total FROM sales WHERE date >= ? AND date <= ? AND status = 'success'`,
                [startOfMonth, today]
            );
            const salesMonth = salesMonthRows[0].total || 0;

            const [receivableRows] = await db.execute(
                `SELECT SUM(total - COALESCE((SELECT SUM(amount) FROM payments WHERE payable_type = 'App\\\\Models\\\\Sale' AND payable_id = sales.id), 0)) as total 
                 FROM sales 
                 WHERE status = 'success' AND payment_method = 'Credit'`
            );
            const receivable = receivableRows[0].total || 0;

            const [debtRows] = await db.execute(
                `SELECT SUM(total - COALESCE((SELECT SUM(amount) FROM payments WHERE payable_type = 'App\\\\Models\\\\Purchase' AND payable_id = purchases.id), 0)) as total 
                 FROM purchases 
                 WHERE payment_method = 'Credit'`
            );
            const debt = debtRows[0].total || 0;

            // 2. Sales Chart (Last 7 days)
            const salesChart = [];
            for (let i = 6; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                const dateStr = d.toISOString().slice(0, 10);
                
                const [chartRows] = await db.execute(
                    `SELECT SUM(total) as total FROM sales WHERE date = ? AND status = 'success'`,
                    [dateStr]
                );
                
                const day = d.getDate().toString().padStart(2, '0');
                const month = d.toLocaleString('default', { month: 'short' });
                
                salesChart.push({
                    date: `${day} ${month}`,
                    total: parseFloat(chartRows[0].total) || 0
                });
            }

            // 3. Top Items (This Month)
            const [topItems] = await db.execute(
                `SELECT i.name, SUM(sd.qty) as total_qty 
                 FROM sale_details sd 
                 JOIN sales s ON s.id = sd.sale_id 
                 JOIN items i ON i.id = sd.item_id 
                 WHERE s.status = 'success' AND s.date >= ? AND s.date <= ? 
                 GROUP BY i.id, i.name 
                 ORDER BY total_qty DESC 
                 LIMIT 5`,
                [startOfMonth, today]
            );

            res.json({
                summary: {
                    sales_today: parseFloat(salesToday),
                    sales_month: parseFloat(salesMonth),
                    receivable: parseFloat(receivable),
                    debt: parseFloat(debt),
                },
                sales_chart: salesChart,
                top_items: topItems.map(item => ({
                    ...item,
                    total_qty: parseFloat(item.total_qty)
                }))
            });
        } catch (error) {
            logger.error('Error in dashboard', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };
}

module.exports = new DashboardController();
