#!/usr/bin/env node

/**
 * MCP server for Google search using Playwright headless browser
 * Provides functionality to search on Google with multiple keywords
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { logger } from "./utils/logger.js";

// Parse command line arguments, check for debug flag
export const isDebugMode = process.argv.includes("--debug");

/**
 * Start the server
 */
async function main() {
  logger.info("[Setup] Initializing Google Search MCP server...");

  if (isDebugMode) {
    logger.debug("[Setup] Debug mode enabled, Chrome browser window will be visible");
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("[Setup] Server started");
}

main().catch((error) => {
  logger.error(`[Error] Server error: ${error}`);
  process.exit(1);
});
