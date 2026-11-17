# Diagram

```flowmotion
diagram:
  id: smoke
  direction: LR

nodes:
  - { id: a, label: Client }
  - { id: b, label: Server }

flows:
  - { id: f1, from: a, to: b, payload: Request }
```
