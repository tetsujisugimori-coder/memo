'use strict';
module.exports = outcome => outcome.reason || (outcome.spawnError ? 'spawn_failure' : outcome.code === 0 ? 'passed' : 'test_or_diagnostic_failure');
