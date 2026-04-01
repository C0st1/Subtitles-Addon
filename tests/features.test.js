'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

// ============================================================
// Encryption
// ============================================================
const { encrypt, decrypt, encryptConfig, decryptConfig, isEncryptionEnabled } = require('../src/utils/encryption');

describe('encryption', () => {
  it('is disabled by default (no ENC_SECRET env)', () => {
    assert.equal(isEncryptionEnabled(), false);
  });

  it('passthrough when encryption disabled', () => {
    assert.equal(encrypt('hello'), 'hello');
    assert.equal(decrypt('hello'), 'hello');
  });

  it('encryptConfig passthrough when disabled', () => {
    const cfg = { api_key: 'abc123' };
    const result = encryptConfig(cfg);
    assert.equal(result.api_key, 'abc123');
  });

  it('decryptConfig passthrough when disabled', () => {
    const cfg = { api_key: '__enc__:abc123' };
    const result = decryptConfig(cfg);
    assert.equal(result.api_key, '__enc__:abc123');
  });
});

// ============================================================
// Translation utils
// ============================================================
const { translateBatch } = require('../src/utils/translation');

describe('translation', () => {
  it('translateBatch returns same lines when no translation needed (same lang)', async () => {
    const lines = ['Hello', 'World', 'Test'];
    const result = await translateBatch(lines, 'eng', 'eng');
    assert.deepEqual(result, lines);
  });

  it('translateBatch handles empty array', async () => {
    const result = await translateBatch([], 'eng', 'ron');
    assert.deepEqual(result, []);
  });

  it('translateBatch handles null input', async () => {
    const result = await translateBatch(null, 'eng', 'ron');
    assert.deepEqual(result, null);
  });
});

// ============================================================
// Subtitle handler
// ============================================================
const subtitlesHandler = require('../src/handlers/subtitles');

describe('subtitles handler', () => {
  it('returns empty subtitles for missing config', async () => {
    const result = await subtitlesHandler({ type: 'movie', id: 'tt1234567', config: null });
    assert.deepEqual(result.subtitles, []);
  });

  it('returns empty subtitles for invalid languages', async () => {
    const result = await subtitlesHandler({
      type: 'movie', id: 'tt1234567',
      config: { languages: 'xyz,abc', enabled_sources: 'opensubtitles', addon_host: 'localhost' }
    });
    assert.deepEqual(result.subtitles, []);
  });

  it('respects prefetch mode (returns empty)', async () => {
    const result = await subtitlesHandler({
      type: 'movie', id: 'tt1234567',
      config: { languages: 'eng', enabled_sources: 'opensubtitles,subdl,subsource', addon_host: 'localhost' },
      extra: { prefetch: true }
    });
    assert.deepEqual(result.subtitles, []);
  });

  it('getFailoverState returns an object', () => {
    const state = subtitlesHandler.getFailoverState();
    assert.equal(typeof state, 'object');
  });
});

// ============================================================
// Manifest
// ============================================================
const manifest = require('../src/manifest');

describe('manifest v1.3.0', () => {
  it('has all 7 new config fields', () => {
    const keys = manifest.config.map(c => c.key);
    assert.ok(keys.includes('hi_filter'));
    assert.ok(keys.includes('release_matching'));
    assert.ok(keys.includes('mt_fallback'));
    assert.ok(keys.includes('provider_priority'));
    assert.ok(keys.includes('addic7ed_username'));
    assert.ok(keys.includes('addic7ed_password'));
    assert.ok(keys.includes('profile_name'));
  });

  it('has correct version', () => {
    assert.equal(manifest.version, '1.3.0');
  });

  it('is configurable', () => {
    assert.equal(manifest.behaviorHints.configurable, true);
    assert.equal(manifest.behaviorHints.configurationRequired, true);
  });
});

// ============================================================
// Presets
// ============================================================
const presets = require('../src/presets.json');

describe('presets.json', () => {
  it('has 8 presets', () => {
    assert.equal(presets.length, 8);
  });

  it('each preset has required fields', () => {
    for (const p of presets) {
      assert.ok(p.id, 'missing id');
      assert.ok(p.name, 'missing name');
      assert.ok(p.config, 'missing config');
      assert.ok(p.config.languages, 'missing languages');
      assert.ok(p.config.enabled_sources, 'missing enabled_sources');
    }
  });

  it('all preset IDs are unique', () => {
    const ids = presets.map(p => p.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

// ============================================================
// i18n files
// ============================================================
const i18nLangs = ['en', 'ro', 'fr', 'es', 'de', 'ar'];

describe('i18n files', () => {
  for (const lang of i18nLangs) {
    it(lang + ': loads valid JSON with all required keys', () => {
      const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/i18n/' + lang + '.json'), 'utf8'));
      const required = [
        'title', 'subtitle', 'next', 'back', 'generate',
        'hi_toggle', 'mt_fallback', 'release_matching',
        'providers_label', 'languages_label', 'advanced_label',
        'profile_save', 'import_btn', 'export_btn',
        'presets_label', 'feedback_label'
      ];
      for (const key of required) {
        assert.ok(data[key], 'missing key: ' + key);
        assert.ok(data[key].length > 0, 'empty key: ' + key);
      }
    });
  }

  it('all languages have the same key count', () => {
    const counts = i18nLangs.map(l => {
      const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/i18n/' + l + '.json'), 'utf8'));
      return Object.keys(data).length;
    });
    assert.ok(counts.every(c => c === counts[0]), 'key counts differ: ' + counts.join(', '));
  });
});

// ============================================================
// Server bootstrap smoke test
// ============================================================
describe('server bootstrap', () => {
  it('index.js requires resolve without crashing', () => {
    // Verify all module dependencies can be resolved
    assert.doesNotThrow(() => {
      require('express');
      require('cors');
      require('helmet');
      require('stremio-addon-sdk');
      require('../src/manifest');
      require('../src/addon');
      require('../src/handlers/subtitles');
      require('../src/utils/encryption');
      require('../src/utils/translation');
      require('../src/utils/imdb');
      require('../src/utils/logger');
      require('../src/utils/http');
      require('../src/utils/url-validator');
      require('../src/utils/converter');
      require('../src/utils/zip');
      require('../src/providers/opensubtitles');
      require('../src/providers/subdl');
      require('../src/providers/subsource');
      require('../src/providers/addic7ed');
      require('../src/config/languages');
      require('../src/routes/subtitle-proxy');
    });
  });
});
