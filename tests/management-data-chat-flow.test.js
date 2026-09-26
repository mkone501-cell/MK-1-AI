const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Phase 6.5 wires management-data candidate detection into authenticated chat without auto-save', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
  assert.match(source, /let managementDataCandidates = detectManagementDataCandidates\(message\)/);
  assert.match(source, /managementDataCandidates\s*\}/);
  assert.match(source, /url\.pathname === '\/api\/management-data\/confirm'/);
  assert.match(source, /body\.confirmed !== true/);
});

test('Phase 6.5 runs the management-data migration through its repository at startup', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
  assert.match(source, /migrateManagementData\(app\.managementData\)/);
});


test('Phase 6.26 routes daily analysis through deterministic period context', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
  assert.match(source, /managementQuery\.metricType === 'daily_analysis'[\s\S]*managementDataPeriodContext\(entries, managementQuery\.dataDate, managementQuery\.dataDate\)/);
});

test('Phase 6.26 keeps daily summary on the concise summary context', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
  assert.match(source, /: managementDataSummaryContext\(entries\)/);
});


test('Phase 6.31 routes focused period analysis through focused period context', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
  assert.match(source, /managementQuery\.metricType === 'period_analysis'[\s\S]*managementQuery\.analysisFocus[\s\S]*managementDataFocusedPeriodContext/);
});


test('Phase 6.32 routes focused monthly and annual analysis through focused grouped contexts', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
  assert.match(source, /monthly_period_analysis[\s\S]*managementDataFocusedMultiMonthContext/);
  assert.match(source, /monthly_comparison[\s\S]*managementDataFocusedMultiMonthContext/);
  assert.match(source, /annual_period_analysis[\s\S]*managementDataFocusedMultiYearContext/);
  assert.match(source, /annual_comparison[\s\S]*managementDataFocusedMultiYearContext/);
});


test('Phase 6.35 replaces the model reply with deterministic pending-save wording before confirmation', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
  assert.match(source, /if \(managementDataCandidates\.length \|\| managementDataDuplicateCount\) \{/);
  assert.match(source, /answer:managementDataCandidateAcknowledgement\(managementDataCandidates, managementDataDuplicateCount\)/);
  assert.match(source, /conversations\.appendExchange[\s\S]*answer:result\.answer/);
});


test('Phase 6.36 filters exact duplicates before exposing save candidates', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
  assert.match(source, /const existing = await managementData\.findExact\(auth\.ownerEmail, candidate\)/);
  assert.match(source, /isSameManagementDataValue\(existing, candidate\)/);
  assert.match(source, /managementDataDuplicateCount\+\+/);
  assert.match(source, /managementDataCandidates = pendingCandidates/);
});

test('Phase 6.36 rechecks for an exact duplicate inside the confirmed-save endpoint', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
  assert.match(source, /const existing = await managementData\.findExact\(auth\.ownerEmail, candidate\);[\s\S]*duplicate:true/);
  assert.match(source, /if \(isSameManagementDataValue\(existing, candidate\)\)/);
});


test('Phase 6.37 converts a changed current value into an explicit update candidate', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
  assert.match(source, /operation:'update'/);
  assert.match(source, /existingEntryId:existing\.id/);
  assert.match(source, /previousAmount:Number\(existing\.amount\)/);
  assert.match(source, /pendingCandidates\.push\(\{ \.\.\.candidate, operation:'create' \}\)/);
});

test('Phase 6.37 never updates unless the owner confirms the exact prior value', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
  assert.match(source, /requestedOperation = body\.operation === 'update' \? 'update' : 'create'/);
  assert.match(source, /\/\^\\d\+\$\/\.test\(expectedEntryId\)/);
  assert.match(source, /String\(existing\.id\) !== expectedEntryId/);
  assert.match(source, /Number\(existing\.amount\) !== expectedPreviousAmount/);
  assert.match(source, /MANAGEMENT_DATA_UPDATE_STALE/);
  assert.match(source, /await managementData\.update\(auth\.ownerEmail, existing\.id/);
  assert.match(source, /updated:true/);
});

test('Phase 6.37 repository performs an in-place update instead of inserting another row', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/management-data/postgres-management-data-repository.js'), 'utf8');
  assert.match(source, /async update\(ownerEmail, id, input\)/);
  assert.match(source, /UPDATE management_data/);
  assert.match(source, /WHERE id = \$1 AND owner_email = \$2/);
  assert.match(source, /updated_at = NOW\(\)/);
});

test('Phase 6.37 UI shows current and new values and sends update revision fields', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.match(source, /現在登録されている値/);
  assert.match(source, /新しい値/);
  assert.match(source, /確認して更新/);
  assert.match(source, /existingEntryId:item\.existingEntryId \|\| null/);
  assert.match(source, /previousAmount:item\.previousAmount \?\? null/);
  assert.match(source, /result\.updated \? '確認した経営数値を更新しました。'/);
});


test('Phase 6.37 fix uses BIGSERIAL ids for management-data stale checks rather than conversation UUID rules', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
  assert.match(source, /const expectedEntryId = String\(body\.existingEntryId \?\? ''\)\.trim\(\)/);
  assert.match(source, /\/\^\\d\+\$\/\.test\(expectedEntryId\)/);
  assert.doesNotMatch(source, /UUID\.test\(expectedEntryId\)/);
});
