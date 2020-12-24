export interface ListDatabaseFilter {
  database?: string | {
    only: string[];
    ignore: string[];
  }
}
