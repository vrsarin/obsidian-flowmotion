import type { Schema } from './types';

export const ID_PATTERN = '^[A-Za-z0-9_.-]{1,64}$';
export const text = (description: string, maxLength = 120): Schema => ({ type: 'string', description, maxLength });
export const idRef = (description: string, ref?: Schema['x-ref']): Schema => ({ type: 'string', description, pattern: ID_PATTERN, 'x-ref': ref });
export const idList = (description: string, ref?: Schema['x-ref']): Schema => ({
  description, anyOf: [{ type: 'array', items: { type: 'string', pattern: ID_PATTERN, 'x-ref': ref } }, { type: 'string', pattern: ID_PATTERN, 'x-ref': ref }],
});

/** Display options shared by diagrams and storyboards (top-level keys). */
export const viewProperties: Record<string, Schema> = {
  controls: { type: 'boolean', description: 'Show the playback control bar from the start.' },
  interactive: { type: 'boolean', description: 'Wait for a button press to play each storyboard beat or event interval.', default: false },
  controlsPosition: { type: 'string', enum: ['top', 'bottom'], description: 'Where the control bar sits.', default: 'top' },
  header: { type: 'boolean', description: 'Storyboards: show the step label above the diagram. Off by default, so the space goes to the diagram.', default: false },
  footer: { type: 'boolean', description: 'Storyboards: show the caption text below the diagram. Off by default, so the space goes to the diagram.', default: false },
  mode: { type: 'string', enum: ['fit', 'normal'], description: '"fit" scales the diagram to the available width.' },
  paper: { type: 'string', description: 'draw.io drawings: sheet behind the drawing, or a colour.' },
  height: { type: 'string', pattern: String.raw`^\d{1,4}(\.\d+)?(px|vh)$`, description: 'Maximum height, e.g. 60vh or 500px.', examples: ['60vh', '500px'] },
  width: { type: 'string', pattern: String.raw`^\d{1,4}(\.\d+)?(px|vw|%)$`, description: 'Maximum width, e.g. 70%, 900px or 80vw. The diagram is centered.', examples: ['70%', '900px'] },
};

export const srcProperty: Schema = {
  type: 'string', pattern: String.raw`\.(flow|ya?ml|json)$`, description: 'Render a diagram stored in a .flow, .yaml or .json file (path relative to this note, or starting with / for the vault root). Only display options may be set next to it.',
  examples: ['./diagram.yaml'],
};
