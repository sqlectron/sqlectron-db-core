import debug from 'debug';

export interface Logger {
  debug: (msg: string, ...params: unknown[]) => void;
  error: (msg: string, ...params: unknown[]) => void;
}

const loggers: {[key: string]: Logger} = {};

export default function createLogger(namespace: string): () => Logger {
  if (!namespace) { throw new Error('Missing log namespace'); }
  if (loggers[namespace]) { throw new Error('This logger is already registered'); }

  // default logger
  const debugLogger = debug(`sqlectron-core:${namespace}`);
  loggers[namespace] = {
    debug: debugLogger.bind(debugLogger),
    error: debugLogger.bind(debugLogger),
  };

  // The logger is loaded through a function
  // so is possible to access a new logger
  // defined with setLogger
  return () => loggers[namespace];
}

/**
 * Allow use a different logger
 */
export function setLogger(customLogger: (logger: string) => Logger): void {
  Object.keys(loggers).forEach((logger) => {
    loggers[logger] = customLogger(logger);
  });
}
