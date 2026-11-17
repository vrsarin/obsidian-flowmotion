/** Starter content for a new .flow file. */
export const FLOW_TEMPLATE = `diagram:
  id: example
  direction: LR

nodes:
  - { id: client, label: Client }
  - { id: api, label: API }

flows:
  - { id: f1, from: client, to: api, payload: Request }

events:
  - { id: t1, type: transfer, flow: f1 }
  - { id: p1, type: process, node: api, after: [t1] }
`;
