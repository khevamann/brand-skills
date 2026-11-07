// The skill's version, recorded in each project's site.yaml so `site setup` can tell
// when a folder was set up by an older version. Kept equal to plugin.json's version
// (a test checks), because the uploaded zip doesn't include plugin.json.
export const VERSION = '0.7.0';

/** What changed in this version, in plain words, for `site setup` to tell the user. */
export const WHATS_NEW = [
  'Settings now live in site.yaml (it replaces site.json).',
  'Setup checks the workspace, the folder and access to the site before anything else.',
  'Setup progress is tracked, so an unfinished setup is picked up next time.',
  'A layout check finds visible problems on phones, tablets and desktops.',
  '"/website feedback" bundles what was learned for the skill author.',
];
