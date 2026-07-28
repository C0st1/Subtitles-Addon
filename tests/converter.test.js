'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { decodeSrt, srtToVtt, stripAssOverrideTags } = require('../src/utils/converter');

// ============================================================
// stripAssOverrideTags
// ============================================================
describe('stripAssOverrideTags', () => {
  it('removes the {\\an8} alignment tag (the bug from the screenshot)', () => {
    const input = '{\\an8} Săptămâna de nastere fericita !';
    const out = stripAssOverrideTags(input);
    assert.equal(out, 'Săptămâna de nastere fericita !');
  });

  it('removes alignment tags for all 9 numpad positions', () => {
    for (let n = 1; n <= 9; n++) {
      const input = `{\\an${n}}Hello world`;
      assert.equal(stripAssOverrideTags(input), 'Hello world');
    }
  });

  it('removes positioning, fade, italic and bold override blocks', () => {
    const cases = [
      ['{\\pos(320,50)}Top text', 'Top text'],
      ['{\\fad(200,100)}Fade in/out', 'Fade in/out'],
      ['{\\i1}italic{\\i0}', 'italic'],
      ['{\\b1}bold{\\b0}', 'bold'],
      ['{\\c&H00FFFFFF&}colored text', 'colored text'],
    ];
    for (const [input, expected] of cases) {
      assert.equal(stripAssOverrideTags(input), expected);
    }
  });

  it('removes multiple consecutive override blocks in a single line', () => {
    const input = '{\\an8}{\\i1}Hello{\\i0} {\\b1}world{\\b0}';
    assert.equal(stripAssOverrideTags(input), 'Hello world');
  });

  it('preserves the leading space between stripped tags only when meaningful', () => {
    // "{\an8} Hello" -> "Hello" (leading space removed by per-line trim)
    assert.equal(stripAssOverrideTags('{\\an8} Hello'), 'Hello');
  });

  it('converts ASS hard line breaks (\\N and \\n) to real newlines', () => {
    assert.equal(stripAssOverrideTags('Line 1\\NLine 2'), 'Line 1\nLine 2');
    assert.equal(stripAssOverrideTags('Line 1\\nLine 2'), 'Line 1\nLine 2');
  });

  it('is a no-op on already-clean text', () => {
    const input = 'Hello world\nSecond line';
    assert.equal(stripAssOverrideTags(input), input);
  });

  it('returns falsy input unchanged', () => {
    assert.equal(stripAssOverrideTags(''), '');
    assert.equal(stripAssOverrideTags(null), null);
    assert.equal(stripAssOverrideTags(undefined), undefined);
  });

  it('trims trailing whitespace left on each line', () => {
    const input = 'Hello   \n   World   ';
    assert.equal(stripAssOverrideTags(input), 'Hello\nWorld');
  });

  it('handles a realistic multi-line SRT cue with embedded tags', () => {
    const input = '{\\an8}First line\nSecond {\\i1}italic{\\i0} line';
    assert.equal(stripAssOverrideTags(input), 'First line\nSecond italic line');
  });
});

// ============================================================
// srtToVtt - integration with tag stripping
// ============================================================
describe('srtToVtt strips ASS override tags from SRT input', () => {
  it('removes {\\an8} from an SRT cue and produces valid VTT', () => {
    const srt = [
      '1',
      '00:00:01,000 --> 00:00:04,000',
      '{\\an8} Săptămâna de nastere fericita !',
      '',
      '2',
      '00:00:05,000 --> 00:00:07,000',
      'Plain text without tags',
      ''
    ].join('\n');

    const vtt = srtToVtt(Buffer.from(srt, 'utf8'), 'ron');

    // VTT header present
    assert.ok(vtt.startsWith('WEBVTT\n\n'));

    // The {\\an8} tag must NOT appear anywhere in the output
    assert.ok(!vtt.includes('{\\an8}'), `expected no {\\an8} in output, got: ${vtt}`);
    assert.ok(!/\{[^}]*\}/.test(vtt), `expected no override blocks in output, got: ${vtt}`);

    // The actual cue text is preserved
    assert.ok(vtt.includes('Săptămâna de nastere fericica !') || vtt.includes('Săptămâna de nastere fericita !'));
    assert.ok(vtt.includes('Plain text without tags'));

    // VTT timestamp format uses dots (.) instead of commas (,) for ms separator
    assert.ok(vtt.includes('00:00:01.000 --> 00:00:04.000'));
  });

  it('strips override tags from VTT input too', () => {
    const vttInput = [
      'WEBVTT',
      '',
      'NOTE test',
      '',
      '00:00:01.000 --> 00:00:04.000',
      '{\\an8}Top aligned text',
      ''
    ].join('\n');

    const out = srtToVtt(Buffer.from(vttInput, 'utf8'), 'eng');
    assert.ok(!out.includes('{\\an8}'));
    assert.ok(out.includes('Top aligned text'));
  });

  it('still strips tags when converting ASS input (no regression)', () => {
    const ass = [
      '[Script Info]',
      'Title: test',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize',
      'Style: Default,Arial,20',
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,{\\an8}Hello from ASS',
      ''
    ].join('\n');

    const vtt = srtToVtt(Buffer.from(ass, 'utf8'), 'eng');
    assert.ok(vtt.startsWith('WEBVTT\n\n'));
    assert.ok(!vtt.includes('{\\an8}'));
    assert.ok(vtt.includes('Hello from ASS'));
  });

  it('does not break clean SRT input', () => {
    const srt = [
      '1',
      '00:00:01,000 --> 00:00:03,500',
      'Just a normal subtitle',
      ''
    ].join('\n');

    const vtt = srtToVtt(Buffer.from(srt, 'utf8'), 'eng');
    assert.ok(vtt.startsWith('WEBVTT\n\n'));
    assert.ok(vtt.includes('00:00:01.000 --> 00:00:03.500'));
    assert.ok(vtt.includes('Just a normal subtitle'));
  });
});
