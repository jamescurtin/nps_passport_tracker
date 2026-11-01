// Inline SVG icons as template strings. Each icon is hand-drawn on a 24x24
// grid in the Lucide/Feather outline style and uses `currentColor`, so it
// follows the surrounding text color (and the dark theme).

/**
 * Wrap path markup in the shared icon `<svg>` element.
 * @param {string} inner - SVG child markup
 * @return {string} Complete `<svg>` string
 */
const svg = (inner) =>
  `<svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;

export const close = svg(`<path d="M6 6l12 12M18 6L6 18"/>`);

export const search = svg(
  `<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>`,
);

export const chart = svg(`<path d="M5 20V11M12 20V4M19 20v-6"/>`);

export const list = svg(
  `<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>`,
);

export const pin = svg(
  `<path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>`,
);

export const locate = svg(
  `<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/>`,
);

export const chevron = svg(`<path d="M9 6l6 6-6 6"/>`);
