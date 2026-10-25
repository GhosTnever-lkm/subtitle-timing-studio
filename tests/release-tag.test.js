import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReleaseTag } from '../scripts/validate-release-tag.mjs';

test('accepts only the release tag matching both shipped versions', () => {
  assert.doesNotThrow(() => validateReleaseTag('v1.0.7', '1.0.7', '1.0.7'));
});

test('rejects a tag for a different version', () => {
  assert.throws(() => validateReleaseTag('v1.0.8', '1.0.7', '1.0.7'), /does not match shipped version/);
});

test('rejects package metadata drift', () => {
  assert.throws(() => validateReleaseTag('v1.0.7', '1.0.7', '1.0.6'), /must match package.json/);
});

test('rejects missing or malformed tags', () => {
  assert.throws(() => validateReleaseTag(undefined, '1.0.7', '1.0.7'), /must use vMAJOR/);
  assert.throws(() => validateReleaseTag('1.0.7', '1.0.7', '1.0.7'), /must use vMAJOR/);
  assert.throws(() => validateReleaseTag('v1.0', '1.0.7', '1.0.7'), /must use vMAJOR/);
});
