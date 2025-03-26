class Logger {
  private debugMode: boolean;

  constructor(options: { debugMode?: boolean } = {}) {
    this.debugMode = options.debugMode || false;
  }

  private log(level: string, message: string) {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} [${level}] ${message}`;
    console.error(logMessage);
  }

  info(message: string) {
    this.log("INFO", message);
  }

  warn(message: string) {
    this.log("WARN", message);
  }

  error(message: string) {
    this.log("ERROR", message);
  }

  debug(message: string) {
    if (this.debugMode) {
      this.log("DEBUG", message);
    }
  }
}

// Create default logger instance
export const logger = new Logger({
  debugMode: process.argv.includes("--debug"),
});
