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

  private writeToFile(level: string, message: string) {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} [${level}] ${message}\n`;
    
    fs.appendFileSync(this.logFile, logMessage);
    
    // In debug mode, also output to standard error
    if (this.debugMode) {
      process.stderr.write(logMessage);
    }
  }

  info(message: string) {
    this.writeToFile('INFO', message);
  }

  warn(message: string) {
    this.writeToFile('WARN', message);
  }

  error(message: string) {
    this.writeToFile('ERROR', message);
  }

  debug(message: string) {
    if (this.debugMode) {
      this.writeToFile('DEBUG', message);
    }
  }
}

// Create default logger instance
export const logger = new Logger({
  logFile: './logs/g-search-mcp.log',
  debugMode: process.argv.includes('--debug')
}); 