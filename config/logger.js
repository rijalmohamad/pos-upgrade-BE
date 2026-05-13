const fs = require('fs');
const path = require('path');

class Logger {
    constructor() {
        this.logDir = path.join(__dirname, '../logs');
    }

    ensureDirExists(dir) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    getLogPath() {
        const now = new Date();
        const year = now.getFullYear().toString();
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');

        const dir = path.join(this.logDir, year, month);
        this.ensureDirExists(dir);

        return path.join(dir, `${day}.log`);
    }

    log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        const logPath = this.getLogPath();
        const logMessage = `[${timestamp}] [${type}] ${message}\n`;

        fs.appendFileSync(logPath, logMessage);
        
        if (process.env.NODE_ENV !== 'production') {
            console.log(logMessage.trim());
        }
    }

    error(message, error = null) {
        let fullMessage = message;
        if (error) {
            fullMessage += ` | Error: ${error.message} | Stack: ${error.stack}`;
        }
        this.log(fullMessage, 'ERROR');
    }

    warn(message) {
        this.log(message, 'WARN');
    }
}

module.exports = new Logger();
