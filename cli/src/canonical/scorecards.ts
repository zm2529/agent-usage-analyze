import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export type ScorecardStatus = 'draft' | 'calibrating' | 'active' | 'retired';
export type ScoreUnavailableReason = 'scorecard-not-active' | 'calibration-not-passed'
  | 'quality-gate-failed' | 'safety-gate-failed' | 'insufficient-coverage' | 'missing-feature'
  | 'task-not-found' | 'out-of-scope';

export interface ScorecardFeature {
  key: string;
  label: string;
  weight: number;
  requiresQualityGate: boolean;
}

export interface ScorecardDefinition {
  name: string;
  version: string;
  features: ScorecardFeature[];
  qualityGates: string[];
  safetyGates: string[];
  missingRules: Record<string, 'unavailable' | 'neutral'>;
  thresholds: { minimumCoverage: number };
  calibrationDataVersion: string | null;
  scope: { kind: 'personal'; taskRole?: string };
  evidenceRefs: string[];
}

export interface ScorecardVersion extends ScorecardDefinition {
  id: string;
  definitionHash: string;
  status: ScorecardStatus;
  createdAt: string;
}

export interface ScorecardEvaluationInput {
  taskId: string;
  scorecardVersionId: string;
  rawFeatures: Record<string, number | null>;
  gateResults: { quality: boolean; safety: boolean; calibration: boolean };
  coverage: number;
  uncertainty: number;
  evidenceRefs: string[];
}

export interface ScorecardResult extends ScorecardEvaluationInput {
  id: string;
  indexValue: number | null;
  unavailableReason: ScoreUnavailableReason | null;
  createdAt: string;
}

const STATUSES = new Set<ScorecardStatus>(['draft', 'calibrating', 'active', 'retired']);
const APPROVED_FEATURES = {
  deliveryEvidence: { label: 'Delivery evidence', requiresQualityGate: false },
  validationStrength: { label: 'Validation strength', requiresQualityGate: false },
  reworkAvoidanceAfterQuality: { label: 'Rework avoidance after quality', requiresQualityGate: true },
  tokenEfficiencyAfterQuality: { label: 'Token efficiency after quality', requiresQualityGate: true },
} as const;
const TASK_ROLES = new Set(['root', 'subagent', 'reviewer', 'worker', 'unknown']);

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unsupported = Object.keys(value).find((key) => !allowed.includes(key));
  if (unsupported) throw new Error(`${label} contains unsupported field: ${unsupported}`);
}

function assertBounded(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1`);
  }
}

function assertShortString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256 || value.includes('\n')) {
    throw new Error(`${label} must be a non-empty bounded string`);
  }
}

function assertRefs(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} requires evidence refs`);
  value.forEach((ref, index) => {
    assertShortString(ref, `${label}[${index}]`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(ref)) throw new Error(`${label} evidence refs must be opaque identifiers`);
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateDefinition(value: ScorecardDefinition): void {
  assertPlainObject(value, 'Scorecard definition');
  assertOnlyKeys(value, ['name', 'version', 'features', 'qualityGates', 'safetyGates', 'missingRules', 'thresholds', 'calibrationDataVersion', 'scope', 'evidenceRefs'], 'Scorecard definition');
  assertShortString(value.name, 'Scorecard name');
  assertShortString(value.version, 'Scorecard version');
  if (!Array.isArray(value.features) || value.features.length === 0) throw new Error('Scorecard features are required');
  const keys = new Set<string>();
  let weight = 0;
  for (const feature of value.features) {
    assertPlainObject(feature, 'Scorecard feature');
    assertOnlyKeys(feature, ['key', 'label', 'weight', 'requiresQualityGate'], 'Scorecard feature');
    assertShortString(feature.key, 'Feature key');
    assertShortString(feature.label, 'Feature label');
    const approved = APPROVED_FEATURES[feature.key as keyof typeof APPROVED_FEATURES];
    if (!approved || feature.label !== approved.label) throw new Error(`Not an approved scorecard feature: ${feature.key}`);
    if (keys.has(feature.key)) throw new Error(`Duplicate feature: ${feature.key}`);
    keys.add(feature.key);
    if (typeof feature.weight !== 'number' || !Number.isFinite(feature.weight) || feature.weight <= 0) {
      throw new Error('Feature weights must be positive');
    }
    if (typeof feature.requiresQualityGate !== 'boolean') throw new Error('requiresQualityGate must be boolean');
    if (feature.requiresQualityGate !== approved.requiresQualityGate) {
      throw new Error(`Approved feature gate contract does not match: ${feature.key}`);
    }
    weight += feature.weight;
  }
  if (weight <= 0) throw new Error('Scorecard feature weights are required');
  for (const [label, gates] of [['quality', value.qualityGates], ['safety', value.safetyGates]] as const) {
    if (!Array.isArray(gates) || gates.length === 0) throw new Error(`${label} gates are required`);
    gates.forEach((gate, index) => assertShortString(gate, `${label} gate ${index}`));
  }
  assertPlainObject(value.missingRules, 'Missing rules');
  if (Object.keys(value.missingRules).length !== keys.size
      || Object.keys(value.missingRules).some((key) => !keys.has(key))) {
    throw new Error('Missing rules must cover exactly the declared features');
  }
  for (const [key, rule] of Object.entries(value.missingRules)) {
    if (rule !== 'unavailable' && rule !== 'neutral') throw new Error(`Unsupported missing rule for ${key}`);
  }
  assertPlainObject(value.thresholds, 'Scorecard thresholds');
  assertOnlyKeys(value.thresholds, ['minimumCoverage'], 'Scorecard thresholds');
  assertBounded(value.thresholds.minimumCoverage, 'Minimum coverage');
  if (value.calibrationDataVersion !== null) assertShortString(value.calibrationDataVersion, 'Calibration data version');
  assertPlainObject(value.scope, 'Scorecard scope');
  assertOnlyKeys(value.scope, ['kind', 'taskRole'], 'Scorecard scope');
  if (value.scope.kind !== 'personal') throw new Error('Only personal scorecard scope is supported');
  if (value.scope.taskRole !== undefined) {
    assertShortString(value.scope.taskRole, 'Task role');
    if (!TASK_ROLES.has(value.scope.taskRole)) throw new Error('Unsupported task role scope');
  }
  assertRefs(value.evidenceRefs, 'Scorecard definition');
}

interface ScorecardRow {
  id: string; name: string; version: string; definitionHash: string; featuresJson: string;
  qualityGatesJson: string; safetyGatesJson: string; missingRulesJson: string;
  thresholdsJson: string; calibrationDataVersion: string | null; scopeJson: string;
  evidenceRefsJson: string; createdAt: string; status: ScorecardStatus;
}

function parseVersion(row: ScorecardRow): ScorecardVersion {
  return {
    id: row.id, name: row.name, version: row.version, definitionHash: row.definitionHash,
    status: row.status, features: JSON.parse(row.featuresJson) as ScorecardFeature[],
    qualityGates: JSON.parse(row.qualityGatesJson) as string[],
    safetyGates: JSON.parse(row.safetyGatesJson) as string[],
    missingRules: JSON.parse(row.missingRulesJson) as ScorecardDefinition['missingRules'],
    thresholds: JSON.parse(row.thresholdsJson) as ScorecardDefinition['thresholds'],
    calibrationDataVersion: row.calibrationDataVersion,
    scope: JSON.parse(row.scopeJson) as ScorecardDefinition['scope'],
    evidenceRefs: JSON.parse(row.evidenceRefsJson) as string[], createdAt: row.createdAt,
  };
}

const VERSION_SELECT = `SELECT v.id, v.name, v.version, v.definition_hash AS definitionHash,
  v.features_json AS featuresJson, v.quality_gates_json AS qualityGatesJson,
  v.safety_gates_json AS safetyGatesJson, v.missing_rules_json AS missingRulesJson,
  v.thresholds_json AS thresholdsJson, v.calibration_data_version AS calibrationDataVersion,
  v.scope_json AS scopeJson, v.evidence_refs_json AS evidenceRefsJson, v.created_at AS createdAt,
  (SELECT s.to_status FROM scorecard_status_events s WHERE s.scorecard_id = v.id
    ORDER BY s.sequence DESC LIMIT 1) AS status FROM scorecard_versions v`;

export function createScorecardVersion(db: Database.Database, definition: ScorecardDefinition): ScorecardVersion {
  validateDefinition(definition);
  const normalized = stableJson(definition);
  const definitionHash = createHash('sha256').update(normalized).digest('hex');
  const id = `scorecard:sha256:${definitionHash}`;
  db.transaction(() => {
    db.prepare(`INSERT INTO scorecard_versions (
      id, name, version, definition_hash, features_json, quality_gates_json, safety_gates_json,
      missing_rules_json, thresholds_json, calibration_data_version, scope_json, evidence_refs_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, definition.name, definition.version, definitionHash, JSON.stringify(definition.features),
      JSON.stringify(definition.qualityGates), JSON.stringify(definition.safetyGates),
      JSON.stringify(definition.missingRules), JSON.stringify(definition.thresholds),
      definition.calibrationDataVersion, JSON.stringify(definition.scope), JSON.stringify(definition.evidenceRefs),
    );
    db.prepare(`INSERT INTO scorecard_status_events
      (scorecard_id, from_status, to_status, evidence_refs_json) VALUES (?, NULL, 'draft', ?)`)
      .run(id, JSON.stringify(definition.evidenceRefs));
  })();
  return listScorecardVersions(db).find((version) => version.id === id)!;
}

export function listScorecardVersions(db: Database.Database): ScorecardVersion[] {
  return (db.prepare(`${VERSION_SELECT} ORDER BY v.created_at DESC, v.id DESC`).all() as ScorecardRow[])
    .map(parseVersion);
}

export function transitionScorecardVersion(
  db: Database.Database,
  id: string,
  toStatus: ScorecardStatus,
  evidenceRefs: string[],
): ScorecardVersion {
  if (!STATUSES.has(toStatus)) throw new Error('Unsupported scorecard status');
  assertRefs(evidenceRefs, 'Scorecard transition');
  const version = listScorecardVersions(db).find((item) => item.id === id);
  if (!version) throw new Error('Scorecard version not found');
  const allowed: Record<ScorecardStatus, ScorecardStatus[]> = {
    draft: ['calibrating'], calibrating: ['active', 'retired'], active: ['retired'], retired: [],
  };
  if (!allowed[version.status].includes(toStatus)) {
    throw new Error(`Invalid scorecard status transition: ${version.status} -> ${toStatus}`);
  }
  if (toStatus === 'active' && !version.calibrationDataVersion) {
    throw new Error('Active scorecards require a calibration data version');
  }
  db.prepare(`INSERT INTO scorecard_status_events
    (scorecard_id, from_status, to_status, evidence_refs_json) VALUES (?, ?, ?, ?)`)
    .run(id, version.status, toStatus, JSON.stringify(evidenceRefs));
  return listScorecardVersions(db).find((item) => item.id === id)!;
}

function reasonFor(
  version: ScorecardVersion,
  input: ScorecardEvaluationInput,
  subjectReason: 'task-not-found' | 'out-of-scope' | null,
): ScoreUnavailableReason | null {
  if (subjectReason) return subjectReason;
  if (version.status !== 'active') return 'scorecard-not-active';
  if (!input.gateResults.calibration) return 'calibration-not-passed';
  if (!input.gateResults.quality) return 'quality-gate-failed';
  if (!input.gateResults.safety) return 'safety-gate-failed';
  if (input.coverage < version.thresholds.minimumCoverage) return 'insufficient-coverage';
  if (version.features.some((feature) => input.rawFeatures[feature.key] === null
      && version.missingRules[feature.key] === 'unavailable')) return 'missing-feature';
  return null;
}

function parseResult(row: {
  id: string; taskId: string; scorecardVersionId: string; rawFeaturesJson: string;
  gateResultsJson: string; coverage: number; uncertainty: number; indexValue: number | null;
  unavailableReason: ScoreUnavailableReason | null; evidenceRefsJson: string; createdAt: string;
}): ScorecardResult {
  return {
    id: row.id, taskId: row.taskId, scorecardVersionId: row.scorecardVersionId,
    rawFeatures: JSON.parse(row.rawFeaturesJson) as Record<string, number | null>,
    gateResults: JSON.parse(row.gateResultsJson) as ScorecardEvaluationInput['gateResults'],
    coverage: row.coverage, uncertainty: row.uncertainty, indexValue: row.indexValue,
    unavailableReason: row.unavailableReason,
    evidenceRefs: JSON.parse(row.evidenceRefsJson) as string[], createdAt: row.createdAt,
  };
}

const RESULT_SELECT = `SELECT id, task_id AS taskId, scorecard_version_id AS scorecardVersionId,
  raw_features_json AS rawFeaturesJson, gate_results_json AS gateResultsJson, coverage, uncertainty,
  index_value AS indexValue, unavailable_reason AS unavailableReason,
  evidence_refs_json AS evidenceRefsJson, created_at AS createdAt FROM scorecard_results`;

export function evaluateScorecard(db: Database.Database, input: ScorecardEvaluationInput): ScorecardResult {
  assertPlainObject(input, 'Scorecard evaluation');
  assertOnlyKeys(input, ['taskId', 'scorecardVersionId', 'rawFeatures', 'gateResults', 'coverage', 'uncertainty', 'evidenceRefs'], 'Scorecard evaluation');
  assertShortString(input.taskId, 'Task id');
  assertShortString(input.scorecardVersionId, 'Scorecard version id');
  assertBounded(input.coverage, 'Coverage');
  assertBounded(input.uncertainty, 'Uncertainty');
  assertRefs(input.evidenceRefs, 'Scorecard result');
  assertPlainObject(input.rawFeatures, 'Raw features');
  assertPlainObject(input.gateResults, 'Gate results');
  assertOnlyKeys(input.gateResults, ['quality', 'safety', 'calibration'], 'Gate results');
  if (Object.values(input.gateResults).some((value) => typeof value !== 'boolean')) {
    throw new Error('Gate results must be boolean');
  }
  const version = listScorecardVersions(db).find((item) => item.id === input.scorecardVersionId);
  if (!version) throw new Error('Scorecard version not found');
  const featureKeys = new Set(version.features.map((feature) => feature.key));
  if (Object.keys(input.rawFeatures).some((key) => !featureKeys.has(key))
      || version.features.some((feature) => !(feature.key in input.rawFeatures))) {
    throw new Error('Raw features must match the scorecard version');
  }
  for (const [key, value] of Object.entries(input.rawFeatures)) {
    if (value !== null) assertBounded(value, `Raw feature ${key}`);
  }
  const task = db.prepare('SELECT role FROM work_tasks WHERE id = ?').get(input.taskId) as { role: string } | undefined;
  const subjectReason = !task ? 'task-not-found'
    : version.scope.taskRole !== undefined && task.role !== version.scope.taskRole ? 'out-of-scope' : null;
  const unavailableReason = reasonFor(version, input, subjectReason);
  let indexValue: number | null = null;
  if (!unavailableReason) {
    let weighted = 0;
    let weights = 0;
    for (const feature of version.features) {
      const value = input.rawFeatures[feature.key];
      if (value === null) {
        if (version.missingRules[feature.key] === 'neutral') {
          weighted += feature.weight * 0.5;
          weights += feature.weight;
        }
      } else {
        weighted += feature.weight * value;
        weights += feature.weight;
      }
    }
    indexValue = Math.round((weighted / weights) * 10_000) / 100;
  }
  const id = `score-result:${randomUUID()}`;
  db.prepare(`INSERT INTO scorecard_results (
    id, task_id, scorecard_version_id, raw_features_json, gate_results_json,
    coverage, uncertainty, index_value, unavailable_reason, evidence_refs_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, input.taskId, input.scorecardVersionId, JSON.stringify(input.rawFeatures),
    JSON.stringify(input.gateResults), input.coverage, input.uncertainty, indexValue,
    unavailableReason, JSON.stringify(input.evidenceRefs),
  );
  return parseResult(db.prepare(`${RESULT_SELECT} WHERE id = ?`).get(id) as Parameters<typeof parseResult>[0]);
}

export function listScorecardResults(db: Database.Database, taskId?: string): ScorecardResult[] {
  const rows = taskId
    ? db.prepare(`${RESULT_SELECT} WHERE task_id = ? ORDER BY created_at DESC, id DESC`).all(taskId)
    : db.prepare(`${RESULT_SELECT} ORDER BY created_at DESC, id DESC`).all();
  return (rows as Parameters<typeof parseResult>[0][]).map(parseResult);
}
