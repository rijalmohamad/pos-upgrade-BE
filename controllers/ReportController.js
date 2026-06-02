const db = require('../config/db');
const logger = require('../config/logger');

class ReportController {
    getSalesReport = async (req, res) => {
        try {
            const { from, to } = req.query;
            
            if (!from || !to) {
                return res.status(400).json({ message: 'From and To dates are required' });
            }

            // Fetch sales
            const [sales] = await db.execute(`
                SELECT s.*, c.name as customer_name, u.name as user_name
                FROM sales s
                LEFT JOIN customers c ON s.customer_id = c.id
                LEFT JOIN users u ON s.user_id = u.id
                WHERE s.date BETWEEN ? AND ? AND s.status = 'success'
                ORDER BY s.date DESC, s.id DESC
            `, [from, to]);

            if (sales.length === 0) {
                return res.json([]);
            }

            const saleIds = sales.map(s => s.id);

            // Fetch details for all these sales
            const placeholders = saleIds.map(() => '?').join(',');
            
            const [details] = await db.execute(`
                SELECT sd.*, i.name as item_name, u.name as unit_name
                FROM sale_details sd
                LEFT JOIN items i ON sd.item_id = i.id
                LEFT JOIN item_units iu ON sd.item_unit_id = iu.id
                LEFT JOIN units u ON iu.unit_id = u.id
                WHERE sd.sale_id IN (${placeholders})
            `, saleIds);

            // Map details to sales
            const salesWithDetails = sales.map(sale => {
                const saleDetails = details.filter(d => d.sale_id === sale.id);
                return {
                    ...sale,
                    customer: sale.customer_id ? { name: sale.customer_name } : null,
                    user: sale.user_id ? { name: sale.user_name } : null,
                    details: saleDetails.map(d => ({
                        ...d,
                        unit: {
                            item: { name: d.item_name },
                            unit: { name: d.unit_name }
                        }
                    }))
                };
            });

            res.json(salesWithDetails);
        } catch (error) {
            logger.error('Error fetching sales report', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };
    getPurchaseReport = async (req, res) => {
        try {
            const { from, to } = req.query;
            
            if (!from || !to) {
                return res.status(400).json({ message: 'From and To dates are required' });
            }

            // Fetch purchases
            const [purchases] = await db.execute(`
                SELECT p.*, s.name as supplier_name, u.name as user_name
                FROM purchases p
                LEFT JOIN suppliers s ON p.supplier_id = s.id
                LEFT JOIN users u ON p.user_id = u.id
                WHERE p.date BETWEEN ? AND ?
                ORDER BY p.date DESC, p.id DESC
            `, [from, to]);

            if (purchases.length === 0) {
                return res.json([]);
            }

            const purchaseIds = purchases.map(p => p.id);

            // Fetch details for all these purchases
            const placeholders = purchaseIds.map(() => '?').join(',');
            
            const [details] = await db.execute(`
                SELECT pd.*, i.name as item_name, u.name as unit_name
                FROM purchase_details pd
                LEFT JOIN items i ON pd.item_id = i.id
                LEFT JOIN item_units iu ON pd.item_unit_id = iu.id
                LEFT JOIN units u ON iu.unit_id = u.id
                WHERE pd.purchase_id IN (${placeholders})
            `, purchaseIds);

            // Map details to purchases
            const purchasesWithDetails = purchases.map(purchase => {
                const purchaseDetails = details.filter(d => d.purchase_id === purchase.id);
                return {
                    ...purchase,
                    supplier: purchase.supplier_id ? { name: purchase.supplier_name } : null,
                    user: purchase.user_id ? { name: purchase.user_name } : null,
                    details: purchaseDetails.map(d => ({
                        ...d,
                        item: { name: d.item_name },
                        unit: { unit: { name: d.unit_name } }
                    }))
                };
            });

            res.json(purchasesWithDetails);
        } catch (error) {
            logger.error('Error fetching purchase report', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    getStockReport = async (req, res) => {
        try {
            const query = `
                SELECT i.code, i.name, c.name as category, COALESCE(SUM(s.qty), 0) as total_stock, u.name as unit
                FROM items i
                LEFT JOIN item_categories c ON i.item_category_id = c.id
                LEFT JOIN stocks s ON i.id = s.item_id
                LEFT JOIN item_units iu ON i.id = iu.item_id AND iu.amount = 1
                LEFT JOIN units u ON iu.unit_id = u.id
                GROUP BY i.id, i.code, i.name, c.name, u.name
                ORDER BY i.name ASC
            `;
            const [rows] = await db.execute(query);

            res.json(rows);
        } catch (error) {
            logger.error('Error fetching stock report', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    getProfitLoss = async (req, res) => {
        try {
            const { from, to } = req.query;
            if (!from || !to) {
                return res.status(400).json({ message: 'From and To dates are required' });
            }

            const [revenue] = await db.execute(
                `SELECT a.id, a.code, a.name, COALESCE(SUM(ji.credit - ji.debit), 0) as balance 
                 FROM accounts a 
                 LEFT JOIN journal_items ji ON a.id = ji.account_id 
                 LEFT JOIN journals j ON ji.journal_id = j.id 
                 WHERE a.type = 'Revenue' AND j.date >= ? AND j.date <= ? 
                 GROUP BY a.id, a.code, a.name`,
                [from, to]
            );

            const [expense] = await db.execute(
                `SELECT a.id, a.code, a.name, COALESCE(SUM(ji.debit - ji.credit), 0) as balance 
                 FROM accounts a 
                 LEFT JOIN journal_items ji ON a.id = ji.account_id 
                 LEFT JOIN journals j ON ji.journal_id = j.id 
                 WHERE a.type = 'Expense' AND j.date >= ? AND j.date <= ? 
                 GROUP BY a.id, a.code, a.name`,
                [from, to]
            );

            const totalRevenue = revenue.reduce((sum, r) => sum + parseFloat(r.balance), 0);
            const totalExpense = expense.reduce((sum, e) => sum + parseFloat(e.balance), 0);
            const netProfit = totalRevenue - totalExpense;

            res.json({
                revenue,
                expense,
                total_revenue: totalRevenue,
                total_expense: totalExpense,
                net_profit: netProfit
            });
        } catch (error) {
            logger.error('Error fetching profit loss report', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    getBalanceSheet = async (req, res) => {
        try {
            const { date } = req.query;
            if (!date) {
                return res.status(400).json({ message: 'Date is required' });
            }

            const [assets] = await db.execute(
                `SELECT a.id, a.code, a.name, COALESCE(SUM(ji.debit - ji.credit), 0) as balance 
                 FROM accounts a 
                 LEFT JOIN journal_items ji ON a.id = ji.account_id 
                 LEFT JOIN journals j ON ji.journal_id = j.id 
                 WHERE a.type = 'Asset' AND j.date <= ? 
                 GROUP BY a.id, a.code, a.name`,
                [date]
            );

            const [liabilities] = await db.execute(
                `SELECT a.id, a.code, a.name, COALESCE(SUM(ji.credit - ji.debit), 0) as balance 
                 FROM accounts a 
                 LEFT JOIN journal_items ji ON a.id = ji.account_id 
                 LEFT JOIN journals j ON ji.journal_id = j.id 
                 WHERE a.type = 'Liability' AND j.date <= ? 
                 GROUP BY a.id, a.code, a.name`,
                [date]
            );

            const [equity] = await db.execute(
                `SELECT a.id, a.code, a.name, COALESCE(SUM(ji.credit - ji.debit), 0) as balance 
                 FROM accounts a 
                 LEFT JOIN journal_items ji ON a.id = ji.account_id 
                 LEFT JOIN journals j ON ji.journal_id = j.id 
                 WHERE a.type = 'Equity' AND j.date <= ? 
                 GROUP BY a.id, a.code, a.name`,
                [date]
            );

            const totalAssets = assets.reduce((sum, a) => sum + parseFloat(a.balance), 0);
            const totalLiabilities = liabilities.reduce((sum, l) => sum + parseFloat(l.balance), 0);
            const totalEquity = equity.reduce((sum, e) => sum + parseFloat(e.balance), 0);

            res.json({
                assets,
                liabilities,
                equity,
                total_assets: totalAssets,
                total_liabilities: totalLiabilities,
                total_equity: totalEquity
            });
        } catch (error) {
            logger.error('Error fetching balance sheet report', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    getDebtReceivable = async (req, res) => {
        try {
            const { status } = req.query;

            const [receivables] = await db.execute(`
                SELECT s.id, s.invoice_no, s.date, s.due_date, c.name as customer_name, s.total, 
                       (COALESCE(s.pay_amount, 0) + COALESCE((SELECT SUM(amount) FROM payments WHERE payable_type = 'App\\\\Models\\\\Sale' AND payable_id = s.id), 0)) as paid, 
                       (s.total - COALESCE(s.pay_amount, 0) - COALESCE((SELECT SUM(amount) FROM payments WHERE payable_type = 'App\\\\Models\\\\Sale' AND payable_id = s.id), 0)) as remaining,
                       CASE 
                           WHEN s.due_date < CURDATE() THEN 'Overdue'
                           WHEN s.due_date = CURDATE() THEN 'Due Today'
                           WHEN s.due_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN 'Approaching'
                           ELSE 'Safe'
                       END as status
                FROM sales s 
                LEFT JOIN customers c ON s.customer_id = c.id 
                WHERE LOWER(s.status) = 'success'
                HAVING remaining > 0
            `);
            const [debts] = await db.execute(`
                SELECT p.id, p.purchase_no, p.date, p.due_date, sup.name as supplier_name, p.total, 
                       COALESCE((SELECT SUM(amount) FROM payments WHERE payable_type = 'App\\\\Models\\\\Purchase' AND payable_id = p.id), 0) as paid, 
                       (p.total - COALESCE((SELECT SUM(amount) FROM payments WHERE payable_type = 'App\\\\Models\\\\Purchase' AND payable_id = p.id), 0)) as remaining,
                       CASE 
                           WHEN p.due_date < CURDATE() THEN 'Overdue'
                           WHEN p.due_date = CURDATE() THEN 'Due Today'
                           WHEN p.due_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN 'Approaching'
                           ELSE 'Safe'
                       END as status
                FROM purchases p 
                LEFT JOIN suppliers sup ON p.supplier_id = sup.id 
                WHERE LOWER(p.payment_method) = 'credit'
                HAVING remaining > 0
            `);

            let filteredReceivables = receivables;
            let filteredDebts = debts;

            if (status) {
                filteredReceivables = receivables.filter(r => r.status === status);
                filteredDebts = debts.filter(d => d.status === status);
            }

            res.json({
                receivables: filteredReceivables,
                debts: filteredDebts
            });
        } catch (error) {
            logger.error('Error fetching debt receivable report', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    getLedger = async (req, res) => {
        try {
            const { account_id, from, to } = req.query;

            if (!account_id || !from || !to) {
                return res.status(400).json({ message: 'Account ID, From and To dates are required' });
            }

            // Get account details
            const [accounts] = await db.execute('SELECT * FROM accounts WHERE id = ?', [account_id]);
            if (accounts.length === 0) {
                return res.status(404).json({ message: 'Account not found' });
            }
            const account = accounts[0];

            // Get opening balance
            let openingBalance = 0;
            if (account.type === 'Asset' || account.type === 'Expense') {
                const [rows] = await db.execute(
                    `SELECT COALESCE(SUM(ji.debit - ji.credit), 0) as balance 
                     FROM journal_items ji 
                     LEFT JOIN journals j ON ji.journal_id = j.id 
                     WHERE ji.account_id = ? AND j.date < ?`,
                    [account_id, from]
                );
                openingBalance = rows[0].balance;
            } else {
                const [rows] = await db.execute(
                    `SELECT COALESCE(SUM(ji.credit - ji.debit), 0) as balance 
                     FROM journal_items ji 
                     LEFT JOIN journals j ON ji.journal_id = j.id 
                     WHERE ji.account_id = ? AND j.date < ?`,
                    [account_id, from]
                );
                openingBalance = rows[0].balance;
            }

            // Get ledger items
            const [items] = await db.execute(
                `SELECT ji.id, ji.debit, ji.credit, j.date, j.description 
                 FROM journal_items ji 
                 LEFT JOIN journals j ON ji.journal_id = j.id 
                 WHERE ji.account_id = ? AND j.date >= ? AND j.date <= ? 
                 ORDER BY j.date ASC, ji.id ASC`,
                [account_id, from, to]
            );

            res.json({
                account,
                opening_balance: openingBalance,
                items
            });
        } catch (error) {
            logger.error('Error fetching ledger report', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    getJournals = async (req, res) => {
        try {
            const { from, to, page = 1 } = req.query;
            const limit = 10;
            const offset = (parseInt(page) - 1) * limit;

            if (!from || !to) {
                return res.status(400).json({ message: 'From and To dates are required' });
            }

            const [journals] = await db.execute(
                `SELECT j.*, u.name as user_name 
                 FROM journals j 
                 LEFT JOIN users u ON j.user_id = u.id 
                 WHERE j.date >= ? AND j.date <= ? 
                 ORDER BY j.date DESC, j.id DESC 
                 LIMIT ${limit} OFFSET ${offset}`,
                [from, to]
            );

            const [totalRows] = await db.execute(
                `SELECT COUNT(*) as count FROM journals WHERE date >= ? AND date <= ?`,
                [from, to]
            );

            for (const j of journals) {
                const [items] = await db.execute(
                    `SELECT ji.*, a.code, a.name as account_name 
                     FROM journal_items ji 
                     LEFT JOIN accounts a ON ji.account_id = a.id 
                     WHERE ji.journal_id = ?`,
                    [j.id]
                );
                j.items = items.map(item => ({
                    ...item,
                    account: { code: item.code, name: item.account_name }
                }));
                j.user = { name: j.user_name };
            }

            res.json({
                data: journals,
                current_page: parseInt(page),
                last_page: Math.ceil(totalRows[0].count / limit),
                total: totalRows[0].count
            });
        } catch (error) {
            logger.error('Error fetching journals report', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    getItemMovementReport = async (req, res) => {
        try {
            const { from, to, warehouse_id, type } = req.query;
            
            if (!from || !to) {
                return res.status(400).json({ message: 'From and To dates are required' });
            }

            let query = `
                SELECT i.code, i.name as item_name, 
                       SUM(CASE WHEN sh.qty_change < 0 THEN ABS(sh.qty_change) ELSE 0 END) as qty_out,
                       SUM(CASE WHEN sh.qty_change > 0 THEN sh.qty_change ELSE 0 END) as qty_in,
                       u.name as unit_name
                FROM stock_histories sh
                LEFT JOIN items i ON sh.item_id = i.id
                LEFT JOIN item_units iu ON i.id = iu.item_id AND iu.amount = 1
                LEFT JOIN units u ON iu.unit_id = u.id
                WHERE sh.created_at BETWEEN ? AND ?
            `;
            
            const params = [from + ' 00:00:00', to + ' 23:59:59'];
            
            if (warehouse_id) {
                query += ` AND sh.warehouse_id = ?`;
                params.push(warehouse_id);
            }
            
            if (type) {
                query += ` AND sh.reference_type = ?`;
                params.push(type);
            }
            
            query += ` GROUP BY i.id, i.code, i.name, u.name ORDER BY i.name ASC`;

            const [rows] = await db.query(query, params);
            res.json(rows);
        } catch (error) {
            logger.error('Error fetching item movement report', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };
}

module.exports = new ReportController();
