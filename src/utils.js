import fs from 'fs';
import { homedir } from 'os';
import path from 'path';
import pf from 'portfinder';

export function readFile(filename) {
  const filePath = resolveHomePathToAbsolute(filename);
  return new Promise((resolve, reject) => {
    fs.readFile(path.resolve(filePath), { encoding: 'utf-8' }, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

export function resolveHomePathToAbsolute(filename) {
  if (!/^~\//.test(filename)) {
    return filename;
  }

  return path.join(homedir(), filename.substring(2));
}

export function getPort() {
  return new Promise((resolve, reject) => {
    pf.getPort({ host: 'localhost' }, (err, port) => {
      if (err) return reject(err);
      resolve(port);
    });
  });
}

export function createCancelablePromise(error, timeIdle = 100) {
  let canceled = false;
  let discarded = false;

  const wait = (time) => new Promise((resolve) => setTimeout(resolve, time));

  return {
    async wait() {
      while (!canceled && !discarded) {
        // eslint-disable-next-line
        await wait(timeIdle);
      }

      if (canceled) {
        const err = new Error(error.message || 'Promise canceled.');

        Object.getOwnPropertyNames(error)
          .forEach((key) => err[key] = error[key]); // eslint-disable-line no-return-assign

        throw err;
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
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function versionCompare(a, b) {
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
