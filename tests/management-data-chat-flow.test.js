const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Phase 6.5 wires management-data candidate detection into authenticated chat without auto-save', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
  assert.match(source, /const managementDataCandidates = detectManagementDataCandidates\(message\)/);
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
  assert.match(source, /if \(managementDataCandidates\.length\) \{/);
  assert.match(source, /answer:managementDataCandidateAcknowledgement\(managementDataCandidates\)/);
  assert.match(source, /conversations\.appendExchange[\s\S]*answer:result\.answer/);
});
