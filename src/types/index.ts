export interface SearchOptions {
  limit?: number;
  timeout?: number;
  stateFile?: string;
  noSaveState?: boolean;
  locale?: string;
  debug?: boolean;
}

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
}

export interface MultiSearchResponse {
  searches: SearchResponse[];
}
