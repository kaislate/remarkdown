# Flowchart corpus (round 2)

Flowchart syntax beyond the round-1 subset: legacy `graph`, subgraphs, styling, groups, every shape and link kind, markdown strings, frontmatter.

## fc2-graph-semicolons

```mermaid
graph TD;
    A-->B;
    A-->C;
    B-->D;
    C-->D;
```

## fc2-graph-no-direction

```mermaid
graph
    Start --> Stop
```

## fc2-ampersand-groups

```mermaid
flowchart LR
    a & b --> c & d
    c --> e & f
    %% fan in
    e & f --> g
```

## fc2-every-shape

```mermaid
flowchart LR
    s1[Rect] --> s2(Rounded) --> s3([Stadium]) --> s4[[Sub]]
    s5[(Disk)] --> s6((Circle)) --> s7(((Ring))) --> s8>Flag]
    s9{Choice} --> s10{{Prep}} --> s11[/In/] --> s12[\Out\]
    s13[/Trap\] --> s14[\Inv/]
```

## fc2-every-link

```mermaid
flowchart TB
    A --> B
    A --- C
    A -.-> D
    A -.- E
    A ==> F
    A === G
    A ~~~ H
    A --o I
    A --x J
    A <--> K
    A o--o L
    A x--x M
    A ----> N
    A -..-> O
    A ===> P
    A -- inline text --> Q
    A -. dotted text .-> R
    A == thick text ==> S
    A -->|pipe text| T
    A -- "quoted inline" --> U
```

## fc2-subgraph-forms

```mermaid
flowchart TB
    subgraph one [First group]
        a1 --> a2
    end
    subgraph "Quoted group title"
        b1
    end
    subgraph Two words
        c1
    end
    subgraph three
        direction LR
        d1 --> d2
        subgraph inner["Inner #quot;quoted#quot;"]
            e1
        end
    end
    a2 --> b1
    c1 --> three
    one --> d1
```

## fc2-styling-everything

```mermaid
flowchart LR
    classDef warm fill:#fde68a,stroke:#ca8a04
    classDef cool fill:#bfdbfe
    A[Warm]:::warm --> B[Cool]
    B --> C[Styled]
    B --> D[Plain]
    class B cool
    class C,D cool
    style C fill:#fecaca,stroke:#dc2626,color:#111827
    style D stroke-dasharray: 5 5
    linkStyle 0 stroke:#16a34a,stroke-width:2px
    linkStyle 1,2 stroke:#9333ea
    linkStyle default color:#6b7280
    click A "https://example.com" "Open the docs"
```

## fc2-markdown-labels

```mermaid
flowchart TD
    A["`**Bold** start`"] --> B["`An _italic_ step`"]
    B -->|"`**yes**`"| C["`Line one
    Line two`"]
    C --> D[Plain with<br>break]
```

## fc2-frontmatter-title

```mermaid
---
title: Order flow
---
flowchart LR
    %% leading comment
    order[Order placed] --> pay{Paid?}
    pay -->|yes| ship[Ship it]
    pay -->|no| remind[Send reminder] -.-> pay
```

## fc2-attr-shapes

```mermaid
flowchart LR
    A@{ shape: cyl, label: "Orders DB" } --> B@{ shape: diam, label: "Valid?" }
    B --> C@{ shape: doc, label: "Report" }
    B --> D@{ shape: rounded }
```

## fc2-edge-ids

```mermaid
flowchart LR
    A e1@--> B
    B e2@==> C
    e1@{ animate: true }
```

## fc2-odd-ids

```mermaid
flowchart LR
    web-app --> api.v2
    api.v2 --> 1
    1 --> Ünïcode
```

## fc2-init-elk-like

```mermaid
%%{init: {"flowchart": {"curve": "linear"}}}%%
flowchart LR
    subgraph frontend [Frontend]
        ui[UI] --> state[(Store)]
    end
    subgraph backend [Backend]
        api[API] --> db[(DB)]
    end
    ui --> api
    style ui fill:#bbf7d0
```
