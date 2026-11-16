// The look plan, in one place. Six base values, one accent hue and the two team colours;
// the lighting makes every shade the game needs, so no other colour appears in the code.
// The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#20242e',
  surface: '#2e333d',
  hairline: '#454b58',
  ink: '#ece7db',
  muted: '#9aa0ab',
  accent: '#e8a33d',
  sable: '#5b8dd9',
  rust: '#d96a4f',
  ground: '#3a3230',
};

export function shade(name) {
  return PALETTE[name];
}
