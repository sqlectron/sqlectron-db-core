import { expect } from 'chai';
import { ADAPTERS, CLIENTS } from '../src';

it('should have ADAPTERS equal to CLIENTS', () => {
  expect(ADAPTERS).to.eql(CLIENTS);
});
