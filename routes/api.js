const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });
const db = require('../config/db');

const unitController = require('../controllers/UnitController');
const categoryController = require('../controllers/CategoryController');
const itemController = require('../controllers/ItemController');
const supplierController = require('../controllers/SupplierController');
const discountPackageController = require('../controllers/DiscountPackageController');
const customerController = require('../controllers/CustomerController');
const customerCategoryController = require('../controllers/CustomerCategoryController');
const roleController = require('../controllers/RoleController');
const permissionController = require('../controllers/PermissionController');
const authMiddleware = require('../middleware/authMiddleware');
const authController = require('../controllers/authController');

router.post('/login', authController.login);
const userController = require('../controllers/UserController');
const companyController = require('../controllers/CompanyController');
const saleController = require('../controllers/SaleController');
const warehouseController = require('../controllers/WarehouseController');
const salesReturnController = require('../controllers/SalesReturnController');
const reportController = require('../controllers/ReportController');
const purchaseController = require('../controllers/PurchaseController');
const purchaseReturnController = require('../controllers/PurchaseReturnController');
const stockController = require('../controllers/StockController');
const stockTransferController = require('../controllers/StockTransferController');
const stockAdjustmentController = require('../controllers/StockAdjustmentController');
const dashboardController = require('../controllers/DashboardController');
const cashierController = require('../controllers/CashierController');
const journalController = require('../controllers/JournalController');
const paymentController = require('../controllers/PaymentController');

// Warehouses
router.get('/warehouses', authMiddleware, warehouseController.getAll);
router.get('/warehouses/all', authMiddleware, warehouseController.getAllUnfiltered);
router.get('/warehouses/:id', warehouseController.getById);
router.post('/warehouses', warehouseController.create);
router.put('/warehouses/:id', warehouseController.update);
router.delete('/warehouses/:id', warehouseController.delete);

// Customers
router.get('/customers', customerController.getAll);

// Units
router.get('/units', unitController.getAll);
router.get('/units/:id', unitController.getById);
router.post('/units', unitController.create);
router.put('/units/:id', unitController.update);
router.delete('/units/:id', unitController.delete);
router.post('/units/import', upload.single('file'), unitController.importCsv);

// Categories
router.get('/categories', categoryController.getAll);
router.get('/categories/:id', categoryController.getById);
router.post('/categories', categoryController.create);
router.put('/categories/:id', categoryController.update);
router.delete('/categories/:id', categoryController.delete);
router.post('/categories/import', upload.single('file'), categoryController.importCsv);

// Items
router.get('/items', itemController.getAll);
router.get('/items/template', itemController.downloadTemplate);
router.get('/items/:id', itemController.getById);
router.post('/items', upload.single('photo'), itemController.create);
router.put('/items/:id', upload.single('photo'), itemController.update);
router.delete('/items/:id', itemController.delete);
router.post('/items/import', upload.single('file'), itemController.importExcel);

// Suppliers
router.get('/suppliers', supplierController.getAll);
router.get('/suppliers/:id', supplierController.getById);
router.post('/suppliers', supplierController.create);
router.put('/suppliers/:id', supplierController.update);
router.delete('/suppliers/:id', supplierController.delete);

// Discount Packages
router.get('/discount-packages', discountPackageController.getAll);
router.get('/discount-packages/:id', discountPackageController.getById);
router.post('/discount-packages', discountPackageController.create);
router.put('/discount-packages/:id', discountPackageController.update);
router.delete('/discount-packages/:id', discountPackageController.delete);
router.post('/discount-packages/check', discountPackageController.check);

// Customers
router.get('/customers', customerController.getAll);
router.get('/customers/:id', customerController.getById);
router.get('/customers/:id/debt', customerController.getDebt);
router.post('/customers', customerController.create);
router.put('/customers/:id', customerController.update);
router.delete('/customers/:id', customerController.delete);

// Customer Categories
router.get('/customer-categories', customerCategoryController.getAll);
router.get('/customer-categories/:id', customerCategoryController.getById);
router.post('/customer-categories', customerCategoryController.create);
router.put('/customer-categories/:id', customerCategoryController.update);
router.delete('/customer-categories/:id', customerCategoryController.delete);

// Roles & Permissions
router.get('/roles', roleController.getAll);
router.get('/roles/:id', roleController.getById);
router.post('/roles', roleController.create);
router.put('/roles/:id', roleController.update);
router.delete('/roles/:id', roleController.delete);

router.get('/permissions', permissionController.getAll);

// Users
router.get('/users', userController.getAll);
router.get('/users/:id', userController.getById);
router.post('/users', userController.create);
router.put('/users/:id', userController.update);
router.delete('/users/:id', userController.delete);
router.get('/users/:id/warehouses', authMiddleware, userController.getWarehouses);
router.put('/users/:id/warehouses', authMiddleware, userController.updateWarehouses);

// Company Profile
router.get('/company-profile', companyController.get);
router.post('/company-profile', companyController.update);

// Sales
router.get('/sales', saleController.getAll);
router.get('/sales/last-price', authMiddleware, saleController.getLastSellingPrice);
router.get('/sales/:id', saleController.getById);
router.post('/sales', authMiddleware, saleController.create);
router.post('/sales/check-stock', saleController.checkStock);
router.post('/sales/:id/increment-print', saleController.incrementPrintCount);

// Sales Returns
router.get('/sales-returns', salesReturnController.getAll);
router.get('/sales-returns/:id', salesReturnController.getById);
router.post('/sales-returns', authMiddleware, salesReturnController.create);
router.post('/sales-returns/:id/approve', authMiddleware, salesReturnController.approve);
router.post('/sales-returns/:id/reject', authMiddleware, salesReturnController.reject);
router.delete('/sales-returns/:id', authMiddleware, salesReturnController.delete);

// Reports
router.get('/reports/sales', reportController.getSalesReport);
router.get('/reports/purchases', reportController.getPurchaseReport);
router.get('/reports/stock', reportController.getStockReport);

// Purchases
router.get('/purchases', purchaseController.getAll);
router.get('/purchases/:id', purchaseController.getById);
router.post('/purchases', authMiddleware, purchaseController.create);

// Purchase Returns
router.get('/purchase-returns', purchaseReturnController.getAll);
router.get('/purchase-returns/:id', purchaseReturnController.getById);
router.post('/purchase-returns', authMiddleware, purchaseReturnController.create);

// Stocks
router.get('/stocks', stockController.getAll);
router.get('/stocks/:id/history', stockController.getHistory);

// Stock Transfers
router.get('/stock-transfers', stockTransferController.getAll);
router.get('/stock-transfers/:id', stockTransferController.getById);
router.post('/stock-transfers', authMiddleware, stockTransferController.create);

// Stock Adjustments
router.get('/stock-adjustments', stockAdjustmentController.getAll);
router.post('/stock-adjustments', authMiddleware, stockAdjustmentController.create);

// Users
router.get('/users', userController.getAll);
router.get('/users/:id', userController.getById);
router.post('/users', authMiddleware, userController.create);
router.put('/users/:id', authMiddleware, userController.update);
router.delete('/users/:id', authMiddleware, userController.delete);

// Dashboard
router.get('/dashboard', dashboardController.index);

// Cashier & Accounts
router.get('/cashier/session', authMiddleware, cashierController.currentSession);
router.post('/cashier/open', authMiddleware, cashierController.openSession);
router.post('/cashier/close', authMiddleware, cashierController.closeSession);
router.post('/cashier/deposit', authMiddleware, cashierController.deposit);
router.post('/cashier/transaction', authMiddleware, cashierController.storeCashTransaction);
router.get('/cashier/history', authMiddleware, cashierController.getHistory);
router.get('/accounts', authMiddleware, cashierController.getAccounts);

// Financial Reports
router.get('/reports/profit-loss', authMiddleware, reportController.getProfitLoss);
router.get('/reports/balance-sheet', authMiddleware, reportController.getBalanceSheet);
router.get('/reports/debt-receivable', authMiddleware, reportController.getDebtReceivable);
router.get('/reports/item-movements', authMiddleware, reportController.getItemMovementReport);

// Journals
router.post('/journals', authMiddleware, journalController.store);
router.get('/reports/ledger', authMiddleware, reportController.getLedger);
router.get('/reports/journals', authMiddleware, reportController.getJournals);

// Payments (Debt/Receivable Settlement)
router.get('/payments/unpaid', authMiddleware, paymentController.getUnpaid);
router.post('/payments', authMiddleware, paymentController.store);
router.get('/payments', authMiddleware, paymentController.getHistory);

// Accounts
router.get('/accounts', authMiddleware, cashierController.getAccounts);

// Settings (Helper for dropdowns)
router.get('/settings', async (req, res) => {
    try {
        const [item_categories] = await db.execute('SELECT id, name FROM item_categories');
        const [units] = await db.execute('SELECT id, name FROM units');
        const [customer_categories] = await db.execute('SELECT id, name FROM customer_categories');

        res.json({
            item_categories,
            units,
            customer_categories
        });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;
