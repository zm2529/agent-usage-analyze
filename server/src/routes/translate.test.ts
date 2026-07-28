import { describe, expect, it } from 'vitest';
import {
  applyTranslatedLeaves,
  collectTranslationLeaves,
  schemaForShape,
  translationLeavesForTarget,
} from './translate.js';

describe('translation response schema', () => {
  it('preserves the exact object and list shape while requiring concrete JSON types', () => {
    expect(schemaForShape({
      title: 'Example',
      tags: ['one', 'two'],
      source: { official: true, score: 2 },
    })).toEqual({
      type: 'object',
      properties: {
        title: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        source: {
          type: 'object',
          properties: {
            official: { type: 'boolean' },
            score: { type: 'integer' },
          },
          required: ['official', 'score'],
          additionalProperties: false,
        },
      },
      required: ['title', 'tags', 'source'],
      additionalProperties: false,
    });
  });

  it('translates leaf strings without changing the generated-content shape', () => {
    const content = {
      id: 'practice:1',
      title: '明确任务边界',
      nested: { summary: '保留验证证据', score: 2 },
      tags: ['task-scope', '验收'],
    };
    const leaves = collectTranslationLeaves(content);
    expect(leaves.map((leaf) => leaf.text)).toEqual([
      'practice:1', '明确任务边界', '保留验证证据', 'task-scope', '验收',
    ]);
    expect(applyTranslatedLeaves(content, leaves, [
      'practice:1', 'Define task boundaries', 'Preserve validation evidence', 'task-scope', 'acceptance',
    ])).toEqual({
      id: 'practice:1',
      title: 'Define task boundaries',
      nested: { summary: 'Preserve validation evidence', score: 2 },
      tags: ['task-scope', 'acceptance'],
    });
  });

  it('sends only natural-language leaves that need the target language', () => {
    const source = {
      title: '需要翻译的标题',
      url: 'https://example.com/guide',
      tag: 'multi-agent',
      summary: 'Use explicit acceptance criteria for bounded tasks.',
    };
    expect(translationLeavesForTarget(source, 'en').map((leaf) => leaf.text))
      .toEqual(['需要翻译的标题']);
    expect(translationLeavesForTarget(source, 'zh-CN').map((leaf) => leaf.text))
      .toEqual(['Use explicit acceptance criteria for bounded tasks.']);
  });
});
