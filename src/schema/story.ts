import { TONES } from '../story/types';
import { LINES } from '../core/types';
import { srcProperty, text, viewProperties } from './common';
import type { Schema } from './types';

const sid = (d: string, ref: Schema['x-ref'] = 'element'): Schema => ({ type: 'string', description: d, pattern: '^[A-Za-z0-9_.>-]{1,64}$', 'x-ref': ref });
const t500 = (d: string) => text(d, 500);

const row: Schema = {
  type: 'object', additionalProperties: false, description: 'A line inside a card (or a small graph with type: graph).',
  properties: {
    type: { type: 'string', enum: ['row', 'graph'] },
    tone: { type: 'string', enum: [...TONES], default: 'gray' },
    tag: t500('Small label on the left.'), text: t500('Main text.'), meta: t500('Secondary text.'), mark: t500('Marker on the right.'),
    mono: { type: 'boolean', description: 'Use a monospace font.' },
    nodes: { type: 'array', items: { type: 'string' }, maxItems: 12, description: 'graph: node names.' },
    links: { type: 'array', items: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 }, description: 'graph: [from, to] pairs.' },
    lit: { type: 'array', items: { type: 'string' }, description: 'graph: highlighted nodes.' },
  },
};

const edgeObj: Schema = { type: 'object', required: ['edge'], additionalProperties: false, properties: { edge: sid('Arrow id.'), data: t500('Packet label.'), back: { type: 'boolean', description: 'Animate from end to start.' } } };

const visibility: Record<string, Schema> = {
  visible: { type: 'boolean', description: 'Show this element.' },
  opacity: { type: 'number', minimum: 0, maximum: 1, description: 'Element opacity.' },
};
const color = (description: string): Schema => ({ type: 'string', description });
const nodePresentation: Schema = { type: 'object', additionalProperties: false, properties: {
  ...visibility, fill: color('Fill color.'), stroke: color('Outline color.'),
  highlight: { type: 'boolean', description: 'Allow beat highlighting.' },
} };
const groupPresentation: Schema = { type: 'object', additionalProperties: false, properties: {
  ...visibility, fill: color('Fill color.'), stroke: color('Outline color.'),
} };
const arrowPresentation: Schema = { type: 'object', additionalProperties: false, properties: {
  ...visibility, color: color('Connector and arrowhead color.'),
  arrowheads: { type: 'string', enum: ['start', 'end', 'both', 'none'] },
  packet: { type: 'boolean', description: 'Show moving packets independently of the connector.' },
  highlight: { type: 'boolean', description: 'Allow active connector highlighting.' },
} };
const presentation: Schema = { type: 'object', additionalProperties: false, properties: {
  defaults: { type: 'object', additionalProperties: false, properties: {
    nodes: nodePresentation, groups: groupPresentation, arrows: arrowPresentation,
  } },
  nodes: { type: 'object', additionalProperties: nodePresentation },
  groups: { type: 'object', additionalProperties: groupPresentation },
  arrows: { type: 'object', additionalProperties: arrowPresentation },
} };

export const storySchema: Schema & { $schema?: string; title?: string } = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'FlowMotion storyboard',
  type: 'object',
  required: ['elements', 'scenes'],
  additionalProperties: false,
  properties: {
    title: t500('Storyboard title.'),
    speed: { type: 'number', minimum: 300, maximum: 20000, default: 2200, description: 'Default beat length in ms.' },
    elements: {
      type: 'array', maxItems: 300, description: 'Cards, groups and arrows. Exactly one top-level (ungrouped) card or group.',
      items: {
        type: 'object', required: ['id', 'type'], additionalProperties: false,
        properties: {
          id: sid('Unique element id.'),
          type: { type: 'string', enum: ['rectangle', 'cylinder', 'group', 'arrow'] },
          content: {
            type: 'array', description: 'Cards: a title and optional subtitle.',
            items: { type: 'object', required: ['type'], additionalProperties: false, properties: { type: { type: 'string', enum: ['title', 'subtitle'] }, text: t500('Text.') } },
          },
          width: { type: 'number', minimum: 0, maximum: 2000 }, minCardHeight: { type: 'number', minimum: 0, maximum: 2000 },
          label: { type: 'object', additionalProperties: false, description: 'group: {title}; arrow: {text}.', properties: { title: t500('Group heading.'), text: t500('Arrow label.') } },
          children: { type: 'array', items: sid('Child element id.'), description: 'group: ids of cards or groups inside.' },
          layout: {
            type: 'object', additionalProperties: false, description: 'group layout.',
            properties: {
              direction: { type: 'string', enum: ['row', 'column'], default: 'column' },
              gap: { type: 'number', minimum: 0, maximum: 400, default: 12 },
              align: { type: 'string', enum: ['stretch', 'center', 'start'], default: 'stretch' },
            },
          },
          start: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: sid('Element the arrow starts at.') } },
          end: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: sid('Element the arrow ends at.') } },
          quiet: { type: 'boolean', description: 'arrow: draw faintly.' },
          line: { type: 'string', enum: [...LINES], description: 'arrow: connector line style.' },
          route: { type: 'string', description: 'Accepted for compatibility; currently ignored.' },
        },
      },
    },
    scenes: {
      type: 'array', minItems: 1, description: 'Chapters of the story; each has beats.',
      items: {
        type: 'object', required: ['beats'], additionalProperties: false,
        properties: {
          label: t500('Scene name.'),
          caption: t500('Accepted for compatibility; currently ignored.'),
          presentation,
          beats: {
            type: 'array', minItems: 1, description: 'Steps shown one after another.',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                say: t500('Caption for this beat.'),
                ms: { type: 'number', minimum: 200, maximum: 60000, description: 'Beat length override in ms.' },
                edges: {
                  description: 'Arrows to animate (ids, or {edge, data, back}).',
                  anyOf: [
                    { type: 'string' },
                    edgeObj,
                    { type: 'array', items: { anyOf: [{ type: 'string' }, edgeObj] } },
                  ],
                },
                show: { type: 'object', description: 'Map of card id → rows to reveal.', additionalProperties: { type: 'array', maxItems: 20, items: row } },
                light: { type: 'array', items: sid('Element id.'), description: 'Elements to highlight.' },
              },
            },
          },
        },
      },
    },
    src: srcProperty,
    ...viewProperties,
  },
};
