const fs = require('fs');
const path = require('path');

class Logger {
    constructor(logFile = 'activity.log') {
        this.logPath = path.resolve(process.cwd(), logFile);
        this.maxLogSize = 5 * 1024 * 1024; // 5MB
    }

    async log(level, message, metadata = {}) {
        const timestamp = new Date().toISOString();
        const stackInfo = this._getStackInfo();

        const logEntry = {
            id: Math.random().toString(36).substr(2, 9),
            timestamp,
            level: level.toUpperCase(),
            message,
            ...stackInfo,
            ...metadata
        };

        const logString = JSON.stringify(logEntry) + '\n';

        try {
            await this._checkRotation();
            fs.appendFileSync(this.logPath, logString);

            // Also log to console for visibility
            const color = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : '\x1b[32m';
            console.log(`${color}[${timestamp}] [${level}] ${message}\x1b[0m`);
        } catch (err) {
            console.error('Failed to write to log file:', err);
        }
    }

    info(message, metadata) {
        return this.log('INFO', message, metadata);
    }

    warn(message, metadata) {
        return this.log('WARN', message, metadata);
    }

    error(message, errorOrMetadata) {
        if (errorOrMetadata instanceof Error) {
            return this.log('ERROR', message, {
                error: errorOrMetadata.message,
                stack: errorOrMetadata.stack
            });
        }
        return this.log('ERROR', message, errorOrMetadata);
    }

    async getLogs(limit = 100) {
        try {
            if (!fs.existsSync(this.logPath)) return [];
            const content = fs.readFileSync(this.logPath, 'utf8');
            const lines = content.trim().split('\n');
            return lines.slice(-limit).map(line => {
                try {
                    return JSON.parse(line);
                } catch {
                    return { raw: line };
                }
            }).reverse();
        } catch (err) {
            console.error('Error reading logs:', err);
            return [];
        }
    }

    _getStackInfo() {
        const originalFunc = Error.prepareStackTrace;
        try {
            const err = new Error();
            Error.prepareStackTrace = (_, stack) => stack;
            const stack = err.stack;
            Error.prepareStackTrace = originalFunc;

            // stack[0] is this _getStackInfo
            // stack[1] is log()
            // stack[2] is info/warn/error
            // stack[3] is the caller
            const caller = stack[3];
            if (caller) {
                return {
                    file: path.basename(caller.getFileName() || 'unknown'),
                    line: caller.getLineNumber(),
                    function: caller.getFunctionName() || 'anonymous'
                };
            }
        } catch (e) {
            // Fallback if stack access fails
        } finally {
            Error.prepareStackTrace = originalFunc;
        }
        return {};
    }

    async deleteLogs(logIds) {
        try {
            if (!fs.existsSync(this.logPath)) return;
            const content = fs.readFileSync(this.logPath, 'utf8');
            const lines = content.trim().split('\n');
            const filteredLines = lines.filter(line => {
                try {
                    const entry = JSON.parse(line);
                    return !logIds.includes(entry.id);
                } catch {
                    return true;
                }
            });
            fs.writeFileSync(this.logPath, filteredLines.join('\n') + (filteredLines.length > 0 ? '\n' : ''));
            return true;
        } catch (err) {
            console.error('Error deleting logs:', err);
            return false;
        }
    }

    async _checkRotation() {
        try {
            if (fs.existsSync(this.logPath)) {
                const stats = fs.statSync(this.logPath);
                if (stats.size > this.maxLogSize) {
                    const backupPath = `${this.logPath}.old`;
                    fs.renameSync(this.logPath, backupPath);
                }
            }
        } catch (err) {
            console.error('Log rotation failed:', err);
        }
    }
}

module.exports = new Logger();
