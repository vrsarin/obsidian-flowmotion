import { ENDS, LIMITS, LINES, SHAPES } from '../core/types';
import { idList, idRef, srcProperty, text, viewProperties } from './common';
import type { Schema } from './types';

const styleSchema = (description: string): Schema => ({
  type: 'object', additionalProperties: false, description,
  properties: {
    fill: { type: 'string', description: 'Background colour, e.g. #e6efff.' }, stroke: { type: 'string', description: 'Outline / line colour.' },
    color: { type: 'string', description: 'Text colour.' }, strokeWidth: { type: 'number', minimum: 0, maximum: 12 },
  },
});

export const diagramSchema: Schema & { $schema?: string; title?: string } = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'FlowMotion diagram',
  type: 'object',
  required: ['nodes'],
  additionalProperties: false,
  properties: {
    diagram: {
      type: 'object', additionalProperties: false, description: 'Diagram-wide settings.',
      properties: {
        id: idRef('Identifier used for generated SVG ids.'),
        edgeLabels: { type: 'boolean', description: 'Show each flow\'s payload as a label on its connector, so the static diagram reads like a flowchart.', default: false },
        direction: { type: 'string', enum: ['LR', 'RL', 'TB', 'BT'], description: 'Layout direction.', default: 'LR' },
      },
    },
    groups: {
      type: 'array', maxItems: LIMITS.nodes, description: 'Boxes that visually contain nodes (like Mermaid subgraphs). Groups can nest.',
      items: {
        type: 'object', required: ['id'], additionalProperties: false,
        properties: { id: idRef('Unique group id.'), label: text('Title shown on the group.'), parent: idRef('Id of the group this one sits inside.') },
      },
    },
    nodes: {
      type: 'array', minItems: 1, maxItems: LIMITS.nodes, description: 'The boxes in the diagram.',
      items: {
        type: 'object', required: ['id'], additionalProperties: false,
        properties: {
          id: idRef('Unique node id.'), label: text('Text shown in the box (defaults to the id).', LIMITS.label),
          shape: { type: 'string', enum: [...SHAPES], description: 'Outline of the node.', default: 'rect' },
          group: idRef('Id of the group that contains this node.'),
          lines: { type: 'array', maxItems: 60, items: { type: 'string', maxLength: LIMITS.label }, description: 'Text lines under the title (class members, attributes, notes).' },
          style: styleSchema('Colours for this node.'),
        },
      },
    },
    flows: {
      type: 'array', maxItems: LIMITS.flows, description: 'Connectors between nodes. Packets travel along flows.',
      items: {
        type: 'object', required: ['id', 'from', 'to'], additionalProperties: false,
        properties: {
          id: idRef('Unique flow id (referenced by transfer events).'),
          from: idRef('Source node id.', 'node'), to: idRef('Target node id.', 'node'),
          payload: text('Label carried by the packet.'),
          line: { type: 'string', enum: [...LINES], description: 'Line style.', default: 'solid' },
          head: { type: 'string', enum: [...ENDS], description: 'Decoration at the target end.', default: 'arrow' },
          tail: { type: 'string', enum: [...ENDS], description: 'Decoration at the source end.', default: 'none' },
          headLabel: text('Small text at the target end, e.g. 1 or 0..*.', 20), tailLabel: text('Small text at the source end.', 20),
          style: styleSchema('Colour and width of the line.'),
          curve: { type: 'boolean', description: 'Draw the connector as a curve (helps avoid overlaps).' },
        },
      },
    },
    events: {
      type: 'array', maxItems: LIMITS.events, description: 'The animation script. Events run when everything in `after` is done.',
      items: {
        type: 'object', required: ['id', 'type'], additionalProperties: false,
        properties: {
          id: idRef('Unique event id.'),
          type: {
            type: 'string', enum: ['transfer', 'process', 'complete', 'branch', 'fork', 'join', 'wait', 'emit'],
            description: 'transfer: packet along a flow · process/emit/complete: node activity · wait: node waits for `until` · fork/join: sync points · branch: pick `select` children.',
          },
          flow: idRef('transfer: the flow to send a packet along.', 'flow'),
          node: idRef('process, emit, complete, wait: the node involved.', 'node'),
          payload: text('Packet label override.'),
          after: idList('Event ids that must finish first.', 'event'),
          until: idList('wait only: the wait ends when all of these events complete.', 'event'),
          select: idList('branch only: the child events that are taken; others are skipped.', 'event'),
          duration: { type: 'number', minimum: 0, maximum: LIMITS.duration, description: 'Length in milliseconds.' },
          fail: { type: 'boolean', description: 'process only: the node ends in an error state.' },
        },
      },
    },
    animation: {
      type: 'object', additionalProperties: false, description: 'Playback settings.',
      properties: {
        autoplay: { type: 'boolean', default: true }, loop: { type: 'boolean', default: true },
        speed: { type: 'number', minimum: 0.1, maximum: 10, default: 1, description: 'Playback speed multiplier.' },
      },
    },
    src: srcProperty,
    ...viewProperties,
  },
};
