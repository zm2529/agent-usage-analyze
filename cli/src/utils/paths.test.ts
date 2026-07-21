import { describe, it, expect } from 'vitest';
import { splitVirtualPath } from './paths.js';

describe('splitVirtualPath', () => {
  it('splits path with hash into realPath and sessionFragment', () => {
    const result = splitVirtualPath('/path/to/state.vscdb#composerId');
    expect(result).toEqual({
      realPath: '/path/to/state.vscdb',
      sessionFragment: 'composerId',
    });
  });

  it('returns null sessionFragment when no hash present', () => {
    const result = splitVirtualPath('/path/to/file.jsonl');
    expect(result).toEqual({
      realPath: '/path/to/file.jsonl',
      sessionFragment: null,
    });
  });

  it('splits on the last hash when multiple hashes exist', () => {
    const result = splitVirtualPath('/path/to/file#first#second');
    expect(result).toEqual({
      realPath: '/path/to/file#first',
      sessionFragment: 'second',
    });
  });

  it('returns null sessionFragment when hash is at position 0', () => {
    const result = splitVirtualPath('#fragment');
    expect(result).toEqual({
      realPath: '#fragment',
      sessionFragment: null,
    });
  });

  it('handles empty string', () => {
    const result = splitVirtualPath('');
    expect(result).toEqual({
      realPath: '',
      sessionFragment: null,
    });
  });

  it('handles hash at the end of path (empty fragment)', () => {
    const result = splitVirtualPath('/path/to/file#');
    expect(result).toEqual({
      realPath: '/path/to/file',
      sessionFragment: '',
    });
  });
});
