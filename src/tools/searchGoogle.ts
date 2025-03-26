import { MultiSearchResponse, SearchOptions } from "../types/index.js";
import { multiGoogleSearch } from "../services/googleSearch.js";
import { isDebugMode } from "../index.js";
import { logger } from "../utils/logger.js";

/**
 * Tool definition for g_search
 */
export const searchGoogleTool = {
  name: "search",
  description: "Search on Google for multiple keywords and return the results",
  inputSchema: {
    type: "object",
    properties: {
      queries: {
        type: "array",
        items: {
          type: "string"
        },
        description: "Array of search queries to perform",
      },
      limit: {
        type: "number",
        description:
          "Maximum number of results to return per query (default: 10)",
      },
      timeout: {
        type: "number",
        description:
          "Page loading timeout in milliseconds (default: 60000)",
      },
      noSaveState: {
        type: "boolean",
        description:
          "Whether to avoid saving browser state (default: false)",
      },
      locale: {
        type: "string",
        description:
          "Locale setting for search results (default: en-US)",
      },
      debug: {
        type: "boolean",
        description:
          "Whether to enable debug mode (showing browser window), overrides the --debug command line flag if specified",
      },
    },
    required: ["queries"],
  },
};

/**
 * Implementation of the g_search tool
 */
export async function searchGoogle(args: any) {
  const queries = args?.queries || [];
  
  if (!Array.isArray(queries) || queries.length === 0) {
    logger.error(`[Error] At least one search query is required`);
    throw new Error("At least one search query is required");
  }

  const options: SearchOptions = {
    limit: Number(args?.limit) || 10,
    timeout: Number(args?.timeout) || 60000,
    noSaveState: args?.noSaveState === true,
    locale: String(args?.locale || "en-US"),
    debug: args?.debug !== undefined ? args?.debug : isDebugMode // Use tool param if provided, otherwise use command line flag
  };

  // Log search parameters
  logger.info(`[SearchGoogle] Starting search for ${queries.length} queries with options: ${JSON.stringify(options)}`);
  logger.info(`[SearchGoogle] Debug mode: ${options.debug ? 'enabled' : 'disabled'} (from CLI flag: ${isDebugMode})`);

  try {
    const results = await multiGoogleSearch(queries, options);
    
    logger.info(`[SearchGoogle] Search completed successfully for ${results.length} queries`);
    
    // Format the response
    const response: MultiSearchResponse = {
      searches: results
    };

    return {
      content: [{
        type: "text",
        text: JSON.stringify(response, null, 2)
      }]
    };
  } catch (error) {
    logger.error(`[SearchGoogle] Error during search: ${error}`);
    throw error;
  }
} 