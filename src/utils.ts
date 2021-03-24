import fs from 'fs';
import { homedir } from 'os';
import path from 'path';
import { identify } from 'sql-query-identifier';

import { CanceledByUserError } from './errors';

import type { Result } from 'sql-query-identifier';

export function readFile(filename: string): Promise<string> {
  const filePath = resolveHomePathToAbsolute(filename);
  return new Promise((resolve, reject) => {
    fs.readFile(path.resolve(filePath), { encoding: 'utf-8' }, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

export function resolveHomePathToAbsolute(filename: string): string {
  if (!/^~\//.test(filename)) {
    return filename;
  }

  return path.join(homedir(), filename.substring(2));
}

export function createCancelablePromise(timeIdle = 100): {
  wait: () => Promise<void>,
  cancel: () => void,
  discard: () => void
} {
  let canceled = false;
  let discarded = false;

  const wait = (time: number) => new Promise((resolve) => setTimeout(resolve, time));

  return {
    async wait() {
      while (!canceled && !discarded) {
        // eslint-disable-next-line
        await wait(timeIdle);
      }

      if (canceled) {
        throw new CanceledByUserError();
      }
    },
    cancel() {
      canceled = true;
    },
    discard() {
      discarded = true;
    },
  };
}

/**
 * Compares two version strings.
 *
 * For two version strings, this fucntion will return -1 if the first version is smaller
 * than the second version, 0 if they are equal, and 1 if the second version is smaller.
 * However, this function will only compare up-to the smallest part of the version string
 * defined between the two, such '8' and '8.0.2' will be considered equal.
 */
export function versionCompare(a: string, b: string): -1 | 0 | 1 {
  const fullA = a.split('.').map((val) => parseInt(val, 10));
  const fullB = b.split('.').map((val) => parseInt(val, 10));

  for (let i = 0; i < Math.min(fullA.length, fullB.length); i++) {
    if (fullA[i] > fullB[i]) {
      return 1;
    } else if (fullA[i] < fullB[i]) {
      return -1;
    }
  }
  return 0;
}

export function identifyCommands(queryText: string): Result[] {
  try {
    return identify(queryText);
  } catch (err) {
    return [];
  }
}

export function appendSemiColon(query: string): string {
  let result = query.trim()
  if (result[result.length - 1] !== ';') {
    result += ';';
  }
  return result;
}
