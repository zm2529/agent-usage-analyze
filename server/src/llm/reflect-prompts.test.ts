import { describe, it, expect } from 'vitest';
import {
  FRICTION_WINS_SYSTEM_PROMPT,
  RULES_SKILLS_SYSTEM_PROMPT,
  WORKING_STYLE_SYSTEM_PROMPT,
  generateFrictionWinsPrompt,
  generateRulesSkillsPrompt,
  generateWorkingStylePrompt,
} from './reflect-prompts.js';

// --- System prompt structural tests ---

describe('FRICTION_WINS_SYSTEM_PROMPT', () => {
  it('contains <json> tags', () => {
    expect(FRICTION_WINS_SYSTEM_PROMPT).toContain('<json>');
    expect(FRICTION_WINS_SYSTEM_PROMPT).toContain('</json>');
  });

  it('contains "valid JSON"', () => {
    expect(FRICTION_WINS_SYSTEM_PROMPT).toContain('valid JSON');
  });
});

describe('RULES_SKILLS_SYSTEM_PROMPT', () => {
  it('contains <json> tags', () => {
    expect(RULES_SKILLS_SYSTEM_PROMPT).toContain('<json>');
    expect(RULES_SKILLS_SYSTEM_PROMPT).toContain('</json>');
  });
});

describe('WORKING_STYLE_SYSTEM_PROMPT', () => {
  it('contains "tagline"', () => {
    expect(WORKING_STYLE_SYSTEM_PROMPT).toContain('tagline');
  });

  it('contains "40 characters"', () => {
    expect(WORKING_STYLE_SYSTEM_PROMPT).toContain('40 characters');
  });
});

// --- generateFrictionWinsPrompt ---

const sampleFrictionCategories = [
  { category: 'wrong-approach', count: 5, avg_severity: 0.8, examples: ['example 1'] },
  { category: 'knowledge-gap', count: 3, avg_severity: 0.5, examples: ['example 2'] },
];

const sampleEffectivePatterns = [
  { category: 'structured-planning', label: 'Structured Planning', frequency: 4, avg_confidence: 0.9, descriptions: ['desc 1'] },
];

describe('generateFrictionWinsPrompt', () => {
  it('includes session count and period in output', () => {
    const result = generateFrictionWinsPrompt({
      frictionCategories: sampleFrictionCategories,
      effectivePatterns: sampleEffectivePatterns,
      totalSessions: 42,
      period: '2026-W10',
    });
    expect(result).toContain('42');
    expect(result).toContain('2026-W10');
  });

  it('includes "FRICTION CATEGORIES" and "EFFECTIVE PATTERNS" sections', () => {
    const result = generateFrictionWinsPrompt({
      frictionCategories: sampleFrictionCategories,
      effectivePatterns: sampleEffectivePatterns,
      totalSessions: 10,
      period: '2026-W09',
    });
    expect(result).toContain('FRICTION CATEGORIES');
    expect(result).toContain('EFFECTIVE PATTERNS');
  });

  it('includes PQ signals section when pqSignals provided with data', () => {
    const result = generateFrictionWinsPrompt({
      frictionCategories: sampleFrictionCategories,
      effectivePatterns: sampleEffectivePatterns,
      totalSessions: 10,
      period: '2026-W09',
      pqSignals: {
        deficits: [{ category: 'vague-request', count: 3 }],
        strengths: [{ category: 'precise-request', count: 2 }],
      },
    });
    expect(result).toContain('PROMPT QUALITY SIGNALS');
    expect(result).toContain('vague-request');
    expect(result).toContain('precise-request');
  });

  it('excludes PQ section when no pqSignals provided', () => {
    const result = generateFrictionWinsPrompt({
      frictionCategories: sampleFrictionCategories,
      effectivePatterns: sampleEffectivePatterns,
      totalSessions: 10,
      period: '2026-W09',
    });
    expect(result).not.toContain('PROMPT QUALITY SIGNALS');
  });

  it('excludes PQ section when pqSignals has empty arrays', () => {
    const result = generateFrictionWinsPrompt({
      frictionCategories: sampleFrictionCategories,
      effectivePatterns: sampleEffectivePatterns,
      totalSessions: 10,
      period: '2026-W09',
      pqSignals: { deficits: [], strengths: [] },
    });
    expect(result).not.toContain('PROMPT QUALITY SIGNALS');
  });

  it('slices frictionCategories to max 15', () => {
    const manyFriction = Array.from({ length: 20 }, (_, i) => ({
      category: `category-${i}`,
      count: i + 1,
      avg_severity: 0.5,
      examples: [],
    }));
    const result = generateFrictionWinsPrompt({
      frictionCategories: manyFriction,
      effectivePatterns: sampleEffectivePatterns,
      totalSessions: 10,
      period: '2026-W09',
    });
    // category-15 through category-19 should not appear (indices 15-19)
    expect(result).not.toContain('category-15');
    expect(result).not.toContain('category-19');
    // category-14 should be the last one (index 14)
    expect(result).toContain('category-14');
  });

  it('slices effectivePatterns to max 10', () => {
    const manyPatterns = Array.from({ length: 15 }, (_, i) => ({
      category: `pattern-cat-${i}`,
      label: `Pattern ${i}`,
      frequency: i + 1,
      avg_confidence: 0.8,
      descriptions: [],
    }));
    const result = generateFrictionWinsPrompt({
      frictionCategories: sampleFrictionCategories,
      effectivePatterns: manyPatterns,
      totalSessions: 10,
      period: '2026-W09',
    });
    // pattern-cat-10 through pattern-cat-14 should not appear (indices 10-14)
    expect(result).not.toContain('pattern-cat-10');
    expect(result).not.toContain('pattern-cat-14');
    // pattern-cat-9 should be the last one (index 9)
    expect(result).toContain('pattern-cat-9');
  });
});

// --- generateRulesSkillsPrompt ---

describe('generateRulesSkillsPrompt', () => {
  const sampleData = {
    recurringFriction: [
      { category: 'wrong-approach', count: 4, avg_severity: 0.7, examples: ['ex1'] },
    ],
    effectivePatterns: [
      { category: 'structured-planning', label: 'Structured Planning', frequency: 3, avg_confidence: 0.85, descriptions: ['desc'] },
    ],
    targetTool: 'Claude Code',
  };

  it('includes target tool name', () => {
    const result = generateRulesSkillsPrompt(sampleData);
    expect(result).toContain('Claude Code');
  });

  it('includes "RECURRING FRICTION" and "EFFECTIVE PATTERNS" sections', () => {
    const result = generateRulesSkillsPrompt(sampleData);
    expect(result).toContain('RECURRING FRICTION');
    expect(result).toContain('EFFECTIVE PATTERNS');
  });

  it('contains the friction data as JSON', () => {
    const result = generateRulesSkillsPrompt(sampleData);
    expect(result).toContain('wrong-approach');
    expect(result).toContain('"count": 4');
  });

  it('contains the pattern data as JSON', () => {
    const result = generateRulesSkillsPrompt(sampleData);
    expect(result).toContain('structured-planning');
    expect(result).toContain('"frequency": 3');
  });
});

// --- generateWorkingStylePrompt ---

describe('generateWorkingStylePrompt', () => {
  const sampleData = {
    workflowDistribution: { iterative: 5, linear: 3 },
    outcomeDistribution: { satisfied: 6, partial: 2 },
    characterDistribution: { feature_build: 4, bug_hunt: 2, deep_focus: 2 },
    totalSessions: 8,
    period: '2026-W11',
    frictionFrequency: 12,
  };

  it('includes session count and period', () => {
    const result = generateWorkingStylePrompt(sampleData);
    expect(result).toContain('8');
    expect(result).toContain('2026-W11');
  });

  it('includes "WORKFLOW PATTERNS", "OUTCOME SATISFACTION", "SESSION TYPES" sections', () => {
    const result = generateWorkingStylePrompt(sampleData);
    expect(result).toContain('WORKFLOW PATTERNS');
    expect(result).toContain('OUTCOME SATISFACTION');
    expect(result).toContain('SESSION TYPES');
  });

  it('includes friction frequency count', () => {
    const result = generateWorkingStylePrompt(sampleData);
    expect(result).toContain('12');
    expect(result).toContain('FRICTION FREQUENCY');
  });

  it('contains distribution data as JSON', () => {
    const result = generateWorkingStylePrompt(sampleData);
    expect(result).toContain('"iterative": 5');
    expect(result).toContain('"satisfied": 6');
    expect(result).toContain('"feature_build": 4');
  });
});
