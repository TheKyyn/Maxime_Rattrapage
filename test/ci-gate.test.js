'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('démonstration contrôlée du blocage CI sur échec de test', () => {
  assert.notEqual(process.env.UE03_DEMO_FAIL, '1', 'Échec demandé pour la démonstration du pipeline');
});
