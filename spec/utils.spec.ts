import { expect } from 'chai';
import { appendSemiColon, versionCompare } from '../src/utils';

describe('utils', () => {
  describe('.versionCompare', () => {
    const parameters: [string, string, number][] = [
      ['8.0.2', '8.0.1', 1],
      ['8.0.2', '8.0.3', -1],
      ['8.0.2.', '8.1', -1],
      ['8.0.2', '8', 0],
      ['8.0', '8', 0],
      ['8', '8', 0],
      ['8', '8.0.2', 0],
      ['8', '8.0', 0],
      ['8.0.2', '12.3', -1],
      ['12.3', '8', 1],
      ['12', '8', 1],
      ['8', '12', -1],
    ];
    parameters.forEach(([versionA, versionB, expected]) => {
      it(`.versionCompare('${versionA}', '${versionB}') === ${expected}`, () => {
        expect(versionCompare(versionA, versionB)).to.be.eql(expected);
      });
    });
  });

  describe('.appendSemiColon', () => {
    const parameters: [string][] = [
      ['test'],
      ['test;'],
      ['\ntest'],
      ['test\n'],
      ['\ntest\n'],
      ['\ntest;\n'],
    ];
    parameters.forEach(([inputString]) => {
      it(`.appendSemiColon(${JSON.stringify(inputString)}) === 'test;'`, () => {
        expect(appendSemiColon(inputString)).to.eql('test;');
      });
    });
  });
});
