import { describe, expect, it } from 'vitest';
import { parseText } from '../src/text/parse';
import { DiagramError } from '../src/core/types';

const ok = (src: string) => parseText(src);
const bad = (src: string, re?: RegExp) => { try { parseText(src); } catch (e) { expect(e).toBeInstanceOf(DiagramError); if (re) expect((e as DiagramError).problems.join('\n')).toMatch(re); return; } throw new Error('expected failure for:\n' + src); };
const u = (...l: string[]) => ['@startuml', ...l, '@enduml'].join('\n');

describe('activity syntax', () => {
  it('handles every construct', () => {
    const d = ok(u('title T', "' c", 'start', ':a;', '-> go;', ':multi', 'line;', 'note right: n', ':n2;', 'note left', 'x', 'end note',
      'if (c1) then (y)', ':b;', 'elseif (c2) then (z)', ':c;', 'else (n)', ':d;', 'endif',
      'if (q) then', ':e;', 'endif',
      'while (w?) is (more)', ':f;', 'endwhile (done)',
      'while (w2)', ':g;', 'endwhile',
      'repeat', ':h;', 'repeat while (again?) is (yes) not (no)',
      'repeat', ':i;', 'repeat while (z)',
      'fork', ':j;', 'fork again', ':k;', 'end fork',
      'split', ':l;', 'split again', ':m;', 'end split',
      'partition P {', ':n;', '}', 'package Q', ':o;', 'end package', '|lane|', 'swimlane s',
      'detach', 'start', 'kill', 'stop', 'end'));
    expect(d.nodes.length).toBeGreaterThan(10);
  });
  it('flags structural errors', () => {
    bad(u('start', 'else'), /else/);
    bad(u('start', 'endif'), /endif/);
    bad(u('start', 'endwhile'), /endwhile/);
    bad(u('start', 'repeat while (x)'), /repeat while/);
    bad(u('start', 'fork again'), /fork again/);
    bad(u('start', 'end fork'), /end fork/);
    bad(u('start', 'if (x) then', ':a;'), /never closed/);
    bad(u('start', 'gibberish here'), /Unrecognised/);
  });
});

describe('state syntax', () => {
  const m = (...l: string[]) => ['stateDiagram-v2', ...l].join('\n');
  it('parses', () => {
    ok(m('direction LR', '[*] --> A', 'A --> B : go', 'A ..> C', 'state "Long name" as L', 'state L2 <<choice>>', 'state F <<fork>>', 'state "Comp" as Co <<join>>',
      'state Big {', '[*] --> In', 'In --> [*]', '--', 'In2 --> In', '}', 'state "Quoted" as Qd {', 'Z --> Y', '}', 'B --> Big', 'Big --> [*]', 'A: desc one', 'A: desc two', 'note right of A: x', "' c", '%% c'));
    ok('@startuml\nstate A\nstate B {\n[*] --> C\n}\n[*] --> A\nA --> B\nB --> [*]\n@enduml');
    bad(m('}'), /Unmatched/); bad(m('state X {', 'A --> B'), /never closed/);
    bad(m('???'), /Unrecognised/);
  });
});

describe('class syntax', () => {
  const c = (...l: string[]) => ['classDiagram', ...l].join('\n');
  it('parses', () => {
    ok(c('class A {', '<<interface>>', '+x int', '+f() void', '}', 'abstract class B', 'interface I', 'enum E {', 'ONE', '}', 'class C <<service>>', 'class D',
      'A <|-- B', 'A *-- "1" C : owns', 'A o-- "n" D', 'A --> E : uses >', 'I <|.. B', 'A ..> C', 'A -- D', 'A "1" --> "*" B : has', 'A : +id int', 'D : <<x>>', 'namespace N', 'direction LR', 'F {', 'x', '}', 'class G', 'class H {', '+a', '}'));
    ok(u('class A {', '+x', '}', 'interface I', 'abstract A2', 'A <|-- A2', 'A --> I'));
    bad(c('???'), /Unrecognised/);
  });
});

describe('er syntax', () => {
  it('parses', () => {
    ok('erDiagram\nA ||--o{ B : has\nB }|..|{ C : x\nA |o--o| C : y\nA {\nint id PK\nstring n FK,UK "c"\nstring z\n}');
    ok(u('entity "Long" as L {', 'int id PK', '}', 'entity E', 'entity E2 {', '}', 'L ||--o{ E : has', 'E ||--|| E2'));
    bad('erDiagram\nA {\nbad\n}', /Attribute/); bad('erDiagram\nnonsense', /Unrecognised/);
  });
});

describe('mindmap syntax', () => {
  it('parses mermaid and plantuml', () => {
    ok('mindmap\n  root((Root))\n    A[Box]\n      A1(Round)\n    B{{Hex}}\n    ::icon(x)\n    C\n      D\n  %% c');
    ok('@startmindmap\n* Root\n** A\n*** A1\n** B\n+ C\n@endmindmap');
    ok('@startmindmap\n* Root\n** [#red] A\n** _B\n@endmindmap');
    bad('mindmap\n  root\n  second', /more than one root/);
  });
});

describe('gantt syntax', () => {
  it('parses mermaid', () => {
    const d = ok(['gantt', 'title Plan', 'dateFormat YYYY-MM-DD', 'section S1', 'A :done, a1, 2024-01-01, 3d', 'B :active, a2, after a1, 1w', 'C :crit, a3, after a1 a2, 2d', 'M :milestone, m1, 2024-02-01, 0d', 'D :d1, 2024-01-05, 2024-01-09', 'E :2d', 'F :2024-01-03, 12h', 'section S2', 'G :g, after a1, 1d'].join('\n'));
    expect(d.gantt).toBeDefined();
    bad('gantt\nA : a1, 2024-01-01, 1d\nB : a1, 2024-01-01, 1d', /Duplicate/);
    bad('gantt\nA : a1, notadate, 1d', /not a date/);
    bad('gantt\nA : a1, 2024-01-01, zzz', /duration/);
    bad('gantt\nno colon', /Expected/);
    bad('gantt\ntitle only', /at least one task/);
    bad('gantt\nA : a1, after nope, 1d', /unknown task/);
    bad('gantt\nA : a1, after a2, 1d\nB : a2, after a1, 1d', /itself/);
  });
  it('parses plantuml', () => {
    ok(['@startgantt', 'title P', 'Project starts 2024-01-01', 'saturday are closed', 'language en', '-- Phase --', '[A] lasts 3 days', '[B] starts at [A]\'s end and lasts 2 weeks', '[C] starts at [A]\'s start and lasts 1 day', '[D] happens at [B]\'s end', '[E] happens 2024-02-02', '[F] starts 2024-01-03 and ends 2024-01-10', '[F] is colored in red', 'then [G] lasts 2 days', '[H] as [HH]', '@endgantt'].join('\n'));
    bad(['@startgantt', '[A] lasts zz days', '@endgantt'].join('\n'), /duration/);
    bad(['@startgantt', '[A] wibbles', '@endgantt'].join('\n'), /Gantt clause/);
    bad(['@startgantt', 'nonsense', '@endgantt'].join('\n'), /Gantt statement/);
  });
});

describe('c4 syntax', () => {
  it('parses mermaid and plantuml', () => {
    ok(['C4Context', 'title T', 'Person(u, "User", "desc")', 'Person_Ext(e, "Ext")', 'System(s, "Sys", "d")', 'System_Ext(x, "X")', 'SystemDb(sd, "DB")', 'Container(c, "C", "Go", "d")', 'ContainerQueue(q, "Q", "Kafka")', 'Component(k, "K", "T", "d")', 'Enterprise_Boundary(eb, "E") {', 'System(in, "In")', '}', 'Boundary(b, "B")', 'Rel(u, s, "uses", "https")', 'BiRel(s, c, "talks")', 'Rel_Back(c, s, "back")', 'UpdateRelStyle(u, s)', 'Rel(a)', 'LAYOUT_WITH_LEGEND()'].join('\n').replace('Rel(a)', 'Rel(u, s)'));
    bad('C4Context\nPerson(a)\nRel(a)', /Rel needs/);
    bad('C4Context\nWeird(a, "x")', /Unknown C4/);
    bad('C4Context\nnot a call', /Unrecognised C4/);
    bad('C4Context\nSystem_Boundary(a, "A") {\nSystem(b, "B")', /never closed/);
    ok(u('!include C4.puml', 'Person(a, "A")', 'System(b, "B")', 'Rel(a, b, "r")'));
  });
});

describe('component syntax', () => {
  it('parses plantuml component', () => {
    ok(u('component Web', 'component "Long Name" as LN', 'node N {', 'component [In]', 'database DB', '}', 'cloud C', 'queue Q', 'actor A', 'package P {', '}', '[Web] --> [DB] : sql', '[Web] ..> () API', 'LN <-- (UC)', 'A -> N', '[X] as Y', '() "Port" as P1', '[Lone]', 'Web -right-> DB', 'left to right direction', 'skinparam x y', 'note right: n'));
    bad(u('node N {', 'component A'), /never closed/);
    bad(u('}', 'component A'), /Unmatched/);
    bad(u('component A', '???!!!'), /Unrecognised/);
  });
  it('parses mermaid architecture', () => {
    ok(['architecture-beta', 'group api(cloud)[API]', 'group g2[G2] in api', 'service db(database)[Database] in api', 'service s(server)[Server] in api', 'service d(disk)[Disk]', 'service i(internet)[Net]', 'service cl(cloud)[Cl]', 'junction j', 'db:L -- R:s', 's:T --> B:d', 'i:R <--> L:cl', 'd:B -- T:j'].join('\n'));
    bad('architecture-beta\nservice a[A]\na:R -- L:ghost', /Unknown service/);
    bad('architecture-beta\nwhat', /Unrecognised architecture/);
  });
});

describe('directives', () => {
  it('applies and rejects', () => {
    ok('flowchart LR\n%% @speed 2\n%% @loop off\n%% @autoplay off\n%% @duration A 500\n%% @fail A\nA --> B');
    bad('flowchart LR\n%% @speed 99\nA --> B', /speed/);
    bad('flowchart LR\n%% @duration Z 5\nA --> B', /duration/);
    bad('flowchart LR\n%% @fail Z\nA --> B', /fail/);
    bad('flowchart LR\n%% @wat\nA --> B', /Unknown directive/);
  });
});
