import type { NodeState } from '../core/types';
import type { Tone } from '../story/types';

export interface StateStyle { fill: string; stroke: string; width: number }
export interface Theme {
  /** true when all values are literal colours (required for SMIL export). */
  concrete: boolean;
  bg: string; text: string; edge: string; muted: string;
  packetFill: string; packetText: string; bar: string;
  states: Record<NodeState, StateStyle>;
  /** Row accent colours (storyboards). */
  tones: Record<Tone, string>;
  /** Halo behind edge labels. */
  halo: string;
}

export const light: Theme = {
  tones: { gray: '#6b7785', blue: '#2f6fed', purple: '#8a5cd0', green: '#2e9e5b', orange: '#d9780f' }, halo: '#ffffff',
  concrete: true, bg: '#ffffff', text: '#1f2933', edge: '#8392a5', muted: '#6b7785',
  packetFill: '#2f6fed', packetText: '#ffffff', bar: '#2f6fed',
  states: {
    idle: { fill: '#f3f5f8', stroke: '#c3ccd8', width: 1.5 },
    receiving: { fill: '#fff6e0', stroke: '#e0a100', width: 2.5 },
    processing: { fill: '#e6efff', stroke: '#2f6fed', width: 3 },
    completed: { fill: '#e8f6ee', stroke: '#2e9e5b', width: 2 },
    waiting: { fill: '#f1e9fb', stroke: '#8a5cd0', width: 2.5 },
    error: { fill: '#fdeaea', stroke: '#d13b3b', width: 3 },
  },
};
export const dark: Theme = {
  tones: { gray: '#97a3b4', blue: '#5b93ff', purple: '#a883e8', green: '#45c07a', orange: '#f0a050' }, halo: '#14181f',
  concrete: true, bg: '#14181f', text: '#e6ebf2', edge: '#6c7a8d', muted: '#97a3b4',
  packetFill: '#5b93ff', packetText: '#0b1020', bar: '#5b93ff',
  states: {
    idle: { fill: '#1d232d', stroke: '#3a4555', width: 1.5 },
    receiving: { fill: '#3a2f12', stroke: '#e8b433', width: 2.5 },
    processing: { fill: '#16294d', stroke: '#5b93ff', width: 3 },
    completed: { fill: '#14301f', stroke: '#45c07a', width: 2 },
    waiting: { fill: '#2a1f40', stroke: '#a883e8', width: 2.5 },
    error: { fill: '#401818', stroke: '#ef6a6a', width: 3 },
  },
};
/** Follows the active Obsidian theme through its CSS variables (runtime only, not SMIL-safe). */
export const obsidian: Theme = {
  tones: { gray: 'var(--text-muted, #6b7785)', blue: 'var(--color-blue, #2f6fed)', purple: 'var(--color-purple, #8a5cd0)', green: 'var(--color-green, #2e9e5b)', orange: 'var(--color-orange, #d9780f)' }, halo: 'var(--background-primary, #fff)',
  concrete: false, bg: 'transparent', text: 'var(--text-normal, #222)', edge: 'var(--text-faint, #888)', muted: 'var(--text-muted, #666)',
  packetFill: 'var(--interactive-accent, #2f6fed)', packetText: 'var(--text-on-accent, #fff)', bar: 'var(--interactive-accent, #2f6fed)',
  states: {
    idle: { fill: 'var(--background-secondary, #f3f5f8)', stroke: 'var(--background-modifier-border, #c3ccd8)', width: 1.5 },
    receiving: { fill: 'var(--background-secondary, #fff6e0)', stroke: 'var(--color-yellow, #e0a100)', width: 2.5 },
    processing: { fill: 'var(--background-modifier-hover, #e6efff)', stroke: 'var(--interactive-accent, #2f6fed)', width: 3 },
    completed: { fill: 'var(--background-secondary, #e8f6ee)', stroke: 'var(--color-green, #2e9e5b)', width: 2 },
    waiting: { fill: 'var(--background-secondary, #f1e9fb)', stroke: 'var(--color-purple, #8a5cd0)', width: 2.5 },
    error: { fill: 'var(--background-secondary, #fdeaea)', stroke: 'var(--color-red, #d13b3b)', width: 3 },
  },
};
export const themes = { light, dark, obsidian } as const;
export type ThemeName = keyof typeof themes;
