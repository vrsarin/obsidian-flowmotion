import type { ArrowPresentation, NodePresentation, ScenePresentation, ShapePresentation } from '../story/types';
import type { Model } from './model';

export function presentationAt(m: Model, t: number): ScenePresentation | undefined {
  return m.timeline.scenes?.find((scene) => t >= scene.start && t < scene.end)?.presentation;
}

export function nodePresentation(scene: ScenePresentation | undefined, id: string): NodePresentation {
  return { ...scene?.defaults?.nodes, ...scene?.nodes?.[id] };
}

export function groupPresentation(scene: ScenePresentation | undefined, id: string): ShapePresentation {
  return { ...scene?.defaults?.groups, ...scene?.groups?.[id] };
}

export function arrowPresentation(scene: ScenePresentation | undefined, id: string): ArrowPresentation {
  return { ...scene?.defaults?.arrows, ...scene?.arrows?.[id] };
}

export function presentationOpacity(settings: { visible?: boolean; opacity?: number }): number {
  return settings.visible === false ? 0 : settings.opacity ?? 1;
}

export function presentationVisibility(settings: { visible?: boolean }): 'hidden' | 'visible' {
  return settings.visible === false ? 'hidden' : 'visible';
}
