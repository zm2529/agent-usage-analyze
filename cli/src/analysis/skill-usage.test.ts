import { describe, expect, it } from 'vitest';
import {
  agentAppliedSkillNames,
  summarizeObservedSkills,
  userInvokedSkillNames,
} from './skill-usage.js';

describe('observed Skill usage', () => {
  it('separates user-named Skills from Skills opened by the Agent', () => {
    expect(userInvokedSkillNames('请使用 $diagnose 和 [$tdd](/tmp/tdd/SKILL.md)')).toEqual([
      'tdd', 'diagnose',
    ]);
    expect(agentAppliedSkillNames(JSON.stringify([{
      name: 'exec_command',
      input: JSON.stringify({ cmd: 'sed -n 1,200p /Users/me/.codex/skills/ui-review/SKILL.md' }),
    }]))).toEqual(['ui-review']);
  });

  it('classifies an Agent-opened Skill as automatic only when the user did not name it', () => {
    expect(summarizeObservedSkills([
      { type: 'user', content: '排查问题' },
      {
        type: 'assistant',
        content: '我会先诊断。',
        toolCalls: JSON.stringify([{
          name: 'exec_command',
          input: JSON.stringify({ cmd: 'cat /skills/diagnose/SKILL.md' }),
        }]),
      },
      { type: 'user', content: '下一步使用 $tdd' },
      {
        type: 'assistant',
        content: '开始。',
        toolCalls: JSON.stringify([{
          name: 'exec_command',
          input: JSON.stringify({ cmd: 'cat /skills/tdd/SKILL.md' }),
        }]),
      },
    ])).toEqual([
      { name: 'tdd', userInvocations: 1, agentInvocations: 1, automaticInvocations: 0 },
      { name: 'diagnose', userInvocations: 0, agentInvocations: 1, automaticInvocations: 1 },
    ]);
  });
});
