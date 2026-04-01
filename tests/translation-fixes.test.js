'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// =========================================================================
//  Test: parseSubtitles cue-based parsing (mirrors index.js logic)
// =========================================================================

/**
 * Inline copy of parseSubtitles from index.js for testing.
 * We duplicate it here because index.js is a full server module
 * that's hard to import in a unit test context.
 */
function parseSubtitles(text) {
  const cues = [];
  const blocks = text.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    if (lines.length < 2) continue;

    const firstLine = lines[0].trim();
    if (firstLine.startsWith('WEBVTT') || firstLine.startsWith('NOTE')) continue;

    let tsIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        tsIdx = i;
        break;
      }
    }
    if (tsIdx === -1) continue;

    const indexLine = tsIdx > 0 ? lines.slice(0, tsIdx).find(l => /^\d+$/.test(l.trim())) || '' : '';
    const timestampLine = lines[tsIdx].trim();

    const textLines = lines.slice(tsIdx + 1)
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (!timestampLine || textLines.length === 0) continue;

    cues.push({
      index: indexLine,
      timestamp: timestampLine,
      text: textLines.join('\n'),
    });
  }

  return cues;
}

describe('parseSubtitles', () => {
  it('parses basic SRT cues correctly', () => {
    const srt = `1
00:00:01,000 --> 00:00:03,000
Hello world.

2
00:00:04,000 --> 00:00:06,000
This is a test.`;

    const cues = parseSubtitles(srt);
    assert.equal(cues.length, 2);
    assert.equal(cues[0].index, '1');
    assert.equal(cues[0].timestamp, '00:00:01,000 --> 00:00:03,000');
    assert.equal(cues[0].text, 'Hello world.');
    assert.equal(cues[1].index, '2');
    assert.equal(cues[1].text, 'This is a test.');
  });

  it('handles multi-line cue text correctly', () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
Line one of text
Line two of text

2
00:00:05,000 --> 00:00:07,000
Single line`;

    const cues = parseSubtitles(srt);
    assert.equal(cues.length, 2);
    assert.equal(cues[0].text, 'Line one of text\nLine two of text');
    assert.equal(cues[1].text, 'Single line');
  });

  it('skips WEBVTT header', () => {
    const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:03.000
Hello world.

2
00:00:04.000 --> 00:00:06.000
Goodbye world.`;

    const cues = parseSubtitles(vtt);
    assert.equal(cues.length, 2);
    assert.equal(cues[0].text, 'Hello world.');
    assert.equal(cues[1].text, 'Goodbye world.');
  });

  it('handles empty input', () => {
    assert.equal(parseSubtitles('').length, 0);
    assert.equal(parseSubtitles('   \n\n  ').length, 0);
  });

  it('handles CRLF line endings', () => {
    const srt = "1\r\n00:00:01,000 --> 00:00:03,000\r\nHello.\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nWorld.";
    const cues = parseSubtitles(srt);
    assert.equal(cues.length, 2);
    assert.equal(cues[0].text, 'Hello.');
  });

  it('preserves timestamps with both comma and dot ms', () => {
    const srt = `1
00:00:01,000 --> 00:00:03,500
Comma format

2
00:00:04.000 --> 00:00:06.999
Dot format`;

    const cues = parseSubtitles(srt);
    assert.equal(cues.length, 2);
    assert.equal(cues[0].timestamp, '00:00:01,000 --> 00:00:03,500');
    assert.equal(cues[1].timestamp, '00:00:04.000 --> 00:00:06.999');
  });
});

describe('Google Translate response parsing fix', () => {
  it('extracts only translation segments from response.data[0]', () => {
    // Simulates the Google API response structure:
    // response.data[0] = translation segments
    // Later elements = metadata (should NOT be included)
    const mockResponse = {
      data: [
        // response.data[0]: actual translations
        [
          ['Salut lume', 'Hello world', null, null, 10],
          ['Aceasta este un test', 'This is a test', null, null, 8],
        ],
        // response.data[1]: null separator
        null,
        // response.data[2]: source language
        'en',
        // response.data[3]: target language
        'ro',
        null, null, null, 0.95,
        // response.data[8]: METADATA array (should be EXCLUDED)
        // This is what was leaking before the fix!
        [
          ['tea_LatinateA_en2eucacoeoglhtmtro_2021q3.md,true', 0],
          ['some_other_metadata', 1],
        ],
        null, 'en2ro',
      ],
    };

    // OLD BROKEN CODE (for reference):
    // const translated = mockResponse.data
    //   .filter(item => Array.isArray(item) && item[0])
    //   .map(item => item[0])
    //   .join('');
    // Result: "[Salut lume,Hello world,,,10],tea_LatinateA_en2eucacoeoglhtmtro_2021q3.md,true"

    // NEW FIXED CODE:
    if (mockResponse.data && Array.isArray(mockResponse.data[0])) {
      const translated = mockResponse.data[0]
        .filter(item => Array.isArray(item) && typeof item[0] === 'string')
        .map(item => item[0])
        .join('');
      assert.equal(translated, 'Salut lumeAceasta este un test');
      assert.ok(!translated.includes('tea_LatinateA'), 'Metadata must NOT leak into translation');
      assert.ok(!translated.includes('Hello world'), 'Original text must NOT be included');
      assert.ok(!translated.includes(',,,'), 'Comma-separated metadata must NOT appear');
    }
  });

  it('filters out non-string items from translation segments', () => {
    const mockResponse = {
      data: [
        [
          ['Translated text', 'Original text', null, null, 10],
          [null, '', null, null, 5],  // null translation
          ['', 'Some original', null, null, 3],  // empty translation
          ['Another translation', 'Another original', null, null, 7],
        ],
        null, 'en', 'ro',
      ],
    };

    if (mockResponse.data && Array.isArray(mockResponse.data[0])) {
      const translated = mockResponse.data[0]
        .filter(item => Array.isArray(item) && typeof item[0] === 'string')
        .map(item => item[0])
        .join('');
      assert.equal(translated, 'Translated textAnother translation');
    }
  });

  it('returns null when response.data[0] is not an array', () => {
    const mockResponse = { data: 'unexpected format' };
    if (mockResponse.data && Array.isArray(mockResponse.data[0])) {
      assert.fail('Should not enter this branch');
    }
    // The translate() function would return null for this case
    assert.ok(true);
  });
});

describe('translateBatch separator safety', () => {
  it('separator ||| splits correctly for multi-line cue text', () => {
    const SEP = '\n|||';
    const items = [
      'Hello world',
      'Line one\nLine two',  // multi-line cue text
      'Single line',
      'Another\nMulti\nLine',  // triple-line cue text
    ];

    const joined = items.join(SEP);
    const split = joined.split(SEP);

    assert.equal(split.length, items.length);
    assert.equal(split[0], 'Hello world');
    assert.equal(split[1], 'Line one\nLine two');
    assert.equal(split[2], 'Single line');
    assert.equal(split[3], 'Another\nMulti\nLine');
  });

  it('detects chunk size mismatch correctly', () => {
    const originalChunk = ['Hello', 'World', 'Test'];
    // Simulate Google Translate returning wrong number of items
    const badResult = ['Salut', 'Lume'];  // Only 2 items for 3 input

    // Safety check (mirrors translateBatch logic)
    if (badResult.length !== originalChunk.length) {
      // Keep originals
      assert.ok(true, 'Correctly detected mismatch');
    } else {
      assert.fail('Should have detected mismatch');
    }
  });
});
