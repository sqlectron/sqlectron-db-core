export class CanceledByUserError extends Error {
  code: string;
  sqlectronError: string;

  constructor() {
    super('Query canceled by user. The query process may still in the process list. But has already received the command to kill it successfully.');
    this.name = 'Query canceled by user';
    this.code = 'CANCELED_BY_USER';
    this.sqlectronError = this.code;
  }
}
