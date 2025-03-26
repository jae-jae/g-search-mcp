import * as fs from 'fs';
import * as path from 'path';

class Logger {
  private logFile: string;
  private debugMode: boolean;

  constructor(options: { logFile?: string; debugMode?: boolean } = {}) {
    this.logFile = options.logFile || './g-search-mcp.log';
    this.debugMode = options.debugMode || false;
    
    // Ensure log directory exists
    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  private log(level: string, message: string) {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} [${level}] ${message}\n`;
    
    process.stderr.write(logMessage);
    
    if (this.debugMode) {
      fs.appendFileSync(this.logFile, logMessage);
    }
  }

  info(message: string) {
    this.log('INFO', message);
  }

  warn(message: string) {
    this.log('WARN', message);
  }

  error(message: string) {
    this.log('ERROR', message);
  }

  debug(message: string) {
    if (this.debugMode) {
      this.log('DEBUG', message);
    }
  }
}

// Create default logger instance
export const logger = new Logger({
  logFile: './logs/g-search-mcp.log',
  debugMode: process.argv.includes('--debug')
}); 