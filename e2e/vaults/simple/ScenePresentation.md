# Scene presentation

```flowmotion
controls: true
interactive: true
elements:
  - { id: a, type: rectangle, content: [{ type: title, text: A }] }
  - { id: b, type: rectangle, content: [{ type: title, text: B }] }
  - { id: group, type: group, label: { title: Group }, children: [a, b], layout: { direction: row, gap: 80 } }
  - { id: edge, type: arrow, start: { id: a }, end: { id: b } }
scenes:
  - label: Focus
    presentation:
      defaults:
        nodes: { opacity: 0.3 }
        arrows: { visible: false, packet: true }
      nodes:
        a: { opacity: 1, fill: '#e8f4ff' }
    beats: [{ ms: 1000, edges: [edge] }]
  - label: Hidden
    presentation:
      defaults:
        nodes: { visible: false }
        groups: { visible: false }
        arrows: { visible: false, packet: false }
    beats: [{ ms: 1000, edges: [edge] }]
  - label: Reset
    beats: [{ ms: 1000, edges: [edge] }]
```
