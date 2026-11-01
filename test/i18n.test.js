import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {messages} from '../web/src/translations.js';
import {translate} from '../web/src/i18n.js';

test('first visit defaults to English with no stored language', () => {
  assert.equal(translate('Speel solo'), 'Play solo');
  assert.equal(translate('Maak een kamer'), 'Create a room');
  assert.equal(translate('Klaar voor de start.'), 'Ready to start.');
  assert.equal(translate('Uitnodigingslink'), 'Invite link');
});

test('main sections, legal information, and application errors are translated', () => {
  for (const [dutch, english] of [
    ['Oude games. Samen opnieuw.', 'Old games. Together again.'],
    ['Speelwijze', 'Play mode'],
    ['Jouw ROM', 'Your ROM'],
    ['Savestate downloaden ↓', 'Download save state ↓'],
    ['Licenties en broncode', 'Licenses and source code'],
    ['De ROMs komen niet overeen.', 'The ROMs do not match.'],
    ['Kies een .ips- of .bps-patch.', 'Choose an .ips or .bps patch.']
  ]) assert.equal(messages.get(dutch), english);
});

test('variable player names, systems, and numeric values are kept intact', () => {
  assert.equal(translate('Kies jouw NES-ROM voor Room Rally. De versie, regio en eventuele hack moeten overeenkomen.'),
    'Choose your NES ROM for Room Rally. The version, region, and any hacks must match.');
  assert.equal(translate('Speler 2 heeft de besturing'), 'Player 2 has control');
  assert.equal(translate('CPU-overclock: 300%. Speler 2 krijgt automatisch dezelfde instelling.'),
    'CPU overclock: 300%. Player 2 automatically receives the same setting.');
  assert.equal(translate('  Maak een kamer '), '  Create a room ');
  assert.equal(translate('Room Rally'), 'Room Rally');
});

test('the language switch is loaded on the home and licenses pages', () => {
  for (const page of ['index.html', 'licenses.html']) {
    const html = readFileSync(new URL('../web/' + page, import.meta.url), 'utf8');
    assert.match(html, /src="\.\/src\/i18n\.js"/);
  }
  assert.ok(messages.size > 550, 'the dictionary must cover the main app, dialogs, and errors');
});

test('language selector displays flags only, with accessible language choices', () => {
  const js = readFileSync(new URL('../web/src/i18n.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /language-code/);
  assert.match(js, /data-select-language="en" aria-label="English" title="English">🇬🇧<\/button>/);
  assert.match(js, /data-select-language="nl" aria-label="Nederlands" title="Nederlands">🇳🇱<\/button>/);
  assert.match(css, /\.language-menu button\{display:grid;place-items:center/);
});
