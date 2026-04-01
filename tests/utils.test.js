'use strict';

const { parseId } = require('../src/utils/imdb');
const { validateUrl, isPrivateIp } = require('../src/utils/url-validator');
const { toProviderCode, fromProviderCode, getSupportedLanguages } = require('../src/config/languages');
const { isArchive, looksLikeSubtitle } = require('../src/utils/zip');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ============================================================
// IMDB ID Parser
// ============================================================
describe('parseId', () => {
  it('parses a movie ID correctly', () => {
    const result = parseId('tt0111161');
    assert.equal(result.imdbIdFull, 'tt0111161');
    assert.equal(result.imdbId, '0111161');
    assert.equal(result.season, null);
    assert.equal(result.episode, null);
  });

  it('parses a series ID with season and episode', () => {
    const result = parseId('tt0903747:1:1');
    assert.equal(result.imdbIdFull, 'tt0903747');
    assert.equal(result.season, 1);
    assert.equal(result.episode, 1);
  });

  it('parses a series ID with multi-digit season/episode', () => {
    const result = parseId('tt0903747:12:5');
    assert.equal(result.season, 12);
    assert.equal(result.episode, 5);
  });

  it('throws on invalid ID format', () => {
    assert.throws(() => parseId('invalid'));
    assert.throws(() => parseId(''));
    assert.throws(() => parseId('0111161')); // missing tt prefix
  });
});

// ============================================================
// URL Validator - isPrivateIp
// ============================================================
describe('isPrivateIp', () => {
  it('detects 10.x.x.x as private', () => {
    assert.equal(isPrivateIp('10.0.0.1'), true);
  });

  it('detects 192.168.x.x as private', () => {
    assert.equal(isPrivateIp('192.168.1.1'), true);
  });

  it('detects 127.x.x.x as private', () => {
    assert.equal(isPrivateIp('127.0.0.1'), true);
  });

  it('detects 172.16.x.x as private', () => {
    assert.equal(isPrivateIp('172.16.0.1'), true);
  });

  it('detects 172.31.x.x as private', () => {
    assert.equal(isPrivateIp('172.31.255.255'), true);
  });

  it('rejects 172.15.x.x as NOT private', () => {
    assert.equal(isPrivateIp('172.15.0.1'), false);
  });

  it('rejects 172.32.x.x as NOT private', () => {
    assert.equal(isPrivateIp('172.32.0.1'), false);
  });

  it('rejects public IPs', () => {
    assert.equal(isPrivateIp('8.8.8.8'), false);
    assert.equal(isPrivateIp('1.1.1.1'), false);
  });

  it('detects 169.254.x.x as link-local (private)', () => {
    assert.equal(isPrivateIp('169.254.1.1'), true);
  });
});

// ============================================================
// URL Validator - validateUrl
// ============================================================
describe('validateUrl', () => {
  it('rejects non-HTTPS URLs', async () => {
    const result = await validateUrl('http://dl.subdl.com/file.srt');
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('HTTPS'));
  });

  it('rejects domains not in allowlist', async () => {
    const result = await validateUrl('https://evil.com/subtitle.srt');
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('not allowed'));
  });

  it('accepts allowlisted HTTPS domain', async () => {
    const result = await validateUrl('https://dl.subdl.com/file.srt');
    assert.equal(result.valid, true);
  });

  it('rejects invalid URL format', async () => {
    const result = await validateUrl('not-a-url');
    assert.equal(result.valid, false);
  });

  it('accepts OpenSubtitles download domain', async () => {
    const result = await validateUrl('https://www.opensubtitles.com/file.srt');
    assert.equal(result.valid, true);
  });

  it('rejects paths with protocol scheme in host', async () => {
    const result = await validateUrl('https://dl.subdl.com.evil.com/file.srt');
    assert.equal(result.valid, false);
  });
});

// ============================================================
// Language Code Mapping
// ============================================================
describe('toProviderCode', () => {
  it('maps eng to opensubtitles code', () => {
    assert.equal(toProviderCode('eng', 'opensubtitles'), 'en');
  });

  it('maps eng to subdl code', () => {
    assert.equal(toProviderCode('eng', 'subdl'), 'EN');
  });

  it('maps eng to subsource code', () => {
    assert.equal(toProviderCode('eng', 'subsource'), 'english');
  });

  it('supports both ron and rum for Romanian', () => {
    assert.equal(toProviderCode('ron', 'opensubtitles'), 'ro');
    assert.equal(toProviderCode('rum', 'opensubtitles'), 'ro');
  });

  it('returns null for unsupported language', () => {
    assert.equal(toProviderCode('xyz', 'opensubtitles'), null);
  });

  it('returns falsy for unsupported provider', () => {
    assert.ok(!toProviderCode('eng', 'nonexistent'));
  });
});

describe('fromProviderCode', () => {
  it('reverse-maps opensubtitles en to eng', () => {
    assert.equal(fromProviderCode('en', 'opensubtitles'), 'eng');
  });

  it('reverse-maps subdl RO to ron (first match)', () => {
    assert.ok(['ron', 'rum'].includes(fromProviderCode('RO', 'subdl')));
  });

  it('is case-insensitive', () => {
    assert.equal(fromProviderCode('EN', 'opensubtitles'), 'eng');
    assert.equal(fromProviderCode('en', 'opensubtitles'), 'eng');
    assert.equal(fromProviderCode('En', 'opensubtitles'), 'eng');
  });

  it('returns null for unknown code', () => {
    assert.equal(fromProviderCode('xyz', 'opensubtitles'), null);
  });

  it('returns null for empty string', () => {
    assert.equal(fromProviderCode('', 'opensubtitles'), null);
    assert.equal(fromProviderCode(null, 'opensubtitles'), null);
  });
});

describe('getSupportedLanguages', () => {
  it('returns a non-empty array', () => {
    const langs = getSupportedLanguages();
    assert.ok(Array.isArray(langs));
    assert.ok(langs.length > 0);
  });

  it('includes eng', () => {
    const langs = getSupportedLanguages();
    assert.ok(langs.includes('eng'));
  });

  it('does not duplicate ron/rum', () => {
    const langs = getSupportedLanguages();
    const ronCount = langs.filter(l => l.startsWith('ron')).length;
    assert.equal(ronCount, 1);
  });
});

// ============================================================
// Archive Detection
// ============================================================
describe('isArchive', () => {
  it('detects ZIP by magic bytes', () => {
    const buf = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00]);
    assert.equal(isArchive(buf), 'zip');
  });

  it('detects RAR by magic bytes', () => {
    const buf = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x00, 0x00]);
    assert.equal(isArchive(buf), 'rar');
  });

  it('returns null for non-archive', () => {
    const buf = Buffer.from('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello');
    assert.equal(isArchive(buf), null);
  });

  it('returns null for empty buffer', () => {
    assert.equal(isArchive(Buffer.alloc(0)), null);
  });

  it('returns null for too-small buffer', () => {
    assert.equal(isArchive(Buffer.from([0x50, 0x4B])), null);
  });
});
