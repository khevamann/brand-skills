// Telling copy apart from presentation settings.
//
// Craft stores both as plain Strings, so the schema cannot distinguish them, and a
// single value is not enough either: "Intellectual Range" is a heading, "md" is a
// spacing setting, and both are short strings with no markup.
//
// The reliable signal is the distribution across the whole site. A presentation
// field draws from a small fixed set of tokens repeated across many blocks; a copy
// field is different nearly every time it appears.

export const COPY = 'copy';
export const PRESENTATION = 'presentation';

/** Field handles whose names give them away. Used when no corpus is available. */
const PRESENTATION_NAME =
  /(Colou?r|Palette|Padding|Spacing|SpaceBetween|Width|Alignment|Align|Size|Opacity|Height|Position|Theme|Animation|Border|Divider|Columns|Overlay|Style|Orientation|AspectRatio|Ratio|OpenIn|Weight|Type|PerRow|Visibility)$|(^|_)(?:[Ss]how|[Hh]ide|[Ii]s|[Hh]as|[Ee]nable)[A-Z]/;

export function classifyByName(field) {
  const bare = field.includes('_') ? field.slice(field.indexOf('_') + 1) : field;
  return PRESENTATION_NAME.test(bare) || PRESENTATION_NAME.test(field) ? PRESENTATION : COPY;
}

/**
 * Build a `TypeName.field -> kind` map from an exported corpus. Fields seen on at
 * least `minInstances` blocks with few distinct short values are settings.
 */
export function profileFromCorpus(corpus, { minInstances = 4, maxDistinct = 4, maxLength = 28 } = {}) {
  const seen = new Map();

  for (const { blocks } of corpus) {
    for (const block of blocks) {
      const type = block.__typename;
      for (const [field, value] of Object.entries(block)) {
        if (typeof value !== 'string' || field.startsWith('_') || field === '__typename') continue;
        if (!/^[a-zA-Z]+_[A-Za-z]/.test(field)) continue;
        const key = `${type}.${field}`;
        if (!seen.has(key)) seen.set(key, { values: new Set(), count: 0, maxLen: 0 });
        const rec = seen.get(key);
        rec.count += 1;
        if (value) {
          rec.values.add(value);
          rec.maxLen = Math.max(rec.maxLen, value.length);
        }
      }
    }
  }

  const profile = new Map();
  for (const [key, rec] of seen) {
    const field = key.split('.')[1];
    if (rec.count >= minInstances && rec.values.size <= maxDistinct && rec.maxLen <= maxLength) {
      profile.set(key, PRESENTATION);
    } else if (rec.maxLen > maxLength || rec.values.size > maxDistinct) {
      profile.set(key, COPY);
    } else {
      // Too little evidence either way; fall back to the field's name.
      profile.set(key, classifyByName(field));
    }
  }
  return profile;
}

/**
 * Classify one field. The corpus profile is authoritative when it has an opinion,
 * because it reflects how the site actually uses the field.
 */
export function classifyField(typeName, field, profile) {
  const fromProfile = profile?.get(`${typeName}.${field}`);
  if (fromProfile) return fromProfile;
  return classifyByName(field);
}
