import { searchGoogleTool, searchGoogle } from './searchGoogle.js';

// Export tool definitions
export const tools = [
  searchGoogleTool
];

// Export tool implementations
export const toolHandlers = {
  [searchGoogleTool.name]: searchGoogle
};
